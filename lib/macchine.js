'use strict';
// Listini di analizzatori e loro macchine.
//
// Una macchina appartiene a un listino, come un esame di concorrenza appartiene
// al concorrente. Il listino porta il nome del file importato e la provenienza:
// `concorrente_id` nullo significa "macchine mie", valorizzato significa "di
// quel concorrente". La provenienza sta sul listino e non sulla singola riga,
// perche' e' una proprieta' dell'import: tenerla in due posti significherebbe
// poterli far divergere.
//
// `macchine` non ha `user_id`: l'appartenenza a un account si verifica sempre
// risalendo al listino. Ogni funzione riceve `userId` e non si fida degli id
// che arrivano dal client.

const { parsePrezzo } = require('./pdfclassifica');

function ensureSchema(db) {
  // La tabella `macchine` esisteva gia' nella forma vecchia (macchine legate
  // direttamente a user_id/concorrente_id, senza listino). CREATE TABLE IF
  // NOT EXISTS non la ricreerebbe: su un database di sviluppo con quello
  // schema le query sotto fallirebbero perche' mancano le colonne nuove
  // (listino_id) o ne restano di indebite (user_id). Non c'e' nessun dato da
  // salvare (in produzione la tabella non e' mai stata usata), quindi qui la
  // si elimina e ricrea invece di scrivere una migrazione.
  const colonne = db.prepare(`PRAGMA table_info(macchine)`).all();
  const vecchiaForma = colonne.some(c => c.name === 'user_id');
  if (vecchiaForma) db.exec('DROP TABLE macchine');

  db.exec(`
    CREATE TABLE IF NOT EXISTS listini_macchine (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      nome           TEXT    NOT NULL,
      concorrente_id INTEGER REFERENCES concorrenti(id),
      data_import    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_listini_utente ON listini_macchine(user_id);

    CREATE TABLE IF NOT EXISTS macchine (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      listino_id INTEGER NOT NULL REFERENCES listini_macchine(id),
      nome       TEXT    NOT NULL,
      prezzo     REAL    NOT NULL,
      note       TEXT,
      UNIQUE(listino_id, nome)
    );
  `);
}

// L'id del listino arriva dal client: senza questo controllo conoscerne uno
// basterebbe a leggere o scrivere nel catalogo di un altro account.
function listinoProprio(db, listinoId, userId) {
  const row = db.prepare(`SELECT id, user_id, nome, concorrente_id, data_import FROM listini_macchine WHERE id = ? AND user_id = ?`)
    .get(Number(listinoId), Number(userId));
  if (!row) throw new Error('Listino non trovato');
  return row;
}

function concorrenteProprio(db, concorrenteId, userId) {
  const row = db.prepare(`SELECT id FROM concorrenti WHERE id = ? AND user_id = ?`)
    .get(Number(concorrenteId), Number(userId));
  if (!row) throw new Error('Concorrente non trovato');
  return row;
}

function normalizza(riga) {
  const nome = String((riga && riga.nome) || '').replace(/\s+/g, ' ').trim();
  // Number non basta: un prezzo scritto in formato italiano ("1.234,56")
  // diventerebbe NaN e la riga sparirebbe in silenzio.
  const grezzo = riga ? riga.prezzo : null;
  if (grezzo == null || grezzo === '') return null;
  const prezzo = parsePrezzo(grezzo);
  if (!nome || !Number.isFinite(prezzo) || prezzo < 0) return null;
  const note = riga.note == null || riga.note === '' ? null : String(riga.note);
  return { nome, prezzo, note };
}

// SQLite riporta la violazione di unicita' con un messaggio in inglese del
// driver: qui diventa una frase che l'operatore puo' capire.
function traduciDuplicato(err) {
  if (err && /UNIQUE constraint failed/.test(String(err.message))) {
    return new Error('Esiste gia una macchina con questo nome in questo listino');
  }
  return err;
}

function creaListino(db, dati) {
  const { userId, nome, concorrenteId } = dati;
  if (userId == null) throw new Error('userId mancante');
  const titolo = String(nome || '').trim() || 'listino.pdf';
  const owner = concorrenteId == null || concorrenteId === '' ? null : Number(concorrenteId);
  if (owner != null) concorrenteProprio(db, owner, userId);
  const info = db.prepare(`INSERT INTO listini_macchine (user_id, nome, concorrente_id) VALUES (?, ?, ?)`)
    .run(Number(userId), titolo, owner);
  return { id: Number(info.lastInsertRowid) };
}

function listaListini(db, userId) {
  return db.prepare(`
    SELECT l.id, l.nome, l.concorrente_id, l.data_import, c.nome AS concorrente_nome,
           (SELECT COUNT(*) FROM macchine m WHERE m.listino_id = l.id) AS n_macchine
      FROM listini_macchine l
      LEFT JOIN concorrenti c ON c.id = l.concorrente_id AND c.user_id = l.user_id
     WHERE l.user_id = ?
     ORDER BY l.data_import DESC, l.id DESC
  `).all(Number(userId)).map(r => ({
    id: r.id, nome: r.nome,
    concorrenteId: r.concorrente_id, concorrenteNome: r.concorrente_nome,
    nMacchine: r.n_macchine, dataImport: r.data_import
  }));
}

