# Confronto intelligente listini concorrenza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nel Calcolatore ROI, permettere l'import riutilizzabile di un listino Excel concorrente e il matching automatico (testuale, non-AI) tra i nomi degli esami Mylav e quelli del concorrente, con conferma manuale quando il match non è sicuro.

**Architecture:** Due nuove tabelle SQLite (`concorrenti`, `esami_concorrente`) gestite da un nuovo modulo `lib/concorrenti.js` (stesso pattern di `lib/piani.js`: `ensureSchema`, funzioni pure prese un `db` SQLite come primo argomento, testate con `node:test`). Nuove rotte in `server.js` riusano l'infrastruttura Excel già esistente (`multer`, `xlsx`, `findCol`, `toNum`). Nel frontend (`public/app.js`, nessun framework), una pillola "Concorrente: ... ▾" parallela a "Piano: ... ▾" e un secondo banner cliccabile parallelo a quello già esistente per i piani.

**Tech Stack:** Node.js, Express, `node:sqlite` (DatabaseSync), `xlsx`, `multer`, vanilla JS/CSS (no build step), `node:test`/`node:assert`.

## Global Constraints

- Nessuna nuova dipendenza npm — riuso di `xlsx`, `multer`, `express` già in `package.json`.
- Tutto il testo UI in italiano.
- Normalizzazione nomi sempre tramite `norm()` da `lib/piani.js` (lowercase, trim, collassa spazi) — mai una nuova funzione di normalizzazione duplicata.
- Nessuna dipendenza esterna/AI per il matching — solo confronto testuale (tokenizzazione + Jaccard).
- Test backend con `node:test`/`node:assert` in `lib/*.test.js`, eseguiti da `npm test` (`node --test lib/*.test.js`) — nessun nuovo tool di test.
- Non tocca `piani_sconto`/`pianoMigliorePerEsame` né il flusso di upload Excel Mylav esistente (`parseFoglio1`/`parsePlatinumGold`).
- Riuso deliberato dei pattern UI già collaudati: pillola con ricerca (classi CSS `.roi-piano-btn`/`.roi-piano-panel`/`.roi-piano-item`), banner cliccabile di suggerimento (`.roi-consiglio-banner`/`.roi-consiglio-close`).
- Import ripetuto dello stesso concorrente aggiorna prezzo/sconto per riga esistente ma non deve mai azzerare un mapping (`esame_mylav_nome`/`confermato`) già confermato.

**Nota di implementazione rispetto allo spec approvato:** lo spec (`docs/superpowers/specs/2026-07-07-confronto-concorrenza-design.md`, Sezione 2) descrive `esame_mylav_id INTEGER REFERENCES esami_riferimento(id)`. In fase di piano è emerso un problema concreto: un esame Mylav digitato nel ROI può non esistere ancora in `esami_riferimento` (esame nuovo/sconosciuto, caso `fonte: 'assente'` già gestito altrove), quindi non avrebbe un id a cui agganciarsi. La tabella usa invece `esame_mylav_nome TEXT` (normalizzato): stessa idea dello spec — il mapping vive direttamente sulla riga, sopravvive al re-import — ma senza dipendere da una entry preesistente in `esami_riferimento`. Nessun altro punto dello spec cambia.

---

### Task 1: `lib/concorrenti.js` — schema e import/upsert catalogo

**Files:**
- Create: `lib/concorrenti.js`
- Create: `lib/concorrenti.test.js`

**Interfaces:**
- Consumes: `norm(s)` da `./piani.js` (già esistente, riusato as-is).
- Produces: `ensureSchema(db)`, `upsertConcorrente(db, nomeConcorrente, righe)` dove `righe` è `[{ nome_originale, prezzo, sconto }]` e ritorna `{ concorrenteId, righeSalvate }`, `listaConcorrenti(db)` → `[{ id, nome, data_import, n_esami, n_mappati }]`, `dettaglioConcorrente(db, id)` → `{ concorrente, esami } | null`. Task 2 aggiunge altre funzioni allo stesso file/export object.

- [ ] **Step 1: Scrivi i test per `ensureSchema` e `upsertConcorrente`**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema, upsertConcorrente, listaConcorrenti, dettaglioConcorrente } = require('./concorrenti.js');

function dbVuoto() {
  return new DatabaseSync(':memory:');
}

test('ensureSchema crea le tabelle concorrenti e esami_concorrente', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tables.includes('concorrenti'));
  assert.ok(tables.includes('esami_concorrente'));
  db.close();
});

test('ensureSchema e\' idempotente', () => {
  const db = dbVuoto();
  ensureSchema(db);
  ensureSchema(db);
  db.close();
});

test('upsertConcorrente crea il concorrente e le righe esami', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Istologico standard', prezzo: 30, sconto: 10 },
    { nome_originale: 'Emocromo completo', prezzo: 12, sconto: null }
  ]);
  assert.equal(r.righeSalvate, 2);
  const righe = db.prepare('SELECT * FROM esami_concorrente WHERE concorrente_id = ?').all(r.concorrenteId);
  assert.equal(righe.length, 2);
  assert.equal(righe.find(x => x.nome_originale === 'Istologico standard').prezzo, 30);
  assert.equal(righe.find(x => x.nome_originale === 'Emocromo completo').sconto, null);
  db.close();
});

test('upsertConcorrente su nome concorrente esistente riusa lo stesso concorrente_id (non duplica)', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r1 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame A', prezzo: 10, sconto: null }]);
  const r2 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame B', prezzo: 20, sconto: null }]);
  assert.equal(r1.concorrenteId, r2.concorrenteId);
  const count = db.prepare('SELECT COUNT(*) c FROM concorrenti').get().c;
  assert.equal(count, 1);
  db.close();
});

test('upsertConcorrente re-importato aggiorna prezzo/sconto ma non tocca un mapping gia\' confermato', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r1 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Istologico standard', prezzo: 30, sconto: 10 }]);
  const rigaId = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ?').get(r1.concorrenteId).id;
  db.prepare('UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ?').run('istologico', rigaId);

  upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Istologico standard', prezzo: 33, sconto: 12 }]);

  const riga = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(rigaId);
  assert.equal(riga.prezzo, 33);
  assert.equal(riga.sconto, 12);
  assert.equal(riga.esame_mylav_nome, 'istologico');
  assert.equal(riga.confermato, 1);
  db.close();
});

