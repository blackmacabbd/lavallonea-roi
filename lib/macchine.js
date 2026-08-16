'use strict';
// Catalogo degli analizzatori.
//
// Una macchina appartiene sempre a un account (`user_id`). `concorrente_id`
// distingue le proprie da quelle di un concorrente: e' cio' che rende
// possibile il confronto a due lati, come per gli esami.

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
  // di essere scartata.
  if (!riga || riga.prezzo == null || riga.prezzo === '') return null;
  const prezzo = Number(riga.prezzo);
  if (!nome || !Number.isFinite(prezzo) || prezzo < 0) return null;
  const note = riga.note == null || riga.note === '' ? null : String(riga.note);
  return { nome, prezzo, note };
}

/**
 * Inserisce o aggiorna un elenco di macchine.
 * Reimportare lo stesso listino aggiorna i prezzi invece di duplicare le righe.
 */
function upsertMacchine(db, dati) {
  const { userId, concorrenteId, righe } = dati;
  if (userId == null) throw new Error('userId mancante');
  const owner = concorrenteId == null ? null : Number(concorrenteId);

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
      LEFT JOIN concorrenti c ON c.id = m.concorrente_id
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

  if (id == null) {
    const info = db.prepare(`
      INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note) VALUES (?, ?, ?, ?, ?)
    `).run(Number(userId), owner, r.nome, r.prezzo, r.note);
    return { id: Number(info.lastInsertRowid) };
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