function getListino(db, id, userId) {
  const r = db.prepare(`
    SELECT l.id, l.nome, l.concorrente_id, l.data_import, c.nome AS concorrente_nome
      FROM listini_macchine l
      LEFT JOIN concorrenti c ON c.id = l.concorrente_id AND c.user_id = l.user_id
     WHERE l.id = ? AND l.user_id = ?
  `).get(Number(id), Number(userId));
  if (!r) return null;
  return {
    id: r.id, nome: r.nome,
    concorrenteId: r.concorrente_id, concorrenteNome: r.concorrente_nome,
    dataImport: r.data_import
  };
}

// Eliminare il listino e' cio' che l'operatore chiama "elimina il PDF
// importato": le sue macchine se ne vanno con lui, nella stessa transazione.
function eliminaListino(db, id, userId) {
  const row = db.prepare(`SELECT id FROM listini_macchine WHERE id = ? AND user_id = ?`)
    .get(Number(id), Number(userId));
  if (!row) return false;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM macchine WHERE listino_id = ?`).run(row.id);
    db.prepare(`DELETE FROM listini_macchine WHERE id = ?`).run(row.id);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function upsertMacchine(db, dati) {
  const { listinoId, userId, righe } = dati;
  const listino = listinoProprio(db, listinoId, userId);
  const upsert = db.prepare(`
    INSERT INTO macchine (listino_id, nome, prezzo, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(listino_id, nome) DO UPDATE SET prezzo = excluded.prezzo, note = excluded.note
  `);
  db.exec('BEGIN');
  try {
    let salvate = 0;
    for (const grezza of (righe || [])) {
      const r = normalizza(grezza);
      if (!r) continue;
      upsert.run(listino.id, r.nome, r.prezzo, r.note);
      salvate++;
    }
    db.exec('COMMIT');
    return { salvate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function macchineDiListino(db, listinoId, userId) {
  const row = db.prepare(`SELECT id FROM listini_macchine WHERE id = ? AND user_id = ?`)
    .get(Number(listinoId), Number(userId));
  if (!row) return [];
  return db.prepare(`SELECT id, nome, prezzo, note FROM macchine WHERE listino_id = ? ORDER BY prezzo ASC, nome ASC`)
    .all(row.id);
}

// Tutte le macchine dell'account, con listino e provenienza: e' cio' che serve
// al confronto, che affianca le proprie a quelle di un concorrente.
function listaMacchine(db, userId) {
  return db.prepare(`
    SELECT m.id, m.nome, m.prezzo, m.note, l.id AS listino_id, l.nome AS listino_nome,
           l.concorrente_id, c.nome AS concorrente_nome
      FROM macchine m
      JOIN listini_macchine l ON l.id = m.listino_id
      LEFT JOIN concorrenti c ON c.id = l.concorrente_id AND c.user_id = l.user_id
     WHERE l.user_id = ?
     ORDER BY m.prezzo ASC, m.nome ASC
  `).all(Number(userId)).map(r => ({
    id: r.id, nome: r.nome, prezzo: r.prezzo, note: r.note,
    listinoId: r.listino_id, listinoNome: r.listino_nome,
    concorrenteId: r.concorrente_id, concorrenteNome: r.concorrente_nome
  }));
}

function salvaMacchina(db, dati) {
  const { id, listinoId, userId, nome, prezzo, note } = dati;
  const listino = listinoProprio(db, listinoId, userId);
  const r = normalizza({ nome, prezzo, note });
  if (!r) throw new Error('Nome o prezzo non validi');

  try {
    if (id == null) {
      const info = db.prepare(`INSERT INTO macchine (listino_id, nome, prezzo, note) VALUES (?, ?, ?, ?)`)
        .run(listino.id, r.nome, r.prezzo, r.note);
      return { id: Number(info.lastInsertRowid) };
    }
    const info = db.prepare(`UPDATE macchine SET nome = ?, prezzo = ?, note = ? WHERE id = ? AND listino_id = ?`)
      .run(r.nome, r.prezzo, r.note, Number(id), listino.id);
    if (!info.changes) throw new Error('Macchina non trovata');
    return { id: Number(id) };
  } catch (err) {
    throw traduciDuplicato(err);
  }
}

function eliminaMacchina(db, id, userId) {
  const info = db.prepare(`
    DELETE FROM macchine WHERE id = ? AND listino_id IN (
      SELECT id FROM listini_macchine WHERE user_id = ?
    )
  `).run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = {
  ensureSchema, creaListino, listaListini, getListino, eliminaListino,
  upsertMacchine, macchineDiListino, listaMacchine, salvaMacchina, eliminaMacchina
};
