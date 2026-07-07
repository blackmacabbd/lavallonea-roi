# Piani di Scontistica nel Creatore di ROI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al Calcolatore ROI un selettore di piano di scontistica (60 piani) che autofilla i prezzi Mylav per esame noto, con gestione degli esami sconosciuti (inserimento manuale ricordato) e un pannello di amministrazione per editare/importare i piani.

**Architecture:** Nuovo modulo `lib/piani.js` (logica DB pura, testabile senza Express) importato da `server.js` per schema, seed e nuove rotte API. Frontend (`public/app.js`) aggiunge stato `S.roi.pianoId`/`S.piani`, un componente "pillola + pannello" per la selezione piano, una cascata di autofill sui campi esistenti della tabella ROI, e una nuova vista sidebar per l'amministrazione piani.

**Tech Stack:** Node.js, Express, `node:sqlite` (`DatabaseSync`), `node:test` (nuovo, built-in — nessuna dipendenza da installare) per i test del modulo `lib/piani.js`. Frontend vanilla JS esistente, nessun framework aggiunto.

## Global Constraints

- Nessuna nuova dipendenza npm (usare solo `node:test`/`node:assert` built-in per i test).
- Non toccare il flusso di upload Excel (`parseFoglio1`, `parsePlatinumGold`) — il piano si applica solo al Calcolatore ROI manuale.
- I ROI esistenti (righe `dati_foglio` senza `piano_id`) devono continuare a funzionare identici, nessuna migrazione dati richiesta.
- Riuso della funzione di normalizzazione nomi (`norm`) come unica fonte di verità — non duplicarla.
- Stile UI: seguire le classi CSS esistenti in `public/style.css` (tema chiaro, `#f5a800` accento, `#1a7a4a` verde, `#e8e9eb` bordi) — non introdurre un tema nuovo.

---

### Task 1: Modulo `lib/piani.js` — schema DB

**Files:**
- Create: `lib/piani.js`
- Create: `lib/piani.test.js`
- Modify: `package.json` (aggiungere script `test`)

**Interfaces:**
- Produce: `norm(s: string): string`, `ensureSchema(db: DatabaseSync): void`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `lib/piani.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema, norm } = require('./piani.js');

test('norm lowercases, trims, collapses spaces', () => {
  assert.equal(norm('  Profilo   MYLAV  Base '), 'profilo mylav base');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});

test('ensureSchema creates the four new tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tables.includes('piani_sconto'));
  assert.ok(tables.includes('esami_riferimento'));
  assert.ok(tables.includes('prezzi_piano_esame'));
  assert.ok(tables.includes('prezzi_esami_custom'));
  db.close();
});

test('ensureSchema adds piano_id to dati_foglio and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  ensureSchema(db); // seconda chiamata non deve lanciare errori
  const cols = db.prepare(`PRAGMA table_info(dati_foglio)`).all().map(c => c.name);
  assert.ok(cols.includes('piano_id'));
  db.close();
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test lib`
Expected: FAIL — `Cannot find module './piani.js'`

- [ ] **Step 3: Implementa `lib/piani.js`**

```js
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
```

- [ ] **Step 4: Aggiungi lo script di test a `package.json`**

In `package.json`, dentro `"scripts"`, aggiungi:

```json
"test": "node --test lib"
```

(risultato atteso, sezione scripts completa):
```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test lib"
},
```

- [ ] **Step 5: Esegui i test, verifica che passino**

Run: `npm test`
Expected: PASS — 3 test, 0 fallimenti

- [ ] **Step 6: Commit**

```bash
git add lib/piani.js lib/piani.test.js package.json
git commit -m "feat(roi-piani): schema DB per piani di scontistica"
```

---

### Task 2: Modulo `lib/piani.js` — categorizzazione, anno, seed/import idempotente

**Files:**
- Modify: `lib/piani.js`
- Modify: `lib/piani.test.js`

**Interfaces:**
- Consumes: `norm`, `ensureSchema` (Task 1)
- Produces: `categoriaDiPiano(nome: string): string`, `annoDiPiano(nome: string): number|null`, `upsertFromJson(db, data): {piani: number, esami: number}`, `seedFromJson(db, data): {seeded: boolean, piani?: number, esami?: number}`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in fondo a `lib/piani.test.js`:

```js
const { categoriaDiPiano, annoDiPiano, upsertFromJson, seedFromJson } = require('./piani.js');

test('categoriaDiPiano classifica i piani noti, fallback ad Altro', () => {
  assert.equal(categoriaDiPiano('GOLD PACK 2026'), 'Pacchetti standard');
  assert.equal(categoriaDiPiano('TITANIUM SILVER PACK _ LEISHMANIA 2026'), 'Titanium');
  assert.equal(categoriaDiPiano('PIANO INESISTENTE 2099'), 'Altro');
});

test('annoDiPiano estrae l\'anno finale dal nome', () => {
  assert.equal(annoDiPiano('GOLD PACK 2026'), 2026);
  assert.equal(annoDiPiano('Nessun anno qui'), null);
});

function dbConTabelle() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  return db;
}

test('seedFromJson popola le tabelle ed e\' idempotente', () => {
  const db = dbConTabelle();
  const data = {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: {
      'GOLD PACK 2026': { 'ESAME A': 8 },
      'SILVER PACK 2026': { 'ESAME A': 9, 'ESAME B': 18 }
    },
    plan_order: ['GOLD PACK 2026', 'SILVER PACK 2026']
  };

  const r1 = seedFromJson(db, data);
  assert.equal(r1.seeded, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM esami_riferimento').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM prezzi_piano_esame').get().c, 3);

  const r2 = seedFromJson(db, data);
  assert.equal(r2.seeded, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 2);
  db.close();
});

test('upsertFromJson aggiorna i prezzi su import ripetuto', () => {
  const db = dbConTabelle();
  const dataV1 = {
    exams_base_price: { 'ESAME A': 10 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 8 } },
    plan_order: ['GOLD PACK 2026']
  };
  upsertFromJson(db, dataV1);

  const dataV2 = {
    exams_base_price: { 'ESAME A': 11 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 7 } },
    plan_order: ['GOLD PACK 2026']
  };
  upsertFromJson(db, dataV2);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 1);
  assert.equal(db.prepare('SELECT prezzo_base FROM esami_riferimento WHERE nome = ?').get('esame a').prezzo_base, 11);
  const prezzo = db.prepare(`
    SELECT pp.prezzo FROM prezzi_piano_esame pp
    JOIN piani_sconto p ON p.id = pp.piano_id
    WHERE p.nome = 'GOLD PACK 2026'
  `).get();
  assert.equal(prezzo.prezzo, 7);
  db.close();
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `npm test`
Expected: FAIL — `categoriaDiPiano is not a function` (e simili per le altre funzioni nuove)

- [ ] **Step 3: Implementa in `lib/piani.js`**

Aggiungi in fondo al file, prima di `module.exports`:

```js
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
```

Aggiorna `module.exports`:

```js
module.exports = {
  norm, ensureSchema, categoriaDiPiano, annoDiPiano, CATEGORIE,
  upsertFromJson, seedFromJson
};
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `npm test`
Expected: PASS — 7 test, 0 fallimenti

- [ ] **Step 5: Commit**

```bash
git add lib/piani.js lib/piani.test.js
git commit -m "feat(roi-piani): categorizzazione piani, seed e import idempotenti"
```

---

### Task 3: Modulo `lib/piani.js` — risoluzione prezzo (cascata) e sconti custom

**Files:**
- Modify: `lib/piani.js`
- Modify: `lib/piani.test.js`

**Interfaces:**
- Consumes: `norm` (Task 1)
- Produces: `getPrezzoBase(db, esameNome): number|null`, `resolvePrezzo(db, pianoId, esameNome): {prezzo: number|null, fonte: 'piano'|'custom'|'assente'}`, `salvaPrezzoCustom(db, esameNome, pianoId, prezzo): void`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in fondo a `lib/piani.test.js`:

```js
const { getPrezzoBase, resolvePrezzo, salvaPrezzoCustom } = require('./piani.js');

function dbConSeed() {
  const db = dbConTabelle();
  seedFromJson(db, {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 8 } },
    plan_order: ['GOLD PACK 2026']
  });
  return db;
}

test('getPrezzoBase restituisce il prezzo base per esame noto, null per sconosciuto', () => {
  const db = dbConSeed();
  assert.equal(getPrezzoBase(db, 'Esame A'), 10);
  assert.equal(getPrezzoBase(db, 'Non Esiste'), null);
  db.close();
});

test('resolvePrezzo trova il prezzo dal piano quando presente', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'esame a');
  assert.deepEqual(r, { prezzo: 8, fonte: 'piano' });
  db.close();
});

test('resolvePrezzo cade sul custom se il piano non ha quell\'esame', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15);
  const r = resolvePrezzo(db, pianoId, 'ESAME NUOVO');
  assert.deepEqual(r, { prezzo: 15, fonte: 'custom' });
  db.close();
});

test('resolvePrezzo cade sul prezzo base se l\'esame e\' noto ma manca nel listino di quel piano (dato incompleto)', () => {
  const db = dbConSeed();
  // 'ESAME B' esiste in exams_base_price ma non e' stato prezzato per GOLD PACK 2026 nel seed di test
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'esame b');
  assert.deepEqual(r, { prezzo: 20, fonte: 'base_fallback' });
  db.close();
});

test('resolvePrezzo restituisce assente solo se l\'esame e\' del tutto sconosciuto (mai visto ne\' come base ne\' come custom)', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'boh mai sentito');
  assert.deepEqual(r, { prezzo: null, fonte: 'assente' });
  db.close();
});

test('salvaPrezzoCustom aggiorna se richiamata due volte sulla stessa combinazione', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15);
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 18);
  const r = resolvePrezzo(db, pianoId, 'esame nuovo');
  assert.equal(r.prezzo, 18);
  db.close();
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `npm test`
Expected: FAIL — `getPrezzoBase is not a function` (e simili)

- [ ] **Step 3: Implementa in `lib/piani.js`**

Aggiungi prima di `module.exports`:

```js
function getPrezzoBase(db, esameNomeRaw) {
  const nome = norm(esameNomeRaw);
  const row = db.prepare(`SELECT prezzo_base FROM esami_riferimento WHERE nome = ?`).get(nome);
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
  const esameRow = db.prepare(`SELECT id, prezzo_base FROM esami_riferimento WHERE nome = ?`).get(nome);

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
```

Aggiorna `module.exports`:

```js
module.exports = {
  norm, ensureSchema, categoriaDiPiano, annoDiPiano, CATEGORIE,
  upsertFromJson, seedFromJson, getPrezzoBase, resolvePrezzo, salvaPrezzoCustom
};
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `npm test`
Expected: PASS — 14 test, 0 fallimenti

- [ ] **Step 5: Commit**

```bash
git add lib/piani.js lib/piani.test.js
git commit -m "feat(roi-piani): cascata risoluzione prezzo e sconti custom"
```

---

### Task 4: `server.js` — boot seed, rotte pubbliche, autocomplete esteso

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `piani.ensureSchema`, `piani.seedFromJson`, `piani.norm`, `piani.resolvePrezzo`, `piani.getPrezzoBase`, `piani.salvaPrezzoCustom` (Tasks 1-3)
- Produces: `GET /api/piani`, `GET /api/piani/:id/prezzo`, `GET /api/esami-riferimento/prezzo-base`, `POST /api/prezzi-custom`; `GET /api/esami/autocomplete` esteso

- [ ] **Step 1: Importa il modulo e sostituisci la `norm` locale**

In `server.js`, subito dopo `const fs = require('fs');`, aggiungi:

```js
const piani = require('./lib/piani');
```

Trova questa riga (nella sezione `// ── Excel helpers ──────────────────────────`):

```js
function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
```

Sostituiscila con:

```js
const norm = piani.norm;
```

- [ ] **Step 2: Chiama `ensureSchema` e il seed dopo la creazione del DB**

Trova, subito dopo il blocco di migrazione esistente:

```js
// Migra vecchio schema se necessario
try {
  db.prepare('SELECT listino_concorrenza FROM dati_foglio LIMIT 1').get();
} catch (_) {
  db.exec('DROP TABLE IF EXISTS dati_foglio');
  db.exec(`CREATE TABLE dati_foglio ( ... )`);
}
```

Subito dopo questo blocco (prima di `// ── Multer`), aggiungi:

```js
// ── Piani di scontistica ────────────────────────────
piani.ensureSchema(db);
try {
  const seedPath = path.join(__dirname, 'piani_sconto_esami_2026.json');
  if (fs.existsSync(seedPath)) {
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const seedResult = piani.seedFromJson(db, seedData);
    if (seedResult.seeded) {
      console.log(`  ✓ Seed piani sconto: ${seedResult.piani} piani, ${seedResult.esami} esami`);
    }
  }
} catch (err) {
  console.error('Seed piani sconto fallito:', err.message);
}
```

- [ ] **Step 3: Estendi l'autocomplete esistente**

Trova:

```js
app.get('/api/esami/autocomplete', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const rows = db.prepare(
      `SELECT DISTINCT esame FROM dati_foglio WHERE esame LIKE ? ORDER BY esame LIMIT 20`
    ).all(`%${q}%`);
    res.json(rows.map(r => r.esame));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

Sostituiscilo con:

```js
app.get('/api/esami/autocomplete', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT esame AS nome FROM dati_foglio WHERE esame LIKE ?
      UNION
      SELECT nome FROM esami_riferimento WHERE nome LIKE ?
      UNION
      SELECT esame_nome AS nome FROM prezzi_esami_custom WHERE esame_nome LIKE ?
      ORDER BY nome LIMIT 20
    `).all(like, like, like);
    res.json(rows.map(r => r.nome));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 4: Aggiungi le nuove rotte pubbliche**

Subito dopo la rotta `/api/esami/prezzi` esistente, aggiungi:

```js
app.get('/api/piani', (req, res) => {
  try {
    const all = req.query.all === '1';
    const rows = all
      ? db.prepare(`SELECT id, nome, categoria, ordine, attivo FROM piani_sconto ORDER BY ordine`).all()
      : db.prepare(`SELECT id, nome, categoria, ordine FROM piani_sconto WHERE attivo = 1 ORDER BY ordine`).all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piani/:id/prezzo', (req, res) => {
  try {
    const { esame } = req.query;
    if (!esame) return res.status(400).json({ error: 'Parametro esame mancante' });
    const result = piani.resolvePrezzo(db, Number(req.params.id), esame);
    if (result.fonte === 'base_fallback') {
      console.warn(`Prezzo mancante per piano ${req.params.id}, esame "${esame}" — uso il prezzo base come fallback`);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/esami-riferimento/prezzo-base', (req, res) => {
  try {
    const { nome } = req.query;
    res.json({ prezzo_base: nome ? piani.getPrezzoBase(db, nome) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/prezzi-custom', express.json(), (req, res) => {
  try {
    const { esame_nome, piano_id, prezzo } = req.body || {};
    if (!esame_nome || !piano_id || prezzo == null) {
      return res.status(400).json({ error: 'Dati mancanti (esame_nome, piano_id, prezzo)' });
    }
    piani.salvaPrezzoCustom(db, esame_nome, Number(piano_id), Number(prezzo));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 5: Verifica manuale**

Run: `npm start`
Expected: console mostra `✓ Seed piani sconto: 60 piani, 32 esami` (solo al primo avvio con DB vuoto)

Poi, con il server attivo:
```bash
curl http://localhost:3000/api/piani
```
Expected: array JSON con 60 oggetti `{id, nome, categoria, ordine}`

```bash
curl "http://localhost:3000/api/piani/1/prezzo?esame=PROFILO%20MYLAV%20BASE%20(ex%20Profilo%201)"
```
Expected: `{"prezzo":<numero>,"fonte":"piano"}`

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(roi-piani): seed al boot, rotte piani/prezzo, autocomplete esteso"
```

---

### Task 5: `server.js` — rotte amministrazione piani e `piano_id` in `/api/calcolo/salva`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `piani.upsertFromJson`, `piani.norm`, `piani.categoriaDiPiano`, `piani.annoDiPiano` (Task 2)
- Produces: `GET /api/piani/:id`, `PUT /api/piani/:id/prezzi`, `PUT /api/piani/:id/attivo`, `POST /api/piani/import`; `/api/calcolo/salva` accetta `piano_id` opzionale

- [ ] **Step 1: Aggiungi le rotte di amministrazione**

Subito dopo le rotte aggiunte nel Task 4, aggiungi:

```js
app.get('/api/piani/:id', (req, res) => {
  try {
    const piano = db.prepare(`SELECT * FROM piani_sconto WHERE id = ?`).get(req.params.id);
    if (!piano) return res.status(404).json({ error: 'Piano non trovato' });
    const prezzi = db.prepare(`
      SELECT er.id AS esame_id, er.nome AS esame_nome, er.prezzo_base, pp.prezzo
      FROM esami_riferimento er
      LEFT JOIN prezzi_piano_esame pp ON pp.esame_id = er.id AND pp.piano_id = ?
      ORDER BY er.nome
    `).all(req.params.id);
    res.json({ piano, prezzi });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/piani/:id/prezzi', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const { prezzi } = req.body || {};
    if (!Array.isArray(prezzi)) return res.status(400).json({ error: 'Formato non valido, atteso { prezzi: [...] }' });
    const upsert = db.prepare(`
      INSERT INTO prezzi_piano_esame (piano_id, esame_id, prezzo) VALUES (?, ?, ?)
      ON CONFLICT(piano_id, esame_id) DO UPDATE SET prezzo = excluded.prezzo
    `);
    db.exec('BEGIN');
    try {
      for (const r of prezzi) upsert.run(req.params.id, r.esame_id, r.prezzo);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ success: true, aggiornati: prezzi.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/piani/:id/attivo', express.json(), (req, res) => {
  try {
    const { attivo } = req.body || {};
    db.prepare(`UPDATE piani_sconto SET attivo = ? WHERE id = ?`).run(attivo ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/piani/import', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.plans || !data.exams_base_price) {
      return res.status(400).json({ error: 'JSON non nel formato atteso (servono exams_base_price e plans)' });
    }
    const result = piani.upsertFromJson(db, data);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: Aggiungi `piano_id` a `/api/calcolo/salva`**

Trova:

```js
app.post('/api/calcolo/salva', express.json(), (req, res) => {
  try {
    const { struttura: strutturaNome, foglio, righe, nomeFile } = req.body || {};
```

Sostituisci la riga di destructuring con:

```js
app.post('/api/calcolo/salva', express.json(), (req, res) => {
  try {
    const { struttura: strutturaNome, foglio, righe, nomeFile, piano_id } = req.body || {};
```

Poi trova, nello stesso handler:

```js
      const ins = db.prepare(`
        INSERT INTO dati_foglio
          (file_id, foglio, esame, n_esami,
           listino_concorrenza, totale_concorrenza, prezzo_scontato_concorrenza,
           listino_lav, totale_listino_lav, prezzo_scontato_lav, totale_scontato_lav,
           risparmio_dottore, sconto_concorrenza, sconto_lav)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
```

Sostituisci con:

```js
      const ins = db.prepare(`
        INSERT INTO dati_foglio
          (file_id, foglio, esame, n_esami,
           listino_concorrenza, totale_concorrenza, prezzo_scontato_concorrenza,
           listino_lav, totale_listino_lav, prezzo_scontato_lav, totale_scontato_lav,
           risparmio_dottore, sconto_concorrenza, sconto_lav, piano_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
```

Poi trova, subito sotto:

```js
      for (const r of righe) {
        const n        = r.n_esami || 1;
        const lConc    = r.listino_concorrenza || 0;
        const tConc    = lConc * n;
        const pConc    = parseFloat((tConc * 0.9).toFixed(2));
        const lLav     = r.listino_lav || 0;
        const tLLav    = lLav * n;
        const pLav     = r.prezzo_scontato_lav || 0;
        const tPLav    = pLav * n;
        ins.run(fileId, foglio, r.esame, n,
          lConc, tConc, pConc, lLav, tLLav, pLav, tPLav,
          pConc - tPLav, tConc - pConc, tLLav - tPLav);
      }
```

Sostituisci l'ultima riga (`ins.run(...)`) con:

```js
        ins.run(fileId, foglio, r.esame, n,
          lConc, tConc, pConc, lLav, tLLav, pLav, tPLav,
          pConc - tPLav, tConc - pConc, tLLav - tPLav, piano_id || null);
```

- [ ] **Step 3: Verifica manuale**

Run: `npm start`

```bash
curl http://localhost:3000/api/piani/1
```
Expected: `{"piano": {...}, "prezzi": [ ... 32 righe ... ]}`

```bash
curl -X PUT http://localhost:3000/api/piani/1/attivo -H "Content-Type: application/json" -d "{\"attivo\": 0}"
curl "http://localhost:3000/api/piani?all=1" | grep -o "\"attivo\":0" | head -1
```
Expected: trova almeno una occorrenza di `"attivo":0`

Riattiva prima di continuare:
```bash
curl -X PUT http://localhost:3000/api/piani/1/attivo -H "Content-Type: application/json" -d "{\"attivo\": 1}"
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(roi-piani): rotte amministrazione piani, piano_id in calcolo/salva"
```

---

### Task 6: `public/style.css` — stili per selettore piano e stato "nuovo prezzo"

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Aggiungi le nuove classi**

Trova il blocco `.roi-ac-item:hover { background: #fff9e6; }` (subito prima del commento `UTILITY`) e aggiungi subito dopo:

```css
.roi-piano-btn { white-space: nowrap; border-radius: 20px; }

.roi-piano-panel {
  position: absolute;
  top: 38px;
  right: 0;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e8e9eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  padding: 10px;
  z-index: 300;
}

.roi-piano-categoria {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #6b7280;
  margin: 10px 0 4px;
}
.roi-piano-categoria:first-of-type { margin-top: 4px; }

.roi-piano-item {
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.roi-piano-item:hover { background: #fff9e6; }

.roi-prezzo-nuovo { border-color: #f5a800 !important; background: #fffdf0; }
```

- [ ] **Step 2: Verifica manuale**

Nessun test automatico per il CSS puro — verrà verificato visivamente nel Task 7/8 quando il markup che usa queste classi esiste.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat(roi-piani): stili selettore piano e badge esame nuovo"
```

---

### Task 7: `public/app.js` — selettore piano (pillola + pannello ricerca/categorie)

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/piani` (Task 4), `escHtml`, `el`, `reRenderRoiTable`, `S.roi` (esistenti)
- Produces: `S.piani: Array<{id,nome,categoria,ordine}>`, `S.roi.pianoId: number|null`, `loadPiani(): Promise<void>`, `pianoSelezionatoNome(): string|null`, `togglePianoPanel(): void`, `renderPianoPanel(filtro: string): void`, `selezionaPiano(id: number|null): void`

- [ ] **Step 1: Aggiungi lo stato**

Trova:

```js
const S = {
  strutture: [],
  expanded:  {},
  vistaMia:  true,
  charts:    {},
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    tab: 'Platinum',
    struttura: '',
    righe: {
      'Foglio 1': [roiRigaVuota()],
      'Platinum': [roiRigaVuota()],
      'Gold':     [roiRigaVuota()]
    }
  }
};
```

Sostituisci con:

```js
const S = {
  strutture: [],
  expanded:  {},
  vistaMia:  true,
  charts:    {},
  piani:     [],
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    tab: 'Platinum',
    struttura: '',
    pianoId: null,
    righe: {
      'Foglio 1': [roiRigaVuota()],
      'Platinum': [roiRigaVuota()],
      'Gold':     [roiRigaVuota()]
    }
  }
};
```

- [ ] **Step 2: Aggiungi `loadPiani` e richiamala in `init`**

Trova:

```js
// ── Sidebar ────────────────────────────────────────
async function loadStrutture() {
  S.strutture = await api('/api/strutture');
}
```

Aggiungi subito dopo:

```js
async function loadPiani() {
  S.piani = await api('/api/piani');
}
```

Trova:

```js
// ── Init ───────────────────────────────────────────
async function init() {
  await loadStrutture();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}
```

Sostituisci con:

```js
// ── Init ───────────────────────────────────────────
async function init() {
  await loadStrutture();
  await loadPiani();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}
```

- [ ] **Step 3: Aggiungi il markup della pillola in `buildRoiSectionHtml`**

Trova:

```js
  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:500;color:#1a1a1a">Calcolatore ROI</div>
      <div class="roi-tabs-wrap">${tabHtml}</div>
    </div>
```

Sostituisci con:

```js
  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:500;color:#1a1a1a">Calcolatore ROI</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="roi-tabs-wrap">${tabHtml}</div>
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn" id="roi-piano-btn"
                  onclick="togglePianoPanel()" title="${escHtml(pianoSelezionatoNome() || '')}">
            Piano: ${escHtml(pianoSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Aggiungi le funzioni del selettore**

Aggiungi subito prima di `function buildRoiTableHtml(tipo) {`:

```js
function pianoSelezionatoNome() {
  const p = S.piani.find(p => p.id === S.roi.pianoId);
  return p ? p.nome : null;
}

function togglePianoPanel() {
  const panel = el('roi-piano-panel');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) renderPianoPanel('');
}

function renderPianoPanel(filtro) {
  const panel = el('roi-piano-panel');
  if (!panel) return;
  const f = filtro.trim().toLowerCase();
  const filtrati = S.piani.filter(p => !f || p.nome.toLowerCase().includes(f));
  const perCategoria = {};
  filtrati.forEach(p => { (perCategoria[p.categoria] = perCategoria[p.categoria] || []).push(p); });

  let html = `<input class="roi-input" id="roi-piano-search" placeholder="🔍 Cerca piano..."
    value="${escHtml(filtro)}" oninput="renderPianoPanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaPiano(null)" style="font-style:italic">— Nessun piano —</div>`;
  for (const [categoria, items] of Object.entries(perCategoria)) {
    html += `<div class="roi-piano-categoria">${escHtml(categoria)}</div>`;
    items.forEach(p => {
      html += `<div class="roi-piano-item" onclick="selezionaPiano(${p.id})">${escHtml(p.nome)}</div>`;
    });
  }
  panel.innerHTML = html;
  const inp = el('roi-piano-search');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function selezionaPiano(id) {
  S.roi.pianoId = id;
  const panel = el('roi-piano-panel');
  if (panel) panel.style.display = 'none';
  const btn = el('roi-piano-btn');
  if (btn) {
    btn.textContent = `Piano: ${pianoSelezionatoNome() || 'Nessuno'} ▾`;
    btn.title = pianoSelezionatoNome() || '';
  }
  const tbody = el('roi-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaPrezziAutomatici(tr));
  }
}
```

Nota: `aggiornaPrezziAutomatici` viene definita nel Task 8 — questo task lascia una chiamata "in avanti" che sarà risolta in quel momento (funzione dichiarata con `function`, hoisted, nessun errore a runtime finché il Task 8 è completato prima di eseguire il flusso end-to-end).

- [ ] **Step 5: Verifica manuale (parziale, `aggiornaPrezziAutomatici` non ancora implementata)**

Run: `npm start`, apri `http://localhost:3000`, vai in Dashboard.
Expected: sotto i tab del Calcolatore ROI appare il pulsante "Piano: Nessuno ▾". Cliccandolo si apre il pannello con la ricerca e le categorie. Digitando "gold" la lista si filtra. Cliccando un piano il pulsante si aggiorna con il nome scelto (troncabile via CSS più avanti se necessario) e il pannello si chiude. Nessun errore in console **tranne** un possibile `ReferenceError: aggiornaPrezziAutomatici is not defined` se hai già righe in tabella al momento della selezione — atteso, verrà risolto nel Task 8.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(roi-piani): selettore piano pillola con ricerca e categorie"
```

---

### Task 8: `public/app.js` — cascata autofill prezzo e gestione esame sconosciuto

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/esami-riferimento/prezzo-base`, `GET /api/piani/:id/prezzo`, `POST /api/prezzi-custom` (Task 4), `S.roi.pianoId` (Task 7), `aggiornaRigaDOM` (esistente)
- Produces: `aggiornaPrezziAutomatici(tr: HTMLElement): Promise<void>`

- [ ] **Step 1: Aggiungi `aggiornaPrezziAutomatici`**

Trova la funzione `aggiornaRigaDOM(tr)` esistente e aggiungi **subito prima**:

```js
async function aggiornaPrezziAutomatici(tr) {
  const esameInp = tr.querySelector('[data-col="esame"]');
  const llInp    = tr.querySelector('[data-col="listino_lav"]');
  const plInp    = tr.querySelector('[data-col="prezzo_scontato_lav"]');
  if (!esameInp || !llInp || !plInp) return;
  const esame = esameInp.value.trim();
  if (!esame) return;

  const baseResp = await fetch(`/api/esami-riferimento/prezzo-base?nome=${encodeURIComponent(esame)}`)
    .then(r => r.json()).catch(() => ({}));
  if (baseResp.prezzo_base != null && (llInp.value === '' || llInp.dataset.auto === '1')) {
    llInp.value = baseResp.prezzo_base;
    llInp.dataset.auto = '1';
  }

  if (S.roi.pianoId) {
    const pResp = await fetch(`/api/piani/${S.roi.pianoId}/prezzo?esame=${encodeURIComponent(esame)}`)
      .then(r => r.json()).catch(() => ({}));
    plInp.classList.remove('roi-prezzo-nuovo');
    if (pResp.fonte === 'piano' || pResp.fonte === 'custom' || pResp.fonte === 'base_fallback') {
      plInp.value = pResp.prezzo;
      plInp.dataset.auto = '1';
      plInp.title = pResp.fonte === 'piano' ? 'Prezzo automatico dal piano'
        : pResp.fonte === 'custom' ? 'Prezzo personalizzato salvato in precedenza'
        : 'Prezzo del piano non disponibile per questo esame — mostrato il prezzo base';
    } else {
      plInp.dataset.auto = '0';
      plInp.title = '';
      if (!plInp.value) plInp.classList.add('roi-prezzo-nuovo');
    }
  } else {
    plInp.dataset.auto = '0';
    plInp.title = '';
    plInp.classList.remove('roi-prezzo-nuovo');
  }

  aggiornaRigaDOM(tr);
}
```

- [ ] **Step 2: Aggancia il flusso su blur del campo esame e del campo prezzo**

Trova, dentro `initRoiEvents()`:

```js
  wrap.addEventListener('keydown', e => {
```

Aggiungi **subito prima** un nuovo listener in fase di cattura (necessario perché `blur` non fa bubbling):

```js
  wrap.addEventListener('blur', async e => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('.roi-input')) return;
    const tr = inp.closest('tr');
    if (!tr) return;

    if (inp.dataset.col === 'esame') {
      await aggiornaPrezziAutomatici(tr);
    }

    if (inp.dataset.col === 'prezzo_scontato_lav' && S.roi.pianoId && inp.dataset.auto === '0' && inp.value.trim()) {
      const esameInp = tr.querySelector('[data-col="esame"]');
      const esame = esameInp ? esameInp.value.trim() : '';
      if (esame) {
        await fetch('/api/prezzi-custom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ esame_nome: esame, piano_id: S.roi.pianoId, prezzo: parseFloat(inp.value) || 0 })
        });
        inp.dataset.auto = '1';
        inp.classList.remove('roi-prezzo-nuovo');
        inp.title = 'Prezzo personalizzato salvato';
      }
    }
  }, true);

  wrap.addEventListener('keydown', e => {
```

- [ ] **Step 3: Verifica manuale end-to-end**

Run: `npm start`, apri `http://localhost:3000`.

1. Vai al Calcolatore ROI, tab Platinum. Non selezionare nessun piano. Scrivi un esame noto (es. "Profilo Mylav Base") nella prima riga, esci dal campo (Tab o click altrove).
   Expected: il campo "Listino Lav" si autocompila con `32` (prezzo base). Il campo "Prezzo Lav" resta vuoto/manuale (nessun piano selezionato).

2. Clicca "Piano: Nessuno ▾", cerca e seleziona "GOLD PACK 2026".
   Expected: il campo "Prezzo Lav" della riga già compilata si autocompila da solo col prezzo Gold Pack per quell'esame, con bordo/badge che indica "auto" (`title` al passaggio del mouse: "Prezzo automatico dal piano").

3. Scrivi un esame NON esistente (es. "Esame Fantasia XYZ") in una nuova riga, esci dal campo.
   Expected: "Prezzo Lav" resta vuoto con bordo giallo (classe `roi-prezzo-nuovo`).

4. Scrivi un prezzo manuale in quel campo (es. `42`), esci dal campo.
   Expected: bordo giallo sparisce, richiesta di rete verso `/api/prezzi-custom` visibile nel tab Network (status 200).

5. Cambia tab (es. vai su Gold), poi torna su Platinum, riscrivi lo stesso esame "Esame Fantasia XYZ" con lo stesso piano Gold Pack selezionato.
   Expected: "Prezzo Lav" si autocompila da solo con `42` (il valore custom salvato).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(roi-piani): autofill prezzo cascata + memoria esami sconosciuti"
```

---

### Task 9: `public/app.js` — pannello amministrazione piani

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/piani?all=1`, `GET /api/piani/:id`, `PUT /api/piani/:id/prezzi`, `PUT /api/piani/:id/attivo`, `POST /api/piani/import` (Task 5), `navigate`, `buildSidebar`, `fmtE`, `escHtml` (esistenti)
- Produces: nuova vista `navigate('piani')`; `renderPiani()`, `togglePianoAttivo(id, attivo)`, `renderPianoEdit(id)`, `salvaPianoPrezzi(id)`, `importaPianiJson(inputEl)`

- [ ] **Step 1: Aggiungi la voce di navigazione in sidebar**

Trova, in `buildSidebar()`:

```js
    <div class="nav-item ${isActive('debug')}" onclick="navigate('debug')" style="color:#f5a800">
      <span class="nav-icon">🔍</span> Debug Excel
    </div>
  `;
```

Sostituisci con:

```js
    <div class="nav-item ${isActive('debug')}" onclick="navigate('debug')" style="color:#f5a800">
      <span class="nav-icon">🔍</span> Debug Excel
    </div>
    <div class="nav-item ${isActive('piani')}" onclick="navigate('piani')">
      <span class="nav-icon">💰</span> Gestione piani
    </div>
  `;
```

- [ ] **Step 2: Aggiungi il case nello switch di `navigate`**

Trova:

```js
  switch (view) {
    case 'dashboard':  renderDashboard();                              break;
    case 'foglio':     renderFoglio(params.fileId, params.foglio);     break;
    case 'totali':     renderTotali(params.strutturaId, params.nome);  break;
    case 'cronologia': renderCronologia();                             break;
    case 'confronto':  renderConfronto();                              break;
    case 'debug':      renderDebug();                                  break;
  }
```

Sostituisci con:

```js
  switch (view) {
    case 'dashboard':  renderDashboard();                              break;
    case 'foglio':     renderFoglio(params.fileId, params.foglio);     break;
    case 'totali':     renderTotali(params.strutturaId, params.nome);  break;
    case 'cronologia': renderCronologia();                             break;
    case 'confronto':  renderConfronto();                              break;
    case 'debug':      renderDebug();                                  break;
    case 'piani':      renderPiani();                                  break;
  }
```

- [ ] **Step 3: Aggiungi le funzioni della vista, dopo `renderDebug()`**

```js
// ── Gestione piani ──────────────────────────────────
async function renderPiani() {
  let elenco;
  try { elenco = await api('/api/piani?all=1'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore</div><div class="empty-sub">${e.message}</div></div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Gestione piani di scontistica</div>
        <div class="page-subtitle">${elenco.length} piani (attivi e disattivati)</div>
      </div>
      <div class="page-actions">
        <label class="btn-outline" for="piani-import-input">📥 Importa listino JSON</label>
        <input type="file" id="piani-import-input" accept=".json" style="display:none" onchange="importaPianiJson(this)">
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Nome</th><th>Categoria</th><th>Anno</th><th>Attivo</th><th></th></tr></thead>
            <tbody>
              ${elenco.map(p => `<tr>
                <td>${p.nome}</td>
                <td class="td-muted">${p.categoria}</td>
                <td class="td-muted">${p.anno || '—'}</td>
                <td>${p.attivo ? '✅' : '❌'}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="togglePianoAttivo(${p.id}, ${p.attivo ? 0 : 1})">${p.attivo ? 'Disattiva' : 'Attiva'}</button>
                  <button class="btn-outline" onclick="renderPianoEdit(${p.id})">Modifica prezzi</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="piano-edit-wrap"></div>
    </div>
  `);
}

async function togglePianoAttivo(id, attivo) {
  await fetch(`/api/piani/${id}/attivo`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attivo })
  });
  await loadPiani();
  renderPiani();
}

async function renderPianoEdit(id) {
  const data = await api(`/api/piani/${id}`);
  const wrap = el('piano-edit-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Prezzi — ${data.piano.nome}</div>
      <table class="roi-editable-table">
        <thead><tr><th>Esame</th><th>Prezzo base</th><th>Prezzo per questo piano</th></tr></thead>
        <tbody>
          ${data.prezzi.map(p => `<tr>
            <td>${p.esame_nome}</td>
            <td class="td-muted">${fmtE(p.prezzo_base)}</td>
            <td><input class="roi-input roi-num" data-esame-id="${p.esame_id}" value="${p.prezzo != null ? p.prezzo : ''}" placeholder="0.00"></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <button class="btn-primary mt-4" onclick="salvaPianoPrezzi(${id})">Salva prezzi</button>
    </div>
  `;
}

async function salvaPianoPrezzi(id) {
  const wrap = el('piano-edit-wrap');
  const inputs = wrap.querySelectorAll('[data-esame-id]');
  const prezzi = Array.from(inputs)
    .map(inp => ({ esame_id: Number(inp.dataset.esameId), prezzo: parseFloat(inp.value) }))
    .filter(p => !isNaN(p.prezzo));
  await fetch(`/api/piani/${id}/prezzi`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prezzi })
  });
  alert('Prezzi salvati.');
}

async function importaPianiJson(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { alert('File JSON non valido'); return; }
  try {
    const resp = await fetch('/api/piani/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error((await resp.json()).error);
    await loadPiani();
    renderPiani();
    alert('Import completato.');
  } catch (e) { alert('Errore import: ' + e.message); }
  inputEl.value = '';
}
```

- [ ] **Step 4: Verifica manuale end-to-end**

Run: `npm start`, apri `http://localhost:3000`.

1. Clicca "Gestione piani" in sidebar.
   Expected: tabella con 60 righe, tutte "✅" attivo, categorie visibili e coerenti con `ROI_REQUISITI_PIANI_SCONTO.md` sezione 5.
2. Clicca "Disattiva" su un piano.
   Expected: riga passa a "❌", e riaprendo il selettore piano nel Calcolatore ROI quel piano non compare più tra le opzioni.
3. Clicca "Modifica prezzi" su un piano attivo, cambia un prezzo, clicca "Salva prezzi".
   Expected: alert di conferma; riapri il Calcolatore ROI con quel piano selezionato e verifica che il nuovo prezzo venga usato nell'autofill.
4. Prepara un file JSON minimo di test (`test-import.json`):
   ```json
   {"exams_base_price":{"ESAME TEST":50},"plans":{"NUOVO PIANO TEST 2027":{"ESAME TEST":40}},"plan_order":["NUOVO PIANO TEST 2027"]}
   ```
   Clicca "Importa listino JSON", seleziona il file.
   Expected: alert "Import completato", il nuovo piano compare in tabella con categoria "Altro" e anno 2027.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(roi-piani): pannello amministrazione piani (editing prezzi, import JSON)"
```

---

## Verifica finale di regressione

- [ ] **Step 1: Esegui l'intera suite backend**

Run: `npm test`
Expected: PASS, tutti i test (12+) verdi.

- [ ] **Step 2: Verifica retrocompatibilità ROI esistenti**

Apri un ROI creato prima di questa modifica (via Cronologia file → click su una riga esistente, oppure Excel già caricato).
Expected: si apre e mostra i dati esattamente come prima, nessun errore in console, nessun riferimento a "piano" visibile in quella vista (non è il Calcolatore ROI).

- [ ] **Step 3: Verifica upload Excel non toccato**

Carica un file Excel valido tramite "+ Carica file Excel".
Expected: comportamento identico a prima della modifica (nessun selettore piano in questo flusso).
