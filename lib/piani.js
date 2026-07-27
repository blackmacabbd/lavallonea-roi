'use strict';

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Catalogo per-utente: `user_id IS NULL` identifica il TEMPLATE ufficiale
// (popolato dal seed JSON, non appartiene a nessun account); `user_id = N` e' la
// copia privata dell'account N, che puo' modificarla senza toccare gli altri.
function addColIfMissing(db, table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

// Il vecchio schema dichiarava `nome TEXT UNIQUE`: l'auto-index che ne deriva non
// e' eliminabile con DROP INDEX, quindi per i DB gia' esistenti serve un rebuild.
function haUniqueSuSoloNome(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all().some(i => {
    if (!i.unique || i.origin !== 'u') return false;
    const cols = db.prepare(`PRAGMA index_info(${i.name})`).all().map(c => c.name);
    return cols.length === 1 && cols[0] === 'nome';
  });
}

// Rebuild non distruttivo che preserva gli id (referenziati da prezzi_piano_esame
// e da dati_foglio.piano_id). I PRAGMA stanno fuori dalla transazione perche' non
// sono transazionali; il ripristino in `finally` evita di lasciare le FK spente.
function rebuildSenzaUniqueNome(db, table, createSql, colonne) {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    try {
      db.exec(createSql.replace(table, `${table}_new`));
      db.exec(`INSERT INTO ${table}_new (${colonne}) SELECT ${colonne} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

const CREATE_PIANI = `CREATE TABLE piani_sconto (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT NOT NULL,
      categoria TEXT NOT NULL,
      anno      INTEGER,
      ordine    INTEGER NOT NULL,
      attivo    INTEGER NOT NULL DEFAULT 1,
      user_id   INTEGER
    )`;

const CREATE_ESAMI = `CREATE TABLE esami_riferimento (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT NOT NULL,
      prezzo_base REAL NOT NULL,
      user_id     INTEGER
    )`;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS piani_sconto (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT NOT NULL,
      categoria TEXT NOT NULL,
      anno      INTEGER,
      ordine    INTEGER NOT NULL,
      attivo    INTEGER NOT NULL DEFAULT 1,
      user_id   INTEGER
    );

    CREATE TABLE IF NOT EXISTS esami_riferimento (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome        TEXT NOT NULL,
      prezzo_base REAL NOT NULL,
      user_id     INTEGER
    );

    CREATE TABLE IF NOT EXISTS prezzi_piano_esame (
      piano_id INTEGER NOT NULL REFERENCES piani_sconto(id),
      esame_id INTEGER NOT NULL REFERENCES esami_riferimento(id),
      prezzo   REAL NOT NULL,
      PRIMARY KEY (piano_id, esame_id)
    );

    CREATE TABLE IF NOT EXISTS prezzi_esami_custom (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      esame_nome       TEXT NOT NULL,
      piano_id         INTEGER NOT NULL REFERENCES piani_sconto(id),
      user_id          INTEGER,
      prezzo           REAL NOT NULL,
      data_inserimento DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (piano_id, esame_nome, user_id)
    );
  `);

  // Migrazione additiva per i DB creati con lo schema vecchio (senza user_id e
  // con UNIQUE globale su nome, che impedirebbe a due account di avere lo stesso
  // nome piano/esame). Le righe preesistenti restano con user_id NULL: diventano
  // il template ufficiale, quindi nessun dato viene spostato o perso.
  addColIfMissing(db, 'piani_sconto', 'user_id', 'INTEGER');
  addColIfMissing(db, 'esami_riferimento', 'user_id', 'INTEGER');
  if (haUniqueSuSoloNome(db, 'piani_sconto')) {
    rebuildSenzaUniqueNome(db, 'piani_sconto', CREATE_PIANI, 'id, nome, categoria, anno, ordine, attivo, user_id');
  }
  if (haUniqueSuSoloNome(db, 'esami_riferimento')) {
    rebuildSenzaUniqueNome(db, 'esami_riferimento', CREATE_ESAMI, 'id, nome, prezzo_base, user_id');
  }

  // Unicita' del nome separata per template e per singolo account. Indici parziali
  // perche' in SQLite i NULL sono distinti fra loro in un UNIQUE: senza il ramo
  // "WHERE user_id IS NULL" il template accetterebbe nomi duplicati.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_piani_template ON piani_sconto(nome) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_piani_utente   ON piani_sconto(user_id, nome) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_esami_template ON esami_riferimento(nome) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_esami_utente   ON esami_riferimento(user_id, nome) WHERE user_id IS NOT NULL;
  `);

  const cols = db.prepare(`PRAGMA table_info(dati_foglio)`).all().map(c => c.name);
  if (!cols.includes('piano_id')) {
    db.exec(`ALTER TABLE dati_foglio ADD COLUMN piano_id INTEGER REFERENCES piani_sconto(id)`);
  }
}

// Crea la copia privata del catalogo per un account, partendo dal template
// ufficiale. Idempotente: se l'account ha gia' dei piani non fa nulla, cosi' puo'
// essere chiamata a ogni login senza duplicare.
function copiaCatalogoPerUtente(db, userId) {
  const uid = Number(userId);
  if (!uid) return { copiato: false, motivo: 'userId mancante' };
  if (db.prepare(`SELECT 1 FROM piani_sconto WHERE user_id = ? LIMIT 1`).get(uid)) {
    return { copiato: false, motivo: 'copia gia presente' };
  }

  db.exec('BEGIN');
  try {
    const insEsame = db.prepare(`INSERT INTO esami_riferimento (nome, prezzo_base, user_id) VALUES (?, ?, ?)`);
    const mapEsami = new Map();
    for (const e of db.prepare(`SELECT id, nome, prezzo_base FROM esami_riferimento WHERE user_id IS NULL`).all()) {
      mapEsami.set(e.id, Number(insEsame.run(e.nome, e.prezzo_base, uid).lastInsertRowid));
    }

    const insPiano = db.prepare(`
      INSERT INTO piani_sconto (nome, categoria, anno, ordine, attivo, user_id) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const mapPiani = new Map();
    for (const p of db.prepare(`SELECT id, nome, categoria, anno, ordine, attivo FROM piani_sconto WHERE user_id IS NULL`).all()) {
      mapPiani.set(p.id, Number(insPiano.run(p.nome, p.categoria, p.anno, p.ordine, p.attivo, uid).lastInsertRowid));
    }

    const insPrezzo = db.prepare(`INSERT INTO prezzi_piano_esame (piano_id, esame_id, prezzo) VALUES (?, ?, ?)`);
    let nPrezzi = 0;
    const prezziTemplate = db.prepare(`
      SELECT pp.piano_id, pp.esame_id, pp.prezzo
      FROM prezzi_piano_esame pp
      JOIN piani_sconto p ON p.id = pp.piano_id
      WHERE p.user_id IS NULL
    `).all();
    for (const pr of prezziTemplate) {
      const nuovoPiano = mapPiani.get(pr.piano_id);
      const nuovoEsame = mapEsami.get(pr.esame_id);
      if (nuovoPiano && nuovoEsame) { insPrezzo.run(nuovoPiano, nuovoEsame, pr.prezzo); nPrezzi++; }
    }

    db.exec('COMMIT');
    return { copiato: true, piani: mapPiani.size, esami: mapEsami.size, prezzi: nPrezzi };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
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

// Popola/aggiorna il TEMPLATE ufficiale (user_id IS NULL). Le copie private degli
// account non vengono toccate: chi ha gia' la sua copia resta con i suoi prezzi.
// Upsert scritto in modo esplicito (SELECT + INSERT/UPDATE) invece di ON CONFLICT
// perche' l'unicita' del nome ora vive su un indice parziale.
// userId assente -> scrive nel template (usato dal seed al boot); userId presente
// -> scrive nella copia di quell'account, senza toccare template ne' altri account.
function upsertFromJson(db, data, userId) {
  const sc = scopeCatalogo(userId);
  const owner = userId != null ? Number(userId) : null;
  const getEsame = db.prepare(`SELECT id FROM esami_riferimento WHERE nome = ? AND ${sc.sql}`);
  const insEsame = db.prepare(`INSERT INTO esami_riferimento (nome, prezzo_base, user_id) VALUES (?, ?, ?)`);
  const updEsame = db.prepare(`UPDATE esami_riferimento SET prezzo_base = ? WHERE id = ?`);
  const getPiano = db.prepare(`SELECT id FROM piani_sconto WHERE nome = ? AND ${sc.sql}`);
  const insPiano = db.prepare(`INSERT INTO piani_sconto (nome, categoria, anno, ordine, attivo, user_id) VALUES (?, ?, ?, ?, 1, ?)`);
  const updPiano = db.prepare(`UPDATE piani_sconto SET categoria = ?, anno = ?, ordine = ? WHERE id = ?`);
  const insPrezzo = db.prepare(`
    INSERT INTO prezzi_piano_esame (piano_id, esame_id, prezzo) VALUES (?, ?, ?)
    ON CONFLICT(piano_id, esame_id) DO UPDATE SET prezzo = excluded.prezzo
  `);

  db.exec('BEGIN');
  try {
    for (const [nomeRaw, prezzo] of Object.entries(data.exams_base_price || {})) {
      const nome = norm(nomeRaw);
      const row = getEsame.get(nome, ...sc.params);
      if (row) updEsame.run(prezzo, row.id); else insEsame.run(nome, prezzo, owner);
    }
    const ordine = data.plan_order || Object.keys(data.plans || {});
    ordine.forEach((nomePiano, idx) => {
      const esistente = getPiano.get(nomePiano, ...sc.params);
      if (esistente) updPiano.run(categoriaDiPiano(nomePiano), annoDiPiano(nomePiano), idx, esistente.id);
      else insPiano.run(nomePiano, categoriaDiPiano(nomePiano), annoDiPiano(nomePiano), idx, owner);
      const pianoId = getPiano.get(nomePiano, ...sc.params).id;
      for (const [nomeEsameRaw, prezzo] of Object.entries((data.plans || {})[nomePiano] || {})) {
        const esameRow = getEsame.get(norm(nomeEsameRaw), ...sc.params);
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
  const count = db.prepare(`SELECT COUNT(*) AS c FROM piani_sconto WHERE user_id IS NULL`).get().c;
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
// Ambito del catalogo: un account vede SOLO la propria copia; senza account
// (ospite) si legge il template ufficiale. Va applicato a ogni lettura del
// catalogo, altrimenti template e copie di tutti gli account si mescolerebbero.
function scopeCatalogo(userId) {
  return userId != null
    ? { sql: 'user_id = ?', params: [Number(userId)] }
    : { sql: 'user_id IS NULL', params: [] };
}

function risolviEsameCanonico(db, nomeRaw, userId) {
  const nome = norm(nomeRaw);
  if (!nome) return null;
  const sc = scopeCatalogo(userId);

  const exact = db.prepare(`SELECT id, nome, prezzo_base FROM esami_riferimento WHERE nome = ? AND ${sc.sql}`)
    .get(nome, ...sc.params);
  if (exact) return exact;

  const esc = nome.replace(/[\\%_]/g, c => '\\' + c);
  const contains = db.prepare(
    `SELECT id, nome, prezzo_base FROM esami_riferimento WHERE nome LIKE ? ESCAPE '\\' AND ${sc.sql}`
  ).all('%' + esc + '%', ...sc.params);

  if (contains.length === 1) return contains[0];
  if (contains.length > 1) {
    const starts = contains.filter(r => r.nome.startsWith(nome));
    if (starts.length === 1) return starts[0];
  }
  return null;
}

function getPrezzoBase(db, esameNomeRaw, userId) {
  const row = risolviEsameCanonico(db, esameNomeRaw, userId);
  return row ? row.prezzo_base : null;
}

function resolvePrezzo(db, pianoId, esameNomeRaw, userId) {
  const nome = norm(esameNomeRaw);
  if (!nome) return { prezzo: null, fonte: 'assente' };

  // L'esame e' "noto" se esiste in esami_riferimento (ha un prezzo base). Questo distingue
  // due casi che altrimenti sembrerebbero identici (nessun prezzo trovato per piano+esame):
  // - esame noto ma con un buco nei dati di QUESTO piano (JSON incompleto/errore) -> fallback
  //   silenzioso al prezzo base, l'operatore non deve inserire nulla a mano;
  // - esame del tutto sconosciuto (mai visto) -> richiede inserimento manuale (vedi 2.3).
  // L'esame va risolto nella copia dell'account: usare l'id del template
  // insieme a un piano_id dell'account non troverebbe alcun prezzo di piano.
  const esameRow = risolviEsameCanonico(db, nome, userId);

  if (esameRow) {
    const viaPiano = db.prepare(`
      SELECT prezzo FROM prezzi_piano_esame WHERE piano_id = ? AND esame_id = ?
    `).get(pianoId, esameRow.id);
    if (viaPiano) return { prezzo: viaPiano.prezzo, fonte: 'piano' };
  }

  // I prezzi custom sono privati per utente: se non e' fornito uno userId (es. ospite/catalogo),
  // i custom vengono ignorati e si scende direttamente al fallback sul prezzo base.
  if (userId != null) {
    const viaCustom = db.prepare(`
      SELECT prezzo FROM prezzi_esami_custom WHERE piano_id = ? AND esame_nome = ? AND user_id = ?
    `).get(pianoId, nome, userId);
    if (viaCustom) return { prezzo: viaCustom.prezzo, fonte: 'custom' };
  }

  if (esameRow) {
    return { prezzo: esameRow.prezzo_base, fonte: 'base_fallback' };
  }

  return { prezzo: null, fonte: 'assente' };
}

function salvaPrezzoCustom(db, esameNomeRaw, pianoId, prezzo, userId) {
  const nome = norm(esameNomeRaw);
  db.prepare(`
    INSERT INTO prezzi_esami_custom (esame_nome, piano_id, prezzo, user_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(piano_id, esame_nome, user_id) DO UPDATE SET prezzo = excluded.prezzo, data_inserimento = CURRENT_TIMESTAMP
  `).run(nome, pianoId, prezzo, userId);
}

function pianoMigliorePerEsame(db, esameNomeRaw, userId) {
  const nome = norm(esameNomeRaw);
  if (!nome) return null;

  const sc = scopeCatalogo(userId);
  const rows = db.prepare(`
    SELECT p.id AS piano_id, p.nome AS piano_nome,
      pp.prezzo AS prezzo_piano,
      pc.prezzo AS prezzo_custom,
      er.prezzo_base AS prezzo_base
    FROM piani_sconto p
    LEFT JOIN esami_riferimento er ON er.nome = ? AND er.${sc.sql}
    LEFT JOIN prezzi_piano_esame pp ON pp.piano_id = p.id AND pp.esame_id = er.id
    LEFT JOIN prezzi_esami_custom pc ON pc.piano_id = p.id AND pc.esame_nome = ? AND pc.user_id = ?
    WHERE p.attivo = 1 AND p.${sc.sql}
  `).all(nome, ...sc.params, nome, userId != null ? userId : -1, ...sc.params);

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

// Totale del prezzo Mylav di una lista di esami sotto un dato piano.
// esami = [{ nome, n }]. Usa resolvePrezzo (base_fallback per esami non prezzati dal piano);
// gli esami del tutto sconosciuti ('assente') sono esclusi e conteggiati in nSaltati.
function totalePiano(db, pianoId, esami, userId) {
  let totale = 0, nEsami = 0, nSaltati = 0;
  for (const e of (esami || [])) {
    const r = resolvePrezzo(db, pianoId, e.nome, userId);
    if (r.fonte === 'assente' || r.prezzo == null) { nSaltati++; continue; }
    totale += r.prezzo * (Number(e.n) || 1);
    nEsami++;
  }
  return { totale, nEsami, nSaltati };
}

// Piano attivo che minimizza il totale Mylav su TUTTI gli esami passati.
// Ritorna { pianoId, pianoNome, totale, nEsami, nSaltati } oppure null se nessun esame valido.
function pianoMiglioreTotale(db, esami, userId) {
  const lista = (esami || []).filter(e => e && e.nome && String(e.nome).trim());
  if (!lista.length) return null;

  const sc = scopeCatalogo(userId);
  const piani = db.prepare(`SELECT id, nome FROM piani_sconto WHERE attivo = 1 AND ${sc.sql} ORDER BY ordine`).all(...sc.params);
  let best = null;
  for (const p of piani) {
    const t = totalePiano(db, p.id, lista, userId);
    if (t.nEsami === 0) continue; // questo piano non prezza nessuno degli esami
    if (!best || t.totale < best.totale) {
      best = { pianoId: p.id, pianoNome: p.nome, totale: t.totale, nEsami: t.nEsami, nSaltati: t.nSaltati };
    }
  }
  return best;
}

// Classifica di TUTTI i piani attivi per il totale sugli esami dati, dal più
// conveniente (totale minore) al meno. Include solo i piani che prezzano
// almeno un esame valido (nEsami > 0).
function pianiClassifica(db, esami, userId) {
  const lista = (esami || []).filter(e => e && e.nome && String(e.nome).trim());
  if (!lista.length) return [];

  const sc = scopeCatalogo(userId);
  const piani = db.prepare(`SELECT id, nome FROM piani_sconto WHERE attivo = 1 AND ${sc.sql} ORDER BY ordine`).all(...sc.params);
  const out = [];
  for (const p of piani) {
    const t = totalePiano(db, p.id, lista, userId);
    if (t.nEsami === 0) continue;
    out.push({ pianoId: p.id, pianoNome: p.nome, totale: t.totale, nEsami: t.nEsami, nSaltati: t.nSaltati });
  }
  out.sort((a, b) => a.totale - b.totale || a.pianoNome.localeCompare(b.pianoNome, 'it'));
  return out;
}

module.exports = {
  norm, ensureSchema, copiaCatalogoPerUtente, scopeCatalogo, categoriaDiPiano, annoDiPiano, CATEGORIE,
  upsertFromJson, seedFromJson, getPrezzoBase, resolvePrezzo, salvaPrezzoCustom,
  risolviEsameCanonico, pianoMigliorePerEsame, totalePiano, pianoMiglioreTotale,
  pianiClassifica
};
