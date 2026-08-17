'use strict';
// Catalogo degli analizzatori.
//
// Una macchina appartiene sempre a un account (`user_id`). `concorrente_id`
// distingue le proprie da quelle di un concorrente: e' cio' che rende
// possibile il confronto a due lati, come per gli esami.

const { parsePrezzo } = require('./pdfclassifica');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS macchine (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      concorrente_id INTEGER REFERENCES concorrenti(id),
      nome           TEXT    NOT NULL,
      prezzo         REAL    NOT NULL,
      note           TEXT,
      data_import    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Indici parziali: in SQLite i NULL sono distinti fra loro dentro un
    -- UNIQUE, quindi un indice unico su (concorrente_id, nome) non
    -- impedirebbe i doppioni fra le macchine proprie.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_macchine_propria
      ON macchine(user_id, nome) WHERE concorrente_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_macchine_conc
      ON macchine(concorrente_id, nome) WHERE concorrente_id IS NOT NULL;
  `);
}

function normalizza(riga) {
  const nome = String((riga && riga.nome) || '').replace(/\s+/g, ' ').trim();
  // Number(null) vale 0: senza questo controllo esplicito una riga senza
  // prezzo (assente o vuoto) verrebbe salvata come se costasse zero invece
  // di essere scartata. Resta valido anche ora che si usa parsePrezzo (che
  // per null e stringa vuota restituisce NaN, quindi la riga sarebbe
  // comunque scartata piu' sotto): lo teniamo esplicito per chiarezza.
  if (!riga || riga.prezzo == null || riga.prezzo === '') return null;
  // Number() non capisce il formato italiano: Number('1.234,56') e' NaN
  // (la virgola non e' un decimale valido per JS), quindi una riga con il
  // prezzo scritto "all'italiana" sparirebbe in silenzio dal conteggio
  // "salvate" invece di essere segnalata. parsePrezzo (la stessa funzione
  // usata da importbozze.js per lo stesso motivo) interpreta sia
  // "1.234,56" sia "1234.56".
  const prezzo = parsePrezzo(riga.prezzo);
  if (!nome || !Number.isFinite(prezzo) || prezzo < 0) return null;
  const note = riga.note == null || riga.note === '' ? null : String(riga.note);
  return { nome, prezzo, note };
}

// Il concorrenteId arriva dal client nelle rotte HTTP: upsertMacchine e
// salvaMacchina sono chiamate da piu' rotte diverse, quindi il controllo sta
// qui (condiviso) invece che duplicato in ciascun chiamante. Dimenticarlo in
// uno solo basterebbe a far agganciare una macchina al concorrente di un
// altro account, che poi comparirebbe in listaMacchine (per lo stesso
// motivo la' sotto il JOIN e' vincolato allo stesso account).
function verificaConcorrenteProprio(db, concorrenteId, userId) {
  const esiste = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`)
    .get(Number(concorrenteId), Number(userId));
  if (!esiste) throw new Error('Concorrente non trovato');
}

/**
 * Inserisce o aggiorna un elenco di macchine.
 * Reimportare lo stesso listino aggiorna i prezzi invece di duplicare le righe.
 */