test('upsertConcorrente lancia un errore se il nome concorrente e\' vuoto', () => {
  const db = dbVuoto();
  ensureSchema(db);
  assert.throws(() => upsertConcorrente(db, '  ', [{ nome_originale: 'X', prezzo: 1, sconto: null }]));
  db.close();
});

test('listaConcorrenti conta esami totali e mappati', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Esame A', prezzo: 10, sconto: null },
    { nome_originale: 'Esame B', prezzo: 20, sconto: null }
  ]);
  db.prepare('UPDATE esami_concorrente SET esame_mylav_nome = ? WHERE concorrente_id = ? AND nome_originale = ?')
    .run('esame a mylav', r.concorrenteId, 'Esame A');

  const lista = listaConcorrenti(db);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'IDEXX 2026');
  assert.equal(lista[0].n_esami, 2);
  assert.equal(lista[0].n_mappati, 1);
  db.close();
});

test('dettaglioConcorrente ritorna concorrente + righe, null se non esiste', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame A', prezzo: 10, sconto: null }]);
  const d = dettaglioConcorrente(db, r.concorrenteId);
  assert.equal(d.concorrente.nome, 'IDEXX 2026');
  assert.equal(d.esami.length, 1);
  assert.equal(dettaglioConcorrente(db, 999999), null);
  db.close();
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `npm test`
Expected: FAIL — `Cannot find module './concorrenti.js'`

- [ ] **Step 3: Implementa `lib/concorrenti.js` (schema + upsert + liste)**

```javascript
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
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `npm test`
Expected: PASS — tutti i test di `lib/concorrenti.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/concorrenti.js lib/concorrenti.test.js
git commit -m "feat(concorrenza): schema DB e import/upsert catalogo concorrente"
```

---

### Task 2: `lib/concorrenti.js` — algoritmo di matching testuale

**Files:**
- Modify: `lib/concorrenti.js`
- Modify: `lib/concorrenti.test.js`

**Interfaces:**
- Consumes: `norm(s)` da `./piani.js`; tabella `esami_concorrente` da Task 1.
- Produces: `tokenizza(nome)` → `string[]`, `jaccard(tokensA, tokensB)` → `number` (0..1), `trovaMatch(db, concorrenteId, esameMylavNomeRaw)` → `{ trovato: false } | { trovato: true, sicuro: boolean, esameConcorrenteId, nomeOriginale, prezzo, sconto, score }`, `confermaMatch(db, esameConcorrenteId, esameMylavNomeRaw)`, `rimuoviMatch(db, esameConcorrenteId)`. Task 4 (rotte server.js) chiama direttamente queste tre funzioni.

- [ ] **Step 1: Scrivi i test per tokenizzazione, Jaccard e `trovaMatch`/`confermaMatch`/`rimuoviMatch`**

Aggiungi in fondo a `lib/concorrenti.test.js`:

```javascript
const { tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch } = require('./concorrenti.js');

test('tokenizza normalizza, splitta e rimuove le stopword', () => {
  assert.deepEqual(tokenizza('Esame Istologico Standard'), ['istologico', 'standard']);
  assert.deepEqual(tokenizza('Test del Sangue'), ['sangue']);
});

test('jaccard e\' 1 per token identici, 0 se nessuna sovrapposizione', () => {
  assert.equal(jaccard(['istologico', 'standard'], ['istologico', 'standard']), 1);
  assert.equal(jaccard(['istologico'], ['emocromo']), 0);
});

test('jaccard gestisce array vuoti senza dividere per zero', () => {
  assert.equal(jaccard([], []), 0);
  assert.equal(jaccard(['a'], []), 0);
});

function dbConCatalogo() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Esame istopatologico completo', prezzo: 35, sconto: 5 },
    { nome_originale: 'Emocromo con formula', prezzo: 12, sconto: null }
  ]);
  return { db, concorrenteId: r.concorrenteId };
}

test('trovaMatch: nessun candidato -> trovato false', () => {
  const { db } = dbConCatalogo();
  assert.equal(trovaMatch(db, 999, 'istologico').trovato, false);
  db.close();
});

test('trovaMatch: score alto -> match sicuro e persiste esame_mylav_nome per i prossimi giri', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const r = trovaMatch(db, concorrenteId, 'Esame istopatologico completo');
  assert.equal(r.trovato, true);
  assert.equal(r.sicuro, true);
  assert.equal(r.nomeOriginale, 'Esame istopatologico completo');

  // Al giro successivo trova subito per match esatto sul nome mylav gia' salvato
  const riga = db.prepare('SELECT esame_mylav_nome FROM esami_concorrente WHERE id = ?').get(r.esameConcorrenteId);
  assert.equal(riga.esame_mylav_nome, norm('Esame istopatologico completo'));
  db.close();
});

test('trovaMatch: score basso non trova nulla', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const r = trovaMatch(db, concorrenteId, 'Radiografia torace');
  assert.equal(r.trovato, false);
  db.close();
});

test('trovaMatch: score intermedio -> trovato ma non sicuro, non persiste nulla', () => {
  const { db, concorrenteId } = dbConCatalogo();
  // "Emocromo" da solo condivide un token su piu' totali col candidato "Emocromo con formula"
  const r = trovaMatch(db, concorrenteId, 'Emocromo');
  assert.equal(r.trovato, true);
  assert.equal(r.sicuro, false);
  const riga = db.prepare('SELECT esame_mylav_nome FROM esami_concorrente WHERE id = ?').get(r.esameConcorrenteId);
  assert.equal(riga.esame_mylav_nome, null);
  db.close();
});

test('trovaMatch ignora le righe gia\' mappate ad un altro esame mylav', () => {
  const { db, concorrenteId } = dbConCatalogo();
  trovaMatch(db, concorrenteId, 'Esame istopatologico completo'); // si auto-conferma
  const r = trovaMatch(db, concorrenteId, 'Esame istopatologico completo diverso');
  // la riga e' gia' occupata da 'esame istopatologico completo': la ricerca esatta su questo nome fallisce,
  // e la ricerca fuzzy tra i non mappati non ha piu' candidati validi
  assert.equal(r.trovato, false);
  db.close();
});

