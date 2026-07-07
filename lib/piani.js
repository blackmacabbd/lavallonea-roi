'use strict';

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS piani_sconto (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT UNIQUE NOT NULL,
      categoria TEXT NOT NULL,
      anno      INTEGER,
      ordine    INTEGER NOT NULL,
      attivo    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS esami_riferimento (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT UNIQUE NOT NULL,
      prezzo_base REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prezzi_piano_esame (
      piano_id INTEGER NOT NULL REFERENCES piani_sconto(id),
      esame_id INTEGER NOT NULL REFERENCES esami_riferimento(id),
      prezzo   REAL NOT NULL,
      PRIMARY KEY (piano_id, esame_id)
    );

    CREATE TABLE IF NOT EXISTS prezzi_esami_custom (
      esame_nome       TEXT NOT NULL,
      piano_id         INTEGER NOT NULL REFERENCES piani_sconto(id),
      prezzo           REAL NOT NULL,
      data_inserimento DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (esame_nome, piano_id)
    );
  `);

  const cols = db.prepare(`PRAGMA table_info(dati_foglio)`).all().map(c => c.name);
  if (!cols.includes('piano_id')) {
    db.exec(`ALTER TABLE dati_foglio ADD COLUMN piano_id INTEGER REFERENCES piani_sconto(id)`);
  }
}

module.exports = { norm, ensureSchema };