function upsertMacchine(db, dati) {
  const { userId, concorrenteId, righe } = dati;
  if (userId == null) throw new Error('userId mancante');
  const owner = concorrenteId == null ? null : Number(concorrenteId);
  // Verifica prima di aprire la transazione: se il concorrente non e' proprio,
  // niente deve essere scritto.
  if (owner != null) verificaConcorrenteProprio(db, owner, userId);

  // Due comandi distinti: l'ON CONFLICT deve puntare all'indice parziale
  // giusto, e i due indici hanno colonne diverse.
  const upsertPropria = db.prepare(`
    INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note)
    VALUES (?, NULL, ?, ?, ?)
    ON CONFLICT(user_id, nome) WHERE concorrente_id IS NULL
    DO UPDATE SET prezzo = excluded.prezzo, note = excluded.note
  `);
  const upsertConc = db.prepare(`
    INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(concorrente_id, nome) WHERE concorrente_id IS NOT NULL
    DO UPDATE SET prezzo = excluded.prezzo, note = excluded.note
  `);

  db.exec('BEGIN');
  try {
    let salvate = 0;
    for (const grezza of (righe || [])) {
      const r = normalizza(grezza);
      if (!r) continue;
      if (owner == null) upsertPropria.run(Number(userId), r.nome, r.prezzo, r.note);
      else upsertConc.run(Number(userId), owner, r.nome, r.prezzo, r.note);
      salvate++;
    }
    db.exec('COMMIT');
    return { salvate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listaMacchine(db, userId) {
  return db.prepare(`
    SELECT m.id, m.nome, m.prezzo, m.note, m.concorrente_id, m.data_import, c.nome AS concorrente_nome
      FROM macchine m
      -- Il JOIN e' vincolato anche su c.user_id = m.user_id, non solo su
      -- c.id = m.concorrente_id: una riga con un concorrente_id di un altro
      -- account (dato scritto prima di questo controllo, o comunque non
      -- piu' valido) non deve esporre il nome di quel concorrente.
      LEFT JOIN concorrenti c ON c.id = m.concorrente_id AND c.user_id = m.user_id
     WHERE m.user_id = ?
     ORDER BY m.prezzo ASC, m.nome ASC
  `).all(Number(userId)).map(r => ({
    id: r.id,
    nome: r.nome,
    prezzo: r.prezzo,
    note: r.note,
    concorrenteId: r.concorrente_id,
    concorrenteNome: r.concorrente_nome,
    dataImport: r.data_import
  }));
}

function salvaMacchina(db, dati) {
  const { id, userId, concorrenteId, nome, prezzo, note } = dati;
  const r = normalizza({ nome, prezzo, note });
  if (!r) throw new Error('Nome o prezzo non validi');
  const owner = concorrenteId == null ? null : Number(concorrenteId);
  // Stesso controllo di upsertMacchine, vedi verificaConcorrenteProprio: qui
  // arriva sia l'inserimento manuale sia la modifica, ed entrambi passano un
  // concorrenteId scelto lato client.
  if (owner != null) verificaConcorrenteProprio(db, owner, userId);

  if (id == null) {
    // Niente ON CONFLICT qui (a differenza di upsertMacchine): l'inserimento
    // manuale di un nome gia' presente per lo stesso proprietario (utente o
    // concorrente) deve fallire, non aggiornare in silenzio. Ma senza questo
    // catch l'errore che arriverebbe all'operatore sarebbe quello grezzo del
    // driver ("UNIQUE constraint failed: macchine.user_id, macchine.nome" o
    // "..., macchine.concorrente_id, macchine.nome"), invece di un messaggio
    // applicativo comprensibile come gli altri di questo modulo.
    try {
      const info = db.prepare(`
        INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note) VALUES (?, ?, ?, ?, ?)
      `).run(Number(userId), owner, r.nome, r.prezzo, r.note);
      return { id: Number(info.lastInsertRowid) };
    } catch (err) {
      if (err && err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message || '')) {
        throw new Error("Esiste gia' una macchina con questo nome");
      }
      throw err;
    }
  }

  // Il vincolo su user_id nella WHERE e' la difesa: senza, conoscere un id
  // basterebbe a modificare la macchina di un altro account.
  const info = db.prepare(`
    UPDATE macchine SET nome = ?, prezzo = ?, note = ?, concorrente_id = ?
     WHERE id = ? AND user_id = ?
  `).run(r.nome, r.prezzo, r.note, owner, Number(id), Number(userId));
  if (!info.changes) throw new Error('Macchina non trovata');
  return { id: Number(id) };
}

function eliminaMacchina(db, id, userId) {
  const info = db.prepare(`DELETE FROM macchine WHERE id = ? AND user_id = ?`)
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = { ensureSchema, upsertMacchine, listaMacchine, salvaMacchina, eliminaMacchina };