test('confermaMatch imposta esame_mylav_nome e confermato=1', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const riga = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ? AND nome_originale = ?')
    .get(concorrenteId, 'Emocromo con formula');
  confermaMatch(db, riga.id, 'Emocromo Mylav');
  const aggiornata = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(riga.id);
  assert.equal(aggiornata.esame_mylav_nome, 'emocromo mylav');
  assert.equal(aggiornata.confermato, 1);
  db.close();
});

test('rimuoviMatch azzera esame_mylav_nome e confermato', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const riga = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ? AND nome_originale = ?')
    .get(concorrenteId, 'Emocromo con formula');
  confermaMatch(db, riga.id, 'Emocromo Mylav');
  rimuoviMatch(db, riga.id);
  const aggiornata = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(riga.id);
  assert.equal(aggiornata.esame_mylav_nome, null);
  assert.equal(aggiornata.confermato, 0);
  db.close();
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `npm test`
Expected: FAIL — `tokenizza is not a function` (o simile)

- [ ] **Step 3: Implementa l'algoritmo in `lib/concorrenti.js`**

Aggiungi, dopo `ensureSchema` e prima di `upsertConcorrente`:

```javascript
const STOPWORD = new Set([
  'di', 'del', 'della', 'dei', 'delle', 'test', 'esame', 'esami',
  'e', 'ed', 'il', 'lo', 'la', 'i', 'gli', 'le', 'per', 'con', 'da', 'a', 'in', 'su'
]);

function tokenizza(nomeRaw) {
  return norm(nomeRaw).split(' ').filter(t => t && !STOPWORD.has(t));
}

function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA), b = new Set(tokensB);
  if (a.size === 0 && b.size === 0) return 0;
  let intersezione = 0;
  for (const t of a) if (b.has(t)) intersezione++;
  const unione = new Set([...a, ...b]).size;
  return unione === 0 ? 0 : intersezione / unione;
}

const SOGLIA_SICURA = 0.6;
const SOGLIA_MINIMA = 0.3;

function trovaMatch(db, concorrenteId, esameMylavNomeRaw) {
  const nome = norm(esameMylavNomeRaw);
  if (!nome) return { trovato: false };

  const esatto = db.prepare(`
    SELECT * FROM esami_concorrente WHERE concorrente_id = ? AND esame_mylav_nome = ?
  `).get(concorrenteId, nome);
  if (esatto) {
    return {
      trovato: true, sicuro: true, esameConcorrenteId: esatto.id,
      nomeOriginale: esatto.nome_originale, prezzo: esatto.prezzo, sconto: esatto.sconto, score: 1
    };
  }

  const candidati = db.prepare(`
    SELECT * FROM esami_concorrente WHERE concorrente_id = ? AND esame_mylav_nome IS NULL
  `).all(concorrenteId);
  const tokensMylav = tokenizza(nome);

  let migliore = null, migliorScore = 0;
  for (const c of candidati) {
    const score = jaccard(tokensMylav, tokenizza(c.nome_originale));
    if (score > migliorScore) { migliorScore = score; migliore = c; }
  }
  if (!migliore || migliorScore < SOGLIA_MINIMA) return { trovato: false };

  const sicuro = migliorScore >= SOGLIA_SICURA;
  if (sicuro) {
    db.prepare(`UPDATE esami_concorrente SET esame_mylav_nome = ? WHERE id = ?`).run(nome, migliore.id);
  }
  return {
    trovato: true, sicuro, esameConcorrenteId: migliore.id,
    nomeOriginale: migliore.nome_originale, prezzo: migliore.prezzo, sconto: migliore.sconto, score: migliorScore
  };
}

function confermaMatch(db, esameConcorrenteId, esameMylavNomeRaw) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ?
  `).run(norm(esameMylavNomeRaw), esameConcorrenteId);
}

function rimuoviMatch(db, esameConcorrenteId) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = NULL, confermato = 0 WHERE id = ?
  `).run(esameConcorrenteId);
}
```

Aggiorna `module.exports` in fondo al file:

```javascript
module.exports = {
  ensureSchema, upsertConcorrente, listaConcorrenti, dettaglioConcorrente,
  tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch
};
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `npm test`
Expected: PASS — tutti i test di `lib/concorrenti.test.js` (16 test totali tra Task 1 e 2)

- [ ] **Step 5: Commit**

```bash
git add lib/concorrenti.js lib/concorrenti.test.js
git commit -m "feat(concorrenza): matching testuale (tokenizzazione + Jaccard) con conferma/rimozione manuale"
```

---

### Task 3: `server.js` — boot schema, parsing Excel import, rotte lista/dettaglio

**Files:**
- Modify: `server.js:9` (require), `server.js:82-94` (boot), dopo `server.js:280` (helper parsing), dopo `server.js:962` (nuove rotte)

**Interfaces:**
- Consumes: `concorrenti.ensureSchema`, `concorrenti.upsertConcorrente`, `concorrenti.listaConcorrenti`, `concorrenti.dettaglioConcorrente` da Task 1; `XLSX`, `upload`, `findCol`, `fs` già presenti in `server.js`.
- Produces: rotte `POST /api/concorrenti/import`, `POST /api/concorrenti/import/conferma`, `GET /api/concorrenti`, `GET /api/concorrenti/:id`, consumate dal frontend nei Task 6 e 8.

- [ ] **Step 1: Aggiungi il require e l'inizializzazione schema**

In `server.js:9`, dopo `const piani = require('./lib/piani');`:

```javascript
const piani = require('./lib/piani');
const concorrenti = require('./lib/concorrenti');
```

In `server.js`, dopo il blocco `// ── Piani di scontistica ────────────────────────────` (righe 81-94), aggiungi:

```javascript
// ── Concorrenza ─────────────────────────────────────
concorrenti.ensureSchema(db);
```

- [ ] **Step 2: Aggiungi l'helper di parsing Excel del listino concorrente**

Dopo la funzione `parsePlatinumGold` (dopo `server.js:280`), aggiungi:

```javascript
/**
 * Parsing generico di un listino concorrente: trova la prima riga con almeno
 * 2 celle non vuote come header, poi rileva per keyword le colonne
 * nome esame / prezzo / sconto (sconto puo' mancare del tutto).
 */
function parseConcorrenteExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (allRows.length < 2) return { headers: [], rows: [], colEsame: -1, colPrezzo: -1, colSconto: -1 };

  let hRow = -1;
  for (let i = 0; i < Math.min(8, allRows.length); i++) {
    if (allRows[i].filter(c => String(c).trim() !== '').length >= 2) { hRow = i; break; }
  }
  if (hRow === -1) return { headers: [], rows: [], colEsame: -1, colPrezzo: -1, colSconto: -1 };

  const headers = allRows[hRow].map(h => String(h || ''));
  const colEsame  = findCol(headers, 'esame', 'test', 'nome', 'descrizione');
  const colPrezzo = findCol(headers, 'prezzo', 'listino', 'price');
  const colSconto = findCol(headers, 'sconto', 'discount', '%');

  const rows = allRows.slice(hRow + 1).filter(r => r.some(c => String(c).trim() !== ''));
  return { headers, rows, colEsame, colPrezzo, colSconto };
}
```

- [ ] **Step 3: Aggiungi le rotte di import, conferma import, lista e dettaglio**

Dopo la rotta `app.post('/api/piani/import', ...)` (dopo `server.js:962`), aggiungi:

```javascript
app.post('/api/concorrenti/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const parsed = parseConcorrenteExcel(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/concorrenti/import/conferma', express.json({ limit: '5mb' }), (req, res) => {
  try {
    const { nomeConcorrente, colEsame, colPrezzo, colSconto, rows } = req.body || {};
    if (!nomeConcorrente || colEsame == null || colPrezzo == null || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'Dati mancanti (nomeConcorrente, colEsame, colPrezzo, rows)' });
    }
    const righe = rows
      .map(r => ({
        nome_originale: r[colEsame],
        prezzo: parseFloat(String(r[colPrezzo]).replace(',', '.')) || 0,
        sconto: (colSconto != null && colSconto >= 0 && r[colSconto] !== '')
          ? (parseFloat(String(r[colSconto]).replace(',', '.')) || 0)
          : null
      }))
      .filter(r => r.nome_originale && String(r.nome_originale).trim());
    const result = concorrenti.upsertConcorrente(db, nomeConcorrente, righe);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/concorrenti', (req, res) => {
  try { res.json(concorrenti.listaConcorrenti(db)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/concorrenti/:id', (req, res) => {
  try {
    const dettaglio = concorrenti.dettaglioConcorrente(db, req.params.id);
    if (!dettaglio) return res.status(404).json({ error: 'Concorrente non trovato' });
    res.json(dettaglio);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 4: Verifica manuale con curl**

Run: `npm run dev` (in un terminale), poi in un altro:
```bash
curl -s -X POST http://localhost:3000/api/concorrenti/import/conferma \
  -H "Content-Type: application/json" \
  -d '{"nomeConcorrente":"Test Import","colEsame":0,"colPrezzo":1,"colSconto":-1,"rows":[["Istologico standard","30"]]}'
```
Expected: `{"success":true,"concorrenteId":1,"righeSalvate":1}`

```bash
curl -s http://localhost:3000/api/concorrenti
```
Expected: `[{"id":1,"nome":"Test Import","data_import":"...","n_esami":1,"n_mappati":0}]`

Pulisci il dato di test tramite lo stesso DB (non c'e' ancora una rotta di cancellazione concorrente in questo piano — è accettabile lasciare "Test Import" nel DB di sviluppo, verrà rimosso a mano se necessario, stesso trattamento riservato in passato a righe di test analoghe).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(concorrenza): rotte import Excel, conferma import, lista e dettaglio concorrenti"
```

---

### Task 4: `server.js` — rotte di matching

**Files:**
- Modify: `server.js` (dopo le rotte aggiunte in Task 3)

**Interfaces:**
- Consumes: `concorrenti.trovaMatch`, `concorrenti.confermaMatch`, `concorrenti.rimuoviMatch` da Task 2.
- Produces: `GET /api/concorrenti/:id/match?esame=NOME`, `POST /api/concorrenti/:id/conferma-match`, `POST /api/concorrenti/:id/rimuovi-match`, consumate dal frontend nei Task 7 e 8.

- [ ] **Step 1: Aggiungi le rotte**

Dopo `app.get('/api/concorrenti/:id', ...)` aggiunta in Task 3:

```javascript
app.get('/api/concorrenti/:id/match', (req, res) => {
  try {
    const { esame } = req.query;
    if (!esame) return res.status(400).json({ error: 'Parametro esame mancante' });
    res.json(concorrenti.trovaMatch(db, Number(req.params.id), esame));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/:id/conferma-match', express.json(), (req, res) => {
  try {
    const { esameConcorrenteId, esameMylavNome } = req.body || {};
    if (!esameConcorrenteId || !esameMylavNome) {
      return res.status(400).json({ error: 'Dati mancanti (esameConcorrenteId, esameMylavNome)' });
    }
    concorrenti.confermaMatch(db, Number(esameConcorrenteId), esameMylavNome);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/:id/rimuovi-match', express.json(), (req, res) => {
  try {
    const { esameConcorrenteId } = req.body || {};
    if (!esameConcorrenteId) return res.status(400).json({ error: 'Dati mancanti (esameConcorrenteId)' });
    concorrenti.rimuoviMatch(db, Number(esameConcorrenteId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: Verifica manuale con curl**

Riusando il concorrente creato in Task 3 (id `1`, riga con `nome_originale = "Istologico standard"`):

```bash
curl -s "http://localhost:3000/api/concorrenti/1/match?esame=Istologico"
```
Expected (score alto tra "Istologico" e "Istologico standard"): `{"trovato":true,"sicuro":true,"esameConcorrenteId":1,"nomeOriginale":"Istologico standard","prezzo":30,"sconto":null,"score":...}`

```bash
curl -s -X POST http://localhost:3000/api/concorrenti/1/rimuovi-match \
  -H "Content-Type: application/json" -d '{"esameConcorrenteId":1}'
```
Expected: `{"success":true}`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(concorrenza): rotte match/conferma-match/rimuovi-match"
```

---

### Task 5: `public/style.css` — banner di match concorrenza

**Files:**
- Modify: `public/style.css` (dopo `.roi-consiglio-close:hover` a `public/style.css:899`)

**Interfaces:**
- Consumes: nessuna.
- Produces: classe `.roi-match-banner` usata dal Task 7 sopra la base già esistente `.roi-consiglio-banner`/`.roi-consiglio-close`.

- [ ] **Step 1: Aggiungi le regole CSS**

