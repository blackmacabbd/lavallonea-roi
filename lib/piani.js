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

const CATEGORIE = [
  { categoria: 'Pacchetti standard', piani: [
    'SILVER PACK 2026', 'GOLD PACK 2026', 'PLATINUM PACK 2026', 'CVIT PACK 2026'
  ]},
  { categoria: 'Diamond', piani: [
    'DIAMOND SILVER PACK 2026', 'DIAMOND GOLD PACK 2026', 'DIAMOND PLATINUM PACK 2026', 'DIAMOND CVIT PACK 2026'
  ]},
  { categoria: 'Titanium', piani: [
    'TITANIUM SILVER PACK 2026', 'TITANIUM GOLD PACK 2026', 'TITANIUM CVIT PACK 2026', 'TITANIUM PLATINUM PACK 2026',
    'TITANIUM SILVER PACK _ LEISHMANIA 2026', 'TITANIUM GOLD PACK _ LEISHMANIA 2026',
    'TITANIUM CVIT PACK _ LEISHMANIA 2026', 'TITANIUM PLATINUM PACK _ LEISHMANIA 2026'
  ]},
  { categoria: 'Offerta Leishmania', piani: [
    'SILVER PACK OFFERTA LEISHMANIA 2026', 'GOLD PACK OFFERTA LEISHMANIA 2026',
    'CVIT PACK OFFERTA LEISHMANIA 2026', 'PLATINUM PACK OFFERTA LEISHMANIA 2026'
  ]},
  { categoria: 'Laboratorio interno vs esterno', piani: [
    'CVIT PACK LABORATORIO INTERNO VS ESTERNO 2026', 'PLATINUM PACK LABORATORIO INTERNO VS ESTERNO 2026',
    'CVIT PACK LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026',
    'SILVER PACK OFFERTA LABORATORIO INTERNO VS ESTERNO 2026', 'GOLD PACK OFFERTA LABORATORIO INTERNO VS ESTERNO 2026',
    'SILVER PACK OFFERTA LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026',
    'GOLD PACK OFFERTA LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026',
    'PLATINUM PACK LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026'
  ]},
  { categoria: 'Lab interni add-on', piani: [
    'LAB INTERNI ADD ON PLATINUM PACK _ LEISHMANIA 2026', 'LAB INTERNI ADD ON SILVER PACK 2026',
    'LAB INTERNI ADD ON GOLD PACK 2026', 'LAB INTERNI ADD ON CVIT PACK 2026', 'LAB INTERNI ADD ON PLATINUM PACK 2026',
    'LAB INTERNI ADD ON SILVER PACK _ LEISHMANIA 2026', 'LAB INTERNI ADD ON GOLD PACK _ LEISHMANIA 2026',
    'LAB INTERNI ADD ON CVIT PACK _ LEISHMANIA 2026'
  ]},
  { categoria: 'Specialistica', piani: [
    'SPECIALISTICA SILVER PACK _ LEISHMANIA 2026', 'SPECIALISTICA GOLD PACK _ LEISHMANIA 2026',
    'SPECIALISTICA CVIT PACK _ LEISHMANIA 2026', 'SPECIALISTICA PLATINUM PACK _ LEISHMANIA 2026',
    'SPECIALISTICA GRAN SASSO SILVER PACK 2026', 'SPECIALISTICA GRAN SASSO GOLD PACK 2026',
    'SPECIALISTICA SILVER PACK 2026', 'SPECIALISTICA GOLD PACK 2026', 'SPECIALISTICA CVIT PACK 2026',
    'SPECIALISTICA PLATINUM PACK 2026'
  ]},
  { categoria: 'Partner e convenzioni', piani: [
    'ZOETIS VOUCHERS FR 2026', 'Platinum Anicura 2026', 'PLATINUM PACK VEZZONI 2026',
    'VET DIAGNOSYS 2026', 'LUXVET GOLD 2026'
  ]},
  { categoria: 'Cataloghi internazionali', piani: [
    'PREISKATALOG GOLD (DE) 2026', 'PREISKATALOG SILVER (DE) 2026', 'PREISKATALOG BASE (DE) 2026',
    'CATÁLOGO DE PREÇOS GOLD (PT) 2026', 'CATÁLOGO DE PREÇOS SILVER (PT) 2026', 'CATÁLOGO DE PREÇOS BÁSICOS (PT) 2026'
  ]},
  { categoria: 'Tariffari', piani: [
    'TARIFFARIO BASE 2026', 'TARIFFARIO COUPON MSD 2026', 'TARIFFARIO PUBBLICO 2026'
  ]}
];

function categoriaDiPiano(nome) {
  for (const g of CATEGORIE) {
    if (g.piani.includes(nome)) return g.categoria;
  }
  return 'Altro';
}

function annoDiPiano(nome) {
  const m = String(nome).match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function upsertFromJson(db, data) {
  const insEsame = db.prepare(`
    INSERT INTO esami_riferimento (nome, prezzo_base) VALUES (?, ?)
    ON CONFLICT(nome) DO UPDATE SET prezzo_base = excluded.prezzo_base
  `);
  const getEsameId = db.prepare(`SELECT id FROM esami_riferimento WHERE nome = ?`);
  const insPiano = db.prepare(`
    INSERT INTO piani_sconto (nome, categoria, anno, ordine, attivo) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(nome) DO UPDATE SET categoria = excluded.categoria, anno = excluded.anno, ordine = excluded.ordine
  `);
  const getPianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = ?`);
  const insPrezzo = db.prepare(`
    INSERT INTO prezzi_piano_esame (piano_id, esame_id, prezzo) VALUES (?, ?, ?)
    ON CONFLICT(piano_id, esame_id) DO UPDATE SET prezzo = excluded.prezzo
  `);

  db.exec('BEGIN');
  try {
    for (const [nomeRaw, prezzo] of Object.entries(data.exams_base_price || {})) {
      insEsame.run(norm(nomeRaw), prezzo);
    }
    const ordine = data.plan_order || Object.keys(data.plans || {});
    ordine.forEach((nomePiano, idx) => {
      insPiano.run(nomePiano, categoriaDiPiano(nomePiano), annoDiPiano(nomePiano), idx);
      const pianoId = getPianoId.get(nomePiano).id;
      for (const [nomeEsameRaw, prezzo] of Object.entries((data.plans || {})[nomePiano] || {})) {
        const esameRow = getEsameId.get(norm(nomeEsameRaw));
        if (esameRow) insPrezzo.run(pianoId, esameRow.id, prezzo);
      }
    });
    db.exec('COMMIT');
    return { piani: ordine.length, esami: Object.keys(data.exams_base_price || {}).length };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedFromJson(db, data) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM piani_sconto`).get().c;
  if (count > 0) return { seeded: false };
  const result = upsertFromJson(db, data);
  return { seeded: true, ...result };
}

module.exports = {
  norm, ensureSchema, categoriaDiPiano, annoDiPiano, CATEGORIE,
  upsertFromJson, seedFromJson
};
