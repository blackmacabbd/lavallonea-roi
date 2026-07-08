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

// Risolve un nome esame (anche parziale/troncato dall'operatore) alla riga canonica
// di esami_riferimento. Strategia conservativa in tre passi:
//   1. match esatto (comportamento storico, sempre preferito);
//   2. sottostringa: un solo canonico che CONTIENE il nome digitato -> risolve;
//      se piu' canonici lo contengono, prova un unico che INIZIA col nome digitato;
//   3. altrimenti null (non si indovina, resta inserimento manuale).
// Motivo: i nomi canonici sono lunghi e l'operatore spesso ne digita solo l'inizio;
// il match esatto falliva e il prezzo restava 0. Vedi lib/piani.test.js.
function risolviEsameCanonico(db, nomeRaw) {
  const nome = norm(nomeRaw);
  if (!nome) return null;

  const exact = db.prepare(`SELECT id, nome, prezzo_base FROM esami_riferimento WHERE nome = ?`).get(nome);
  if (exact) return exact;

  const esc = nome.replace(/[\\%_]/g, c => '\\' + c);
  const contains = db.prepare(
    `SELECT id, nome, prezzo_base FROM esami_riferimento WHERE nome LIKE ? ESCAPE '\\'`
  ).all('%' + esc + '%');

  if (contains.length === 1) return contains[0];
  if (contains.length > 1) {
    const starts = contains.filter(r => r.nome.startsWith(nome));
    if (starts.length === 1) return starts[0];
  }
  return null;
}

function getPrezzoBase(db, esameNomeRaw) {
  const row = risolviEsameCanonico(db, esameNomeRaw);
  return row ? row.prezzo_base : null;
}

function resolvePrezzo(db, pianoId, esameNomeRaw) {
  const nome = norm(esameNomeRaw);
  if (!nome) return { prezzo: null, fonte: 'assente' };

  // L'esame e' "noto" se esiste in esami_riferimento (ha un prezzo base). Questo distingue
  // due casi che altrimenti sembrerebbero identici (nessun prezzo trovato per piano+esame):
  // - esame noto ma con un buco nei dati di QUESTO piano (JSON incompleto/errore) -> fallback
  //   silenzioso al prezzo base, l'operatore non deve inserire nulla a mano;
  // - esame del tutto sconosciuto (mai visto) -> richiede inserimento manuale (vedi 2.3).
  const esameRow = risolviEsameCanonico(db, nome);

  if (esameRow) {
    const viaPiano = db.prepare(`
      SELECT prezzo FROM prezzi_piano_esame WHERE piano_id = ? AND esame_id = ?
    `).get(pianoId, esameRow.id);
    if (viaPiano) return { prezzo: viaPiano.prezzo, fonte: 'piano' };
  }

  const viaCustom = db.prepare(`
    SELECT prezzo FROM prezzi_esami_custom WHERE piano_id = ? AND esame_nome = ?
  `).get(pianoId, nome);
  if (viaCustom) return { prezzo: viaCustom.prezzo, fonte: 'custom' };

  if (esameRow) {
    return { prezzo: esameRow.prezzo_base, fonte: 'base_fallback' };
  }

  return { prezzo: null, fonte: 'assente' };
}

function salvaPrezzoCustom(db, esameNomeRaw, pianoId, prezzo) {
  const nome = norm(esameNomeRaw);
  db.prepare(`
    INSERT INTO prezzi_esami_custom (esame_nome, piano_id, prezzo) VALUES (?, ?, ?)
    ON CONFLICT(esame_nome, piano_id) DO UPDATE SET prezzo = excluded.prezzo, data_inserimento = CURRENT_TIMESTAMP
  `).run(nome, pianoId, prezzo);
}

function pianoMigliorePerEsame(db, esameNomeRaw) {
  const nome = norm(esameNomeRaw);
  if (!nome) return null;

  const rows = db.prepare(`
    SELECT p.id AS piano_id, p.nome AS piano_nome,
      pp.prezzo AS prezzo_piano,
      pc.prezzo AS prezzo_custom,
      er.prezzo_base AS prezzo_base
    FROM piani_sconto p
    LEFT JOIN esami_riferimento er ON er.nome = ?
    LEFT JOIN prezzi_piano_esame pp ON pp.piano_id = p.id AND pp.esame_id = er.id
    LEFT JOIN prezzi_esami_custom pc ON pc.piano_id = p.id AND pc.esame_nome = ?
    WHERE p.attivo = 1
  `).all(nome, nome);

  let best = null;
  for (const r of rows) {
    let prezzo, fonte;
    if (r.prezzo_piano != null) { prezzo = r.prezzo_piano; fonte = 'piano'; }
    else if (r.prezzo_custom != null) { prezzo = r.prezzo_custom; fonte = 'custom'; }
    else if (r.prezzo_base != null) { prezzo = r.prezzo_base; fonte = 'base_fallback'; }
    else continue;
    if (!best || prezzo < best.prezzo) {
      best = { pianoId: r.piano_id, pianoNome: r.piano_nome, prezzo, fonte };
    }
  }
  return best;
}

module.exports = {
  norm, ensureSchema, categoriaDiPiano, annoDiPiano, CATEGORIE,
  upsertFromJson, seedFromJson, getPrezzoBase, resolvePrezzo, salvaPrezzoCustom,
  risolviEsameCanonico, pianoMigliorePerEsame
};
