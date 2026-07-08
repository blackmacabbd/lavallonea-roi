'use strict';
const { norm } = require('./piani.js');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concorrenti (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nome         TEXT UNIQUE NOT NULL,
      data_import  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS esami_concorrente (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      concorrente_id    INTEGER NOT NULL REFERENCES concorrenti(id),
      nome_originale    TEXT NOT NULL,
      prezzo            REAL NOT NULL,
      sconto            REAL,
      esame_mylav_nome  TEXT,
      confermato        INTEGER NOT NULL DEFAULT 0,
      UNIQUE(concorrente_id, nome_originale)
    );
  `);
}

function upsertConcorrente(db, nomeConcorrente, righe) {
  const nome = String(nomeConcorrente || '').trim();
  if (!nome) throw new Error('Nome concorrente mancante');

  db.prepare(`INSERT INTO concorrenti (nome) VALUES (?) ON CONFLICT(nome) DO NOTHING`).run(nome);
  const concorrente = db.prepare(`SELECT id FROM concorrenti WHERE nome = ?`).get(nome);

  const upsert = db.prepare(`
    INSERT INTO esami_concorrente (concorrente_id, nome_originale, prezzo, sconto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(concorrente_id, nome_originale) DO UPDATE SET prezzo = excluded.prezzo, sconto = excluded.sconto
  `);

  db.exec('BEGIN');
  try {
    let righeSalvate = 0;
    for (const r of (righe || [])) {
      const nomeOriginale = String(r.nome_originale || '').trim();
      if (!nomeOriginale) continue;
      upsert.run(concorrente.id, nomeOriginale, Number(r.prezzo) || 0, r.sconto == null || r.sconto === '' ? null : Number(r.sconto));
      righeSalvate++;
    }
    db.exec('COMMIT');
    return { concorrenteId: concorrente.id, righeSalvate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listaConcorrenti(db) {
  return db.prepare(`
    SELECT c.id, c.nome, c.data_import,
      COUNT(e.id) AS n_esami,
      SUM(CASE WHEN e.esame_mylav_nome IS NOT NULL THEN 1 ELSE 0 END) AS n_mappati
    FROM concorrenti c
    LEFT JOIN esami_concorrente e ON e.concorrente_id = c.id
    GROUP BY c.id
    ORDER BY c.nome
  `).all().map(r => ({ ...r, n_mappati: r.n_mappati || 0 }));
}

function dettaglioConcorrente(db, id) {
  const concorrente = db.prepare(`SELECT * FROM concorrenti WHERE id = ?`).get(id);
  if (!concorrente) return null;
  const esami = db.prepare(`SELECT * FROM esami_concorrente WHERE concorrente_id = ? ORDER BY nome_originale`).all(id);
  return { concorrente, esami };
}

module.exports = {
  ensureSchema, upsertConcorrente, listaConcorrenti, dettaglioConcorrente
};