Dopo `.roi-consiglio-close:hover { color: #1a1a1a; }` (`public/style.css:899`):

```css
.roi-match-banner {
  bottom: 100px;
  border-left-color: #f5a800;
}
.roi-match-banner strong { color: #b37a00; }
```

- [ ] **Step 2: Verifica visiva**

Non testabile isolatamente (nessun elemento la usa ancora) — verrà verificato a schermo nel Task 7.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(concorrenza): variante banner per il match concorrenza (accento arancione, offset per convivere col banner piano)"
```

---

### Task 6: `public/app.js` — pillola selettore concorrente

**Files:**
- Modify: `public/app.js:7-19` (stato `S`), `public/app.js:63-65` (dopo `loadPiani`), `public/app.js:1406-1431` (`buildRoiSectionHtml`), dopo `public/app.js:1482` (`selezionaPiano`), `public/app.js:1975-1981` (`init`)

**Interfaces:**
- Consumes: `GET /api/concorrenti` da Task 3; `escHtml`, `el`, `api` già esistenti.
- Produces: `S.roi.concorrenteId`, `S.concorrenti`, `concorrenteSelezionatoNome()`, `selezionaConcorrente(id)` — quest'ultima chiamata dal Task 7 (`aggiornaMatchConcorrente`) e dal markup della pillola.

- [ ] **Step 1: Aggiungi lo stato**

In `public/app.js:7-19`, modifica:

```javascript
const S = {
  strutture: [],
  expanded:  {},
  vistaMia:  true,
  charts:    {},
  piani:     [],
  concorrenti: [],
  foglio: { dati: null, totali: null, file: null, foglio: null, fileId: null },
  roi: {
    struttura: '',
    pianoId: null,
    concorrenteId: null,
    righe: [roiRigaVuota()]
  }
};
```

- [ ] **Step 2: Aggiungi il caricamento e il wiring in `init()`**

Dopo `async function loadPiani() { S.piani = await api('/api/piani'); }` (`public/app.js:63-65`):

```javascript
async function loadConcorrenti() {
  S.concorrenti = await api('/api/concorrenti');
}
```

In `async function init()` (`public/app.js:1975-1981`), dopo `await loadPiani();`:

```javascript
async function init() {
  await loadStrutture();
  await loadPiani();
  await loadConcorrenti();
  buildSidebar();
  initDropzone();
  navigate('dashboard');
}
```

- [ ] **Step 3: Aggiungi la pillola in `buildRoiSectionHtml()` e le funzioni di selezione**

In `buildRoiSectionHtml()` (`public/app.js:1406-1431`), modifica il blocco della pillola piano per aggiungere quella del concorrente accanto:

```javascript
function buildRoiSectionHtml() {
  const struttureOpts = S.strutture.map(s => `<option value="${escHtml(s.nome)}">`).join('');

  return `
    <datalist id="roi-strutture-list">${struttureOpts}</datalist>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:500;color:#1a1a1a">Calcolatore ROI</div>
      <div style="display:flex;gap:8px">
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn" id="roi-piano-btn"
                  onclick="togglePianoPanel()" title="${escHtml(pianoSelezionatoNome() || '')}">
            Piano: ${escHtml(pianoSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-piano-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
        <div style="position:relative">
          <button class="btn-outline roi-piano-btn" id="roi-concorrente-btn"
                  onclick="toggleConcorrentePanel()" title="${escHtml(concorrenteSelezionatoNome() || '')}">
            Concorrente: ${escHtml(concorrenteSelezionatoNome() || 'Nessuno')} ▾
          </button>
          <div id="roi-concorrente-panel" class="roi-piano-panel" style="display:none"></div>
        </div>
      </div>
    </div>
    <div id="roi-table-wrap" style="overflow-x:auto">${buildRoiTableHtml()}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn-outline" onclick="addRigaRoi()" style="font-size:12px">+ Aggiungi esame</button>
      <button class="btn-outline" onclick="salvaCalcolo()" style="font-size:12px;color:#1a7a4a;border-color:#1a7a4a">💾 Salva come file</button>
      <button class="btn-outline" onclick="esportaExcelRoi()" style="font-size:12px">📥 Esporta Excel</button>
    </div>
    <div id="roi-msg" style="margin-top:8px;font-size:12px;min-height:18px"></div>
    <div id="roi-ac" class="roi-autocomplete" style="display:none"></div>
    <div id="roi-consiglio-banner" class="roi-consiglio-banner" style="display:none"></div>
    <div id="roi-match-banner" class="roi-consiglio-banner roi-match-banner" style="display:none"></div>
  `;
}
```

Subito dopo `selezionaPiano(id)` (dopo `public/app.js:1482`), aggiungi:

```javascript
function concorrenteSelezionatoNome() {
  const c = S.concorrenti.find(c => c.id === S.roi.concorrenteId);
  return c ? c.nome : null;
}

function toggleConcorrentePanel() {
  const panel = el('roi-concorrente-panel');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (show) renderConcorrentePanel('');
}

function renderConcorrentePanel(filtro) {
  const panel = el('roi-concorrente-panel');
  if (!panel) return;
  const f = filtro.trim().toLowerCase();
  const filtrati = S.concorrenti.filter(c => !f || c.nome.toLowerCase().includes(f));

  let html = `<input class="roi-input" id="roi-concorrente-search" placeholder="🔍 Cerca concorrente..."
    value="${escHtml(filtro)}" oninput="renderConcorrentePanel(this.value)"
    style="width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid #e8e9eb">`;
  html += `<div class="roi-piano-item" onclick="selezionaConcorrente(null)" style="font-style:italic">— Nessun concorrente —</div>`;
  filtrati.forEach(c => {
    html += `<div class="roi-piano-item" onclick="selezionaConcorrente(${c.id})">${escHtml(c.nome)}</div>`;
  });
  panel.innerHTML = html;
  const inp = el('roi-concorrente-search');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function selezionaConcorrente(id) {
  S.roi.concorrenteId = id;
  const panel = el('roi-concorrente-panel');
  if (panel) panel.style.display = 'none';
  const btn = el('roi-concorrente-btn');
  if (btn) {
    btn.textContent = `Concorrente: ${concorrenteSelezionatoNome() || 'Nessuno'} ▾`;
    btn.title = concorrenteSelezionatoNome() || '';
  }
  const tbody = el('roi-tbody');
  if (tbody) {
    tbody.querySelectorAll('tr[data-idx]').forEach(tr => aggiornaMatchConcorrente(tr));
  }
}
```

`aggiornaMatchConcorrente` non esiste ancora: verrà creata nel Task 7. Per non rompere la UI nel frattempo, aggiungi già ora uno stub temporaneo subito dopo `selezionaConcorrente`, che il Task 7 sostituirà con l'implementazione reale:

```javascript
function aggiornaMatchConcorrente(tr) { /* implementata nel Task 7 */ }
```

- [ ] **Step 2: Verifica manuale nel browser**

Avvia il server (`npm run dev`), apri il Calcolatore ROI. Verifica:
- Accanto alla pillola "Piano: ..." compare "Concorrente: Nessuno ▾".
- Click apre un pannello con campo ricerca e, se è stato creato un concorrente nei Task precedenti (es. "Test Import"), lo elenca.
- Selezionare un concorrente aggiorna il testo del bottone e chiude il pannello.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat(concorrenza): pillola selettore concorrente nel Calcolatore ROI"
```

---

### Task 7: `public/app.js` — cascata di match e banner di conferma

**Files:**
- Modify: `public/app.js` (sostituisce lo stub `aggiornaMatchConcorrente` del Task 6; modifica `aggiornaPrezziAutomatici`)

**Interfaces:**
- Consumes: `GET /api/concorrenti/:id/match`, `POST /api/concorrenti/:id/conferma-match` da Task 4; `S.roi.concorrenteId` da Task 6; `fmtE`, `escHtml`, `el`, `aggiornaRigaDOM` già esistenti.
- Produces: `aggiornaMatchConcorrente(tr)` (sostituisce lo stub), `mostraBannerMatch(tr, m)`, `confermaMatchBanner(idx, esameConcorrenteId)`.

- [ ] **Step 1: Sostituisci lo stub con l'implementazione reale**

Sostituisci:

```javascript
function aggiornaMatchConcorrente(tr) { /* implementata nel Task 7 */ }
```

con:

```javascript
async function aggiornaMatchConcorrente(tr) {
  const banner = el('roi-match-banner');
  const esameInp = tr.querySelector('[data-col="esame"]');
  const lcInp = tr.querySelector('[data-col="listino_concorrenza"]');
  const scInp = tr.querySelector('[data-col="sconto_concorrenza"]');
  if (!esameInp || !lcInp || !scInp) return;
  const esame = esameInp.value.trim();

  if (!S.roi.concorrenteId || !esame) {
    if (banner) banner.style.display = 'none';
    return;
  }

  const requestedConcorrenteId = S.roi.concorrenteId;
  const m = await fetch(`/api/concorrenti/${requestedConcorrenteId}/match?esame=${encodeURIComponent(esame)}`)
    .then(r => r.json()).catch(() => ({ trovato: false }));
  if (S.roi.concorrenteId !== requestedConcorrenteId) return; // selezione concorrente cambiata nel frattempo

  if (m.trovato && m.sicuro) {
    if (banner) banner.style.display = 'none';
    if (lcInp.value === '' || lcInp.dataset.auto === '1') {
      lcInp.value = m.prezzo;
      lcInp.dataset.auto = '1';
    }
    if (m.sconto != null && (scInp.value === '' || scInp.dataset.auto === '1')) {
      scInp.value = m.sconto;
      scInp.dataset.auto = '1';
    }
    aggiornaRigaDOM(tr);
  } else if (m.trovato && !m.sicuro) {
    mostraBannerMatch(tr, m);
  } else if (banner) {
    banner.style.display = 'none';
  }
}

function mostraBannerMatch(tr, m) {
  const banner = el('roi-match-banner');
  if (!banner) return;
  banner.innerHTML = `
    <span class="roi-consiglio-close" onclick="event.stopPropagation(); this.parentElement.style.display='none'">×</span>
    <div onclick="confermaMatchBanner(${tr.dataset.idx}, ${m.esameConcorrenteId})" style="cursor:pointer">
      💡 Forse corrisponde a <strong>${escHtml(m.nomeOriginale)}</strong> nel listino concorrente — ${fmtE(m.prezzo)}<br>
      <span style="font-size:11px;color:#6b7280">Clicca per confermare</span>
    </div>
  `;
  banner.style.display = 'block';
}

async function confermaMatchBanner(idx, esameConcorrenteId) {
  const tbody = el('roi-tbody');
  const tr = tbody?.querySelector(`tr[data-idx="${idx}"]`);
  if (!tr || !S.roi.concorrenteId) return;
  const esameInp = tr.querySelector('[data-col="esame"]');
  const esame = esameInp ? esameInp.value.trim() : '';
  if (!esame) return;

  await fetch(`/api/concorrenti/${S.roi.concorrenteId}/conferma-match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ esameConcorrenteId, esameMylavNome: esame })
  });
  const banner = el('roi-match-banner');
  if (banner) banner.style.display = 'none';
  await aggiornaMatchConcorrente(tr);
}
```

- [ ] **Step 2: Aggancia la cascata in `aggiornaPrezziAutomatici`**

In `aggiornaPrezziAutomatici(tr)` (`public/app.js:1628-1673`), l'ultima riga è `mostraConsiglioPiano(esame);`. Aggiungi subito dopo:

```javascript
  aggiornaRigaDOM(tr);
  mostraConsiglioPiano(esame);
  aggiornaMatchConcorrente(tr);
}
```

- [ ] **Step 3: Verifica manuale nel browser (richiede un concorrente con almeno una riga)**

Se non già presente, importa un concorrente via curl (come nel Task 3) con una riga tipo `"Esame istologico completo"`. Poi, nel Calcolatore ROI:
1. Seleziona quel concorrente dalla pillola.
2. In una riga della tabella, scrivi/seleziona un esame Mylav con nome simile (es. "Istologico") e premi Invio o clicca fuori dal campo.
3. Verifica che `Listino conc.` si autocompili (match sicuro), oppure che appaia in basso a destra un secondo banner arancione "Forse corrisponde a..." (match incerto) sopra/sotto quello verde del piano se entrambi attivi.
4. Cliccando il banner arancione, verifica che `Listino conc.` si compili e il banner sparisca.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(concorrenza): autofill listino/sconto concorrenza da match automatico o confermato via banner"
```

---

### Task 8: `public/app.js` — pannello amministrazione "Gestione concorrenti"

**Files:**
- Modify: `public/app.js:119-130` (sidebar), `public/app.js:168-185` (`navigate`), dopo `public/app.js:1400` (fine sezione admin piani, prima di `// ROI CALCOLATORE`)

**Interfaces:**
- Consumes: `GET /api/concorrenti`, `GET /api/concorrenti/:id`, `POST /api/concorrenti/import`, `POST /api/concorrenti/import/conferma`, `POST /api/concorrenti/:id/conferma-match`, `POST /api/concorrenti/:id/rimuovi-match` (Task 3/4); `setMain`, `escHtml`, `fmtE`, `el`, `api` già esistenti; classi CSS `page-header`, `page-title`, `page-subtitle`, `page-actions`, `page-body`, `table-card`, `table-scroll`, `td-muted`, `section-card`, `section-card-title`, `btn-outline`, `btn-primary` già esistenti (riuso 1:1 dal pannello "Gestione piani").
- Produces: `renderConcorrentiAdmin()`, agganciata a `navigate('concorrenti')` e ad una nuova voce di sidebar.

- [ ] **Step 1: Aggiungi la voce di sidebar**

In `buildSidebar()` (`public/app.js:119-130`), dopo la voce "Gestione piani":

```javascript
    <div class="nav-item ${isActive('piani')}" onclick="navigate('piani')">
      <span class="nav-icon">💰</span> Gestione piani
    </div>
    <div class="nav-item ${isActive('concorrenti')}" onclick="navigate('concorrenti')">
      <span class="nav-icon">🏷️</span> Gestione concorrenti
    </div>
  `;
```

- [ ] **Step 2: Aggiungi il case nello switch di `navigate()`**

In `navigate()` (`public/app.js:168-185`):

```javascript
    case 'piani':       renderPiani();                                  break;
    case 'concorrenti': renderConcorrentiAdmin();                       break;
  }
```

- [ ] **Step 3: Implementa il pannello admin**

Dopo la fine della sezione admin piani (dopo `public/app.js:1400`, prima del commento `// ROI CALCOLATORE`), aggiungi:

```javascript
// ══════════════════════════════════════════════════
// GESTIONE CONCORRENTI
// ══════════════════════════════════════════════════

async function renderConcorrentiAdmin() {
  let elenco;
  try { elenco = await api('/api/concorrenti'); }
  catch (e) {
    setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Errore</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
    return;
  }

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Gestione concorrenti</div>
        <div class="page-subtitle">${elenco.length} concorrenti importati</div>
      </div>
      <div class="page-actions">
        <label class="btn-outline" for="concorrenti-import-input">📥 Importa listino Excel</label>
        <input type="file" id="concorrenti-import-input" accept=".xlsx,.xls" style="display:none" onchange="avviaImportConcorrente(this)">
      </div>
    </div>
    <div class="page-body">
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Nome</th><th>Data import</th><th>Esami</th><th>Mappati</th><th></th></tr></thead>
            <tbody>
              ${elenco.map(c => `<tr>
                <td>${escHtml(c.nome)}</td>
                <td class="td-muted">${fmtDate(c.data_import)}</td>
                <td class="td-muted">${c.n_esami}</td>
                <td class="td-muted">${c.n_mappati} / ${c.n_esami}</td>
                <td><button class="btn-outline" onclick="renderConcorrenteDettaglio(${c.id})">Vedi esami</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div id="concorrente-import-wrap"></div>
      <div id="concorrente-dettaglio-wrap"></div>
    </div>
  `);
}

async function avviaImportConcorrente(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  let parsed;
  try {
    const resp = await fetch('/api/concorrenti/import', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error((await resp.json()).error);
    parsed = await resp.json();
  } catch (e) {
    alert('Errore lettura file: ' + e.message);
    inputEl.value = '';
    return;
  }
  inputEl.value = '';

  if (!parsed.headers.length || !parsed.rows.length) {
    alert('Non sono riuscito a trovare una riga di intestazione con almeno 2 colonne in questo file.');
    return;
  }

  window._importConcorrenteRows = parsed.rows;
  renderImportConcorrenteForm(parsed);
}

function renderImportConcorrenteForm(parsed) {
  const wrap = el('concorrente-import-wrap');
  if (!wrap) return;
  const opts = parsed.headers.map((h, i) => `<option value="${i}">[${i}] ${escHtml(h || '(vuota)')}</option>`).join('');
  const optsConSconto = `<option value="-1">— nessuna colonna sconto —</option>` + opts;

  const anteprima = parsed.rows.slice(0, 5).map(r =>
    `<tr>${parsed.headers.map((_, i) => `<td>${escHtml(r[i])}</td>`).join('')}</tr>`
  ).join('');

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Conferma colonne — ${parsed.rows.length} righe trovate</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <label>Nome concorrente<br>
          <input class="roi-input" id="import-nome-concorrente" placeholder="Es. IDEXX 2026" style="width:200px">
        </label>
        <label>Colonna nome esame<br>
          <select class="roi-input" id="import-col-esame" style="width:200px">${opts}</select>
        </label>
        <label>Colonna prezzo<br>
          <select class="roi-input" id="import-col-prezzo" style="width:200px">${opts}</select>
        </label>
        <label>Colonna sconto<br>
          <select class="roi-input" id="import-col-sconto" style="width:200px">${optsConSconto}</select>
        </label>
      </div>
      <div class="table-scroll" style="margin-bottom:12px">
        <table><thead><tr>${parsed.headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${anteprima}</tbody></table>
      </div>
      <button class="btn-primary" onclick="confermaImportConcorrente()">Conferma import</button>
    </div>
  `;
  const selEsame = el('import-col-esame');
  const selPrezzo = el('import-col-prezzo');
  const selSconto = el('import-col-sconto');
  if (selEsame && parsed.colEsame >= 0) selEsame.value = String(parsed.colEsame);
  if (selPrezzo && parsed.colPrezzo >= 0) selPrezzo.value = String(parsed.colPrezzo);
  if (selSconto) selSconto.value = String(parsed.colSconto);
}

async function confermaImportConcorrente() {
  const nomeConcorrente = el('import-nome-concorrente')?.value.trim();
  const colEsame  = Number(el('import-col-esame')?.value);
  const colPrezzo = Number(el('import-col-prezzo')?.value);
  const colSconto = Number(el('import-col-sconto')?.value);
  const rows = window._importConcorrenteRows || [];

  if (!nomeConcorrente) return alert('Inserisci il nome del concorrente');
  if (!rows.length) return alert('Nessuna riga da importare');

  try {
    await api('/api/concorrenti/import/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeConcorrente, colEsame, colPrezzo, colSconto, rows })
    });
    await loadConcorrenti();
    renderConcorrentiAdmin();
    alert('Import completato.');
  } catch (e) {
    alert('Errore import: ' + e.message);
  }
}

async function renderConcorrenteDettaglio(id) {
  let dettaglio;
  try { dettaglio = await api(`/api/concorrenti/${id}`); }
  catch (e) { alert('Errore: ' + e.message); return; }

  const wrap = el('concorrente-dettaglio-wrap');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Esami — ${escHtml(dettaglio.concorrente.nome)}</div>
      <table class="roi-editable-table">
        <thead><tr><th>Nome originale</th><th>Prezzo</th><th>Sconto</th><th>Stato</th><th>Nome Mylav</th><th></th></tr></thead>
        <tbody>
          ${dettaglio.esami.map(e => `<tr>
            <td>${escHtml(e.nome_originale)}</td>
            <td class="td-muted">${fmtE(e.prezzo)}</td>
            <td class="td-muted">${e.sconto != null ? e.sconto + '%' : '—'}</td>
            <td>${e.esame_mylav_nome ? (e.confermato ? '✅ confermato' : '🔎 auto') : '— non mappato'}</td>
            <td><input class="roi-input" data-esame-concorrente-id="${e.id}" value="${escHtml(e.esame_mylav_nome || '')}" placeholder="nome esame Mylav" style="width:180px"></td>
            <td style="display:flex;gap:6px">
              <button class="btn-outline" onclick="salvaMappaturaManuale(${id}, ${e.id})">Salva</button>
              ${e.esame_mylav_nome ? `<button class="btn-outline" onclick="rimuoviMappaturaManuale(${id}, ${e.id})">Rimuovi</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function salvaMappaturaManuale(concorrenteId, esameConcorrenteId) {
  const inp = document.querySelector(`[data-esame-concorrente-id="${esameConcorrenteId}"]`);
  const esameMylavNome = inp ? inp.value.trim() : '';
  if (!esameMylavNome) return alert('Scrivi il nome esame Mylav corrispondente');
  try {
    await fetch(`/api/concorrenti/${concorrenteId}/conferma-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId, esameMylavNome })
    });
    alert('Mappatura salvata.');
  } catch (e) { alert('Errore: ' + e.message); }
}

async function rimuoviMappaturaManuale(concorrenteId, esameConcorrenteId) {
  try {
    await fetch(`/api/concorrenti/${concorrenteId}/rimuovi-match`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ esameConcorrenteId })
    });
    renderConcorrenteDettaglio(concorrenteId);
  } catch (e) { alert('Errore: ' + e.message); }
}
```

- [ ] **Step 4: Verifica manuale nel browser**

1. Vai su "Gestione concorrenti" dalla sidebar.
2. Importa un piccolo file Excel con 2-3 colonne (nome esame, prezzo, sconto opzionale).
3. Verifica che la preview mostri le colonne rilevate e le prime righe.
4. Correggi eventualmente i dropdown, inserisci un nome concorrente, conferma.
5. Verifica che il concorrente compaia nella lista con il conteggio esami corretto.
6. Apri "Vedi esami", scrivi manualmente un nome Mylav su una riga, clicca "Salva", verifica l'alert di conferma e che la riga mostri "✅ confermato" dopo un refresh (`renderConcorrenteDettaglio(id)` di nuovo).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(concorrenza): pannello amministrazione import Excel e correzione manuale mappature"
```

---

### Task 9: Final — revisione whole-branch

**Files:** nessuno (solo verifica)

**Interfaces:** nessuna nuova — verifica end-to-end di tutto quanto costruito nei Task 1-8.

- [ ] **Step 1: Esegui l'intera suite di test**

Run: `npm test`
Expected: PASS — tutti i test in `lib/*.test.js`, inclusi quelli di `lib/piani.test.js` (nessuna regressione) e i nuovi di `lib/concorrenti.test.js`

- [ ] **Step 2: Verifica manuale end-to-end nel browser**

1. Importa un concorrente reale (o un file Excel di prova con 5-10 esami, alcuni con nomi molto simili a quelli Mylav e alcuni molto diversi).
2. Nel Calcolatore ROI, seleziona quel concorrente.
3. Digita/seleziona esami Mylav con nomi via via più simili/diversi da quelli del concorrente e verifica tutti e tre i casi: autofill silenzioso (match sicuro), banner di conferma (match incerto), nessuna azione (nessun match).
4. Verifica che selezionare contemporaneamente un Piano Mylav e un Concorrente mostri entrambi i banner senza sovrapporsi visivamente (Task 5).
5. Ricarica la pagina e ripeti lo stesso esame già confermato in precedenza: verifica che l'autofill avvenga subito, senza ripassare dal banner (lookup esatto su `esame_mylav_nome`).
6. Re-importa lo stesso file Excel del concorrente con un prezzo cambiato: verifica che il prezzo si aggiorni ma la mappatura confermata al punto 5 resti intatta.
7. Verifica che togliendo il concorrente selezionato ("— Nessun concorrente —") i campi `Listino conc.`/`Sconto%` restino modificabili a mano come prima di questa feature (nessuna regressione sul comportamento base).

- [ ] **Step 3: Pulizia dati di test**

Se sono stati creati concorrenti/esami di prova nel DB reale durante la verifica (es. "Test Import" del Task 3), valuta con l'utente se rimuoverli. Non esiste ancora una rotta `DELETE /api/concorrenti/:id` in questo piano — se serve rimuoverli, va fatto in un piano successivo o concordato esplicitamente col proprietario del DB prima di qualunque intervento diretto sul database.

- [ ] **Step 4: Commit finale (se sono stati necessari fix durante la revisione)**

```bash
git add -A
git commit -m "fix(concorrenza): sistemazioni emerse dalla revisione end-to-end"
```

Se non sono stati necessari fix, questo step si salta.
