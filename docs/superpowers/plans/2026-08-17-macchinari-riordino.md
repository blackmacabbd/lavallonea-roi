# Macchinari — riordino per listini — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riordinare il modulo Macchinari per listini importati, togliere lo smistamento automatico degli import, e spostare il confronto in una sezione propria.

**Architecture:** Le macchine appartengono a un listino (`listini_macchine`), che porta il nome del file e la provenienza; `macchine` perde `user_id` e `concorrente_id` e guadagna `listino_id`. La conferma di un import scrive in una sola destinazione. La sezione Macchinari diventa a due livelli come Gestione concorrenti, e il confronto ha una voce di menu propria.

**Tech Stack:** Node/Express, `node:sqlite` (`DatabaseSync`), JS vanilla senza build, test con `node:test` (`npm test` = `node --test lib/*.test.js`).

## Global Constraints

- Nessuna dipendenza nuova.
- `npm test` verde alla fine di ogni task. La suite impiega alcuni minuti: per i cicli rapidi eseguire il singolo file (`node --test lib/macchine.test.js`).
- Ogni lettura e scrittura vincolata all'account autenticato. `macchine` non ha piu' `user_id`: l'appartenenza si verifica risalendo al listino.
- Nessuna regressione su Gestione piani e Gestione concorrenti, che tornano al comportamento precedente al modulo Macchinari: ogni riga di un import e' un esame.
- Il modulo non e' mai stato pushato e in produzione non esistono macchine: lo schema si ristruttura senza migrazioni.
- Testi dell'interfaccia in italiano con accenti corretti; commenti nel codice senza accenti (il progetto scrive `e'` al posto di «è»).
- Palette e componenti gia' in uso: `--ink`, `--blue`, `--blue-tint`, `--red`, `--muted`, `.table-card`, `.btn-outline`, `.btn-primary`, `.roi-input`, `.roi-toolbar`, `.page-header`, `.section-card`.
- Avviso della sezione Macchinari, verbatim: «Carica qui soltanto listini di analizzatori. Ogni riga del file verrà importata come macchina, comprese quelle che sembrano esami: se il PDF contiene anche prezzi di esami, importalo in Gestione piani o in Gestione concorrenti.»
- Nessun push.
- Gli account di prova creati nelle verifiche vanno rimossi al termine di ogni task: lo stato di partenza e' 11 utenti, 0 macchine, 0 concorrenti.

---

## File Structure

| File | Responsabilita' | Task |
|---|---|---|
| `lib/macchine.js` | listini e macchine, eliminazione a cascata | 1 |
| `lib/macchine.test.js` | test di libreria | 1 |
| `lib/concorrenti.js` | eliminazione concorrente che porta via i suoi listini | 1 |
| `lib/concorrenti.test.js` | test della cascata | 1 |
| `server.js` | conferma a una destinazione, rotte listini e macchine | 2 |
| `public/importpdf.js` | revisione a tabella singola, selettore provenienza | 2 |
| `public/app.js` | Macchinari a due livelli, sezione Confronto macchine | 3, 4 |
| `public/style.css` | stili delle due sezioni | 3, 4 |

---

### Task 1: Listini e macchine

**Files:**
- Modify: `lib/macchine.js` (riscrittura quasi completa)
- Modify: `lib/macchine.test.js` (riscrittura quasi completa)
- Modify: `lib/concorrenti.js` (funzione `eliminaConcorrente`)
- Modify: `lib/concorrenti.test.js`

**Interfaces:**
- Consumes: la tabella `concorrenti` (`id, nome, user_id, data_import`) creata da `lib/concorrenti.js`; `parsePrezzo` esportata da `lib/pdfclassifica.js`.
- Produces, tutte da `lib/macchine.js`:
  - `ensureSchema(db)`
  - `creaListino(db, { userId, nome, concorrenteId })` → `{ id }`
  - `listaListini(db, userId)` → `[{ id, nome, concorrenteId, concorrenteNome, nMacchine, dataImport }]`, ordinati dal piu' recente
  - `getListino(db, id, userId)` → `{ id, nome, concorrenteId, concorrenteNome, dataImport }` oppure `null`
  - `eliminaListino(db, id, userId)` → `boolean`
  - `upsertMacchine(db, { listinoId, userId, righe })` → `{ salvate }`, con `righe` di forma `{nome, prezzo, note}`
  - `macchineDiListino(db, listinoId, userId)` → `[{ id, nome, prezzo, note }]` ordinate per prezzo
  - `listaMacchine(db, userId)` → `[{ id, nome, prezzo, note, listinoId, listinoNome, concorrenteId, concorrenteNome }]`, tutte le macchine dell'account
  - `salvaMacchina(db, { id, listinoId, userId, nome, prezzo, note })` → `{ id }`
  - `eliminaMacchina(db, id, userId)` → `boolean`

I task 2, 3 e 4 dipendono da questi nomi.

- [ ] **Step 1: Riscrivere i test**

Sostituire l'intero contenuto di `lib/macchine.test.js` con:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const macchine = require('./macchine.js');
const concorrenti = require('./concorrenti.js');

function dbVuoto() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  concorrenti.ensureSchema(db);
  macchine.ensureSchema(db);
  return db;
}

const RIGHE = [
  { nome: 'Analizzatore biochimico', prezzo: 8500 },
  { nome: 'Ematologico veterinario', prezzo: 11200 }
];

// Listino proprio con due macchine, la situazione piu' comune.
function conListino(db, userId = 1, concorrenteId = null) {
  const { id } = macchine.creaListino(db, { userId, nome: 'listino-2026.pdf', concorrenteId });
  macchine.upsertMacchine(db, { listinoId: id, userId, righe: RIGHE });
  return id;
}

test('ensureSchema crea le due tabelle ed e idempotente', () => {
  const db = dbVuoto();
  macchine.ensureSchema(db);
  const tabelle = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tabelle.includes('listini_macchine'));
  assert.ok(tabelle.includes('macchine'));
  db.close();
});

test('creaListino e listaListini: nome, provenienza e conteggio', () => {
  const db = dbVuoto();
  conListino(db);
  const lista = macchine.listaListini(db, 1);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'listino-2026.pdf');
  assert.equal(lista[0].concorrenteId, null);
  assert.equal(lista[0].nMacchine, 2);
  assert.ok(lista[0].dataImport);
  db.close();
});

test('un listino di un concorrente riporta il nome del concorrente', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  conListino(db, 1, concorrenteId);
  const lista = macchine.listaListini(db, 1);
  assert.equal(lista[0].concorrenteId, concorrenteId);
  assert.equal(lista[0].concorrenteNome, 'IDEXX');
  db.close();
});

test('creaListino rifiuta il concorrente di un altro account', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX RISERVATO', [], 2);
  assert.throws(() => macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId }), /non trovato/i);
  assert.equal(macchine.listaListini(db, 1).length, 0);
  db.close();
});

test('i listini di un account non sono visibili a un altro', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.equal(macchine.listaListini(db, 2).length, 0);
  assert.equal(macchine.getListino(db, id, 2), null);
  assert.equal(macchine.macchineDiListino(db, id, 2).length, 0);
  db.close();
});

test('lo stesso nome macchina puo esistere in due listini diversi', () => {
  const db = dbVuoto();
  const mio = conListino(db, 1);
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  const suo = macchine.creaListino(db, { userId: 1, nome: 'idexx.pdf', concorrenteId }).id;
  macchine.upsertMacchine(db, { listinoId: suo, userId: 1, righe: [{ nome: 'Analizzatore biochimico', prezzo: 9900 }] });
  assert.equal(macchine.macchineDiListino(db, mio, 1).find(m => m.nome === 'Analizzatore biochimico').prezzo, 8500);
  assert.equal(macchine.macchineDiListino(db, suo, 1)[0].prezzo, 9900);
  db.close();
});

test('reimportare lo stesso nome nello stesso listino aggiorna il prezzo', () => {
  const db = dbVuoto();
  const id = conListino(db);
  macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [{ nome: 'Analizzatore biochimico', prezzo: 7900 }] });
  const lista = macchine.macchineDiListino(db, id, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista.find(m => m.nome === 'Analizzatore biochimico').prezzo, 7900);
  db.close();
});

test('upsertMacchine rifiuta un listino di un altro account', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.throws(() => macchine.upsertMacchine(db, { listinoId: id, userId: 2, righe: RIGHE }), /non trovato/i);
  db.close();
});

test('prezzo in formato italiano interpretato correttamente', () => {
  const db = dbVuoto();
  const { id } = macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId: null });
  macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [{ nome: 'Pannello', prezzo: '1.234,56' }] });
  assert.equal(macchine.macchineDiListino(db, id, 1)[0].prezzo, 1234.56);
  db.close();
});

test('righe senza nome o con prezzo non valido sono ignorate', () => {
  const db = dbVuoto();
  const { id } = macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId: null });
  const r = macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [
    { nome: 'Buona', prezzo: 100 }, { nome: '', prezzo: 50 }, { nome: 'Senza prezzo', prezzo: null }
  ] });
  assert.equal(r.salvate, 1);
  db.close();
});

test('listaMacchine restituisce tutte le macchine con listino e provenienza', () => {
  const db = dbVuoto();
  conListino(db, 1);
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  const suo = macchine.creaListino(db, { userId: 1, nome: 'idexx.pdf', concorrenteId }).id;
  macchine.upsertMacchine(db, { listinoId: suo, userId: 1, righe: [{ nome: 'Suo analizzatore', prezzo: 9900 }] });
  const tutte = macchine.listaMacchine(db, 1);
  assert.equal(tutte.length, 3);
  const suoRecord = tutte.find(m => m.nome === 'Suo analizzatore');
  assert.equal(suoRecord.concorrenteNome, 'IDEXX');
  assert.equal(suoRecord.listinoNome, 'idexx.pdf');
  assert.equal(tutte.filter(m => !m.concorrenteId).length, 2);
  db.close();
});

test('listaMacchine non mostra le macchine di un altro account', () => {
  const db = dbVuoto();
  conListino(db, 1);
  assert.equal(macchine.listaMacchine(db, 2).length, 0);
  db.close();
});

test('eliminaListino porta via le sue macchine', () => {
  const db = dbVuoto();
  const id = conListino(db);
  assert.equal(macchine.eliminaListino(db, id, 1), true);
  assert.equal(macchine.listaListini(db, 1).length, 0);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('un altro account non puo eliminare il listino altrui', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.equal(macchine.eliminaListino(db, id, 2), false);
  assert.equal(macchine.listaListini(db, 1).length, 1);
  db.close();
});

test('salvaMacchina inserisce dentro il listino e aggiorna', () => {
  const db = dbVuoto();
  const listinoId = conListino(db);
  const { id } = macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Aggiunta a mano', prezzo: 4300 });
  assert.ok(id);
  macchine.salvaMacchina(db, { id, listinoId, userId: 1, nome: 'Aggiunta a mano', prezzo: 4100, note: 'ricondizionato' });
  const m = macchine.macchineDiListino(db, listinoId, 1).find(x => x.id === id);
  assert.equal(m.prezzo, 4100);
  assert.equal(m.note, 'ricondizionato');
  db.close();
});

test('salvaMacchina rifiuta un nome duplicato nello stesso listino, in inserimento e in modifica', () => {
  const db = dbVuoto();
  const listinoId = conListino(db);
  assert.throws(() => macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Analizzatore biochimico', prezzo: 1 }), /esiste gia/i);
  const { id } = macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Terza', prezzo: 1 });
  assert.throws(() => macchine.salvaMacchina(db, { id, listinoId, userId: 1, nome: 'Analizzatore biochimico', prezzo: 1 }), /esiste gia/i);
  db.close();
});

test('un altro account non puo modificare la macchina altrui', () => {
  const db = dbVuoto();
  const listinoId = conListino(db, 1);
  const id = macchine.macchineDiListino(db, listinoId, 1)[0].id;
  assert.throws(() => macchine.salvaMacchina(db, { id, listinoId, userId: 2, nome: 'Rubata', prezzo: 1 }), /non trovat/i);
  assert.equal(macchine.macchineDiListino(db, listinoId, 1)[0].nome, 'Analizzatore biochimico');
  db.close();
});

test('eliminaMacchina rimuove solo la propria', () => {
  const db = dbVuoto();
  const listinoId = conListino(db, 1);
  const id = macchine.macchineDiListino(db, listinoId, 1)[0].id;
  assert.equal(macchine.eliminaMacchina(db, id, 2), false);
  assert.equal(macchine.eliminaMacchina(db, id, 1), true);
  assert.equal(macchine.macchineDiListino(db, listinoId, 1).length, 1);
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/macchine.test.js`
Expected: FAIL, `macchine.creaListino is not a function`.

- [ ] **Step 3: Riscrivere il modulo**

Sostituire l'intero contenuto di `lib/macchine.js` con:

```javascript
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
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test lib/macchine.test.js`
Expected: PASS, 18 test verdi.

- [ ] **Step 5: Aggiornare l'eliminazione di un concorrente**

In `lib/concorrenti.js`, dentro `eliminaConcorrente`, la riga `db.prepare(\`DELETE FROM macchine WHERE concorrente_id = ?\`).run(cid);` (riga 183 circa) non e' piu' valida: quella colonna non esiste piu'. Sostituire quella riga e il commento che la precede con:

```javascript
    // I listini di analizzatori di questo concorrente, e le loro macchine, se ne
    // vanno con lui: senza questo la chiave esterna bloccherebbe la cancellazione
    // e il concorrente non si potrebbe piu' eliminare. Non vanno lasciati orfani
    // ne' trasformati in listini propri, che sarebbe un dato falso: l'interfaccia
    // promette gia' che eliminare il concorrente elimina i suoi dati.
    db.prepare(`
      DELETE FROM macchine WHERE listino_id IN (
        SELECT id FROM listini_macchine WHERE concorrente_id = ?
      )
    `).run(cid);
    db.prepare(`DELETE FROM listini_macchine WHERE concorrente_id = ?`).run(cid);
```

La variabile che contiene l'id in quella funzione si chiama `cid`. Il blocco resta dentro la transazione gia' presente, fra la cancellazione di `esami_concorrente` e quella del concorrente.

- [ ] **Step 6: Aggiornare il test della cascata**

In `lib/concorrenti.test.js` esiste un test che elimina un concorrente con esami e macchine. Adattarlo allo schema nuovo: la macchina va creata dentro un listino di quel concorrente, e dopo l'eliminazione non devono restare ne' listini ne' macchine.

```javascript
test('eliminare un concorrente porta via anche i suoi listini di macchine', () => {
  const db = dbConSchema();
  db.exec('PRAGMA foreign_keys = ON');
  macchine.ensureSchema(db);
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [{ nome_originale: 'EMOCROMO', prezzo: 18.5 }], 1);
  const listino = macchine.creaListino(db, { userId: 1, nome: 'idexx.pdf', concorrenteId }).id;
  macchine.upsertMacchine(db, { listinoId: listino, userId: 1, righe: [{ nome: 'Analizzatore', prezzo: 8500 }] });

  assert.equal(concorrenti.eliminaConcorrente(db, concorrenteId, 1), true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM concorrenti').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM listini_macchine').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM macchine').get().c, 0);
  db.close();
});
```

Adattare `dbConSchema` al nome dell'helper realmente presente nel file, e aggiungere in cima il `require` di `./macchine.js` se manca. Verificare che il test fallisca togliendo la correzione dello Step 5.

- [ ] **Step 7: Eseguire i test**

Run: `node --test lib/macchine.test.js lib/concorrenti.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/macchine.js lib/macchine.test.js lib/concorrenti.js lib/concorrenti.test.js
git commit -m "refactor: le macchine appartengono a un listino, non piu direttamente all'account"
```

---

### Task 2: Import a una sola destinazione

**Files:**
- Modify: `server.js`
- Modify: `public/importpdf.js`

**Interfaces:**
- Consumes: le funzioni di `lib/macchine.js` del Task 1.
- Produces:
  - `POST /api/import-pdf/:id/conferma` scrive in **una** destinazione. Per `entita === 'macchina'` crea un listino e risponde con `listinoId`. La risposta non ha piu' `esamiImportati` ne' `macchineImportate`.
  - Rotte nuove: `GET /api/listini-macchine`, `GET /api/listini-macchine/:id` (con le sue macchine), `DELETE /api/listini-macchine/:id`.
  - Le rotte `POST /api/macchine` e `PUT /api/macchine/:id` accettano `listinoId` invece di `concorrenteId`.
  - `GET /api/macchine` resta e restituisce tutte le macchine dell'account con listino e provenienza.

I task 3 e 4 dipendono da questi nomi.

- [ ] **Step 1: Riportare la conferma a una destinazione**

In `server.js`, dentro `app.post('/api/import-pdf/:id/conferma', ...)`, sostituire tutto il blocco che smista i due gruppi (da `const perTipo` fino alla `res.json` finale) con:

```javascript
    // Una sola destinazione per import. Le macchine entrano solo dalla sezione
    // Macchinari: uno smistamento automatico spostava righe in una sezione che
    // l'operatore non aveva scelto, e una singola riga riconosciuta male bastava
    // a tipizzare male tutte le successive.
    let risultato = {};
    if (bozza.entita === 'concorrente') {
      const nomeConc = String(nome || '').trim();
      if (!nomeConc) return res.status(400).json({ error: 'Manca il nome del concorrente' });
      risultato = concorrenti.upsertConcorrente(
        db, nomeConc,
        valide.map(r => ({ nome_originale: r.nome, prezzo: r.prezzo, sconto: null })),
        req.user.id
      );
    } else if (bozza.entita === 'macchina') {
      // Ogni import crea il suo listino: il nome del file lo identifica, la
      // provenienza scelta dall'operatore dice di chi sono quelle macchine.
      const listino = macchineLib.creaListino(db, {
        userId: req.user.id,
        nome: bozza.nomeFile,
        concorrenteId: req.body && req.body.concorrenteId
      });
      macchineLib.upsertMacchine(db, {
        listinoId: listino.id, userId: req.user.id,
        righe: valide.map(r => ({ nome: r.nome, prezzo: r.prezzo, note: null }))
      });
      risultato = { listinoId: listino.id };
    } else {
      // Aggiorna i prezzi base della PROPRIA copia del catalogo: upsert per nome,
      // nessuna cancellazione degli esami assenti dal PDF e nessun piano toccato.
      risultato = piani.upsertFromJson(db, {
        exams_base_price: Object.fromEntries(valide.map(r => [r.nome, r.prezzo])),
        plans: {}
      }, req.user.id);
    }

    const confermata = importbozze.confermaBozza(db, bozza.id, req.user.id, valide);
    if (!confermata) return res.status(409).json({ error: 'Questa bozza e stata gia confermata' });

    annota('confermato',
      `${valide.length} righe importate, ${ignorate} ignorate${duplicate ? `, ${duplicate} duplicate accorpate` : ''}`,
      { nRighe: valide.length });
    res.json({ success: true, entita: bozza.entita, importate: valide.length, ignorate, duplicate, ...risultato });
```

- [ ] **Step 2: Sostituire le rotte delle macchine**

In `server.js`, sostituire il blocco delle rotte `/api/macchine` (dalla riga di commento `// ── Macchinari (analizzatori) ──` fino alla fine della `DELETE /api/macchine/:id`) con:

```javascript
// ── Macchinari (analizzatori) ──────────────────────
// Un errore che dice "non trovato" e' una risorsa inesistente per questo
// account: 404. Gli altri sono dati non validi: 400.
const ERRORI_NON_TROVATO = /non trovat/i;
function statoErroreMacchina(err) {
  return ERRORI_NON_TROVATO.test(String(err && err.message)) ? 404 : 400;
}

app.get('/api/listini-macchine', requireAuth, (req, res) => {
  try { res.json(macchineLib.listaListini(db, req.user.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/listini-macchine/:id', requireAuth, (req, res) => {
  try {
    const listino = macchineLib.getListino(db, req.params.id, req.user.id);
    if (!listino) return res.status(404).json({ error: 'Listino non trovato' });
    res.json({ ...listino, macchine: macchineLib.macchineDiListino(db, req.params.id, req.user.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/listini-macchine/:id', requireAuth, (req, res) => {
  try {
    const ok = macchineLib.eliminaListino(db, req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Listino non trovato' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/macchine', requireAuth, (req, res) => {
  try { res.json(macchineLib.listaMacchine(db, req.user.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/macchine', requireAuth, express.json(), (req, res) => {
  try {
    const { listinoId, nome, prezzo, note } = req.body || {};
    res.json({ success: true, ...macchineLib.salvaMacchina(db, { userId: req.user.id, listinoId, nome, prezzo, note }) });
  } catch (err) { res.status(statoErroreMacchina(err)).json({ error: err.message }); }
});

app.put('/api/macchine/:id', requireAuth, express.json(), (req, res) => {
  try {
    const { listinoId, nome, prezzo, note } = req.body || {};
    res.json({ success: true, ...macchineLib.salvaMacchina(db, { id: req.params.id, userId: req.user.id, listinoId, nome, prezzo, note }) });
  } catch (err) { res.status(statoErroreMacchina(err)).json({ error: err.message }); }
});

app.delete('/api/macchine/:id', requireAuth, (req, res) => {
  try {
    const ok = macchineLib.eliminaMacchina(db, req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Macchina non trovata' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 3: Riportare la revisione a una tabella sola**

In `public/importpdf.js`:

1. In `renderTabella`, tornare a una sola tabella: eliminare la costruzione dei due blocchi e la funzione `gruppoHtml`, e disegnare tutte le righe di `S.righe` in un'unica tabella con le stesse colonne di prima (`#`, `Esame`/`Nome`, `Prezzo`, `Stato`, colonna azioni).
2. In `rigaHtml`, togliere il pulsante di spostamento `⇄` e riportare la colonna azioni al solo `✕`, con la larghezza originale di 34px.
3. Eliminare la funzione `spostaRiga` e il suo listener in `renderTabella`.
4. In `renderBanner`, togliere la riga che dichiarava le destinazioni dei due gruppi. Conservare invece **solo** l'avviso per il caso Macchinari senza analizzatori riconosciuti, che ora e' l'unico uso del campo `tipo`:

```javascript
    // Unico uso rimasto del tipo di riga: se in un import verso Macchinari non
    // si riconosce nessun analizzatore, quel PDF sembra un listino di esami.
    // Avvisa senza bloccare: la scelta resta dell'operatore.
    if (S.entita === 'macchina' && S.analisi.macchine === 0) {
      messaggio += `<div class="imp-banner-dest">Nessun analizzatore riconosciuto: questo documento sembra un listino di esami, mentre qui si importano solo analizzatori. Puoi proseguire comunque, se è quello che intendevi.</div>`;
    }
```

5. In `valide()`, togliere il campo `tipo` dal corpo inviato: il server non lo usa piu'.
6. In `costruisciModello`, `aggiungiRiga` e `recuperaRiga`, togliere il campo `tipo` dagli oggetti riga.
7. Nel messaggio finale dopo la conferma, togliere la parte che distingueva esami e macchine e tornare al conteggio unico.
8. In `conferma()`, il corpo inviato deve contenere anche `concorrenteId` quando la destinazione e' `macchina`, preso dal selettore di provenienza gia' presente nella finestra.

In `public/style.css`, eliminare le regole diventate inutili: `.imp-gruppo`, `.imp-gruppo-tit`, `.imp-gruppo-dove`, `.imp-x-sposta`, `--imp-gruppo-tit-h` e la regola `.imp-gruppo .imp-tabella thead th`.

- [ ] **Step 4: Verificare la sintassi e i test**

Run:
```bash
node --check server.js && node --check public/importpdf.js && node --test lib/importbozze.test.js lib/macchine.test.js
```
Expected: tutto verde.

- [ ] **Step 5: Verificare i tre percorsi di import**

Avviare il server (`node server.js`) e creare un account di prova (`POST /api/auth/register`, email che finisce per `@test.it`, password `Password123!`).

Con la fixture `lib/fixtures/listino-misto-macchine.pdf`, che contiene 3 esami e 3 analizzatori:

1. `entita=piano` → conferma: la risposta deve riportare `importate: 6` e nessun `listinoId`; `GET /api/listini-macchine` deve restare vuoto (nessuno smistamento automatico), e le 6 righe devono essere nei prezzi base del catalogo.
2. `entita=concorrente` con un nome → conferma: 6 esami al concorrente, `GET /api/listini-macchine` ancora vuoto.
3. `entita=macchina` → conferma: la risposta contiene `listinoId`, `GET /api/listini-macchine` mostra un listino con 6 macchine.

**Al termine rimuovere l'account di prova e tutte le sue righe.**

- [ ] **Step 6: Commit**

```bash
git add server.js public/importpdf.js public/style.css
git commit -m "refactor: un import scrive in una sola destinazione, niente piu smistamento automatico"
```

---

### Task 3: Macchinari a due livelli

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/listini-macchine`, `GET /api/listini-macchine/:id`, `DELETE /api/listini-macchine/:id`, `POST /api/macchine`, `PUT /api/macchine/:id`, `DELETE /api/macchine/:id` (Task 2); `ImportPdf.avvia({ entita: 'macchina', alFine })`.
- Produces: `renderMacchinari()` mostra l'elenco dei listini; `renderListinoMacchine(id)` mostra le macchine di un listino. Il Task 4 non dipende da queste funzioni.

- [ ] **Step 1: Sostituire la pagina Macchinari**

In `public/app.js`, sostituire `renderMacchinari` e le funzioni collegate (`importaPdfMacchine`, `nuovaMacchina`, `modificaMacchina`, `annullaModificaMacchina`, `salvaMacchinaUI`, `eliminaMacchinaUI`, `provenienzaMacchinaSelectHtml`) con la struttura a due livelli. Modello da seguire: `renderConcorrentiAdmin` e `renderConcorrenteDettaglio`, che risolvono lo stesso problema per gli esami di concorrenza.

Primo livello, elenco dei listini:

```javascript
// ── Macchinari (analizzatori) ──
// Due livelli come Gestione concorrenti: prima i listini importati, poi le
// macchine di quello aperto. Le macchine entrano solo da un import PDF.
async function renderMacchinari() {
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  let listini = [];
  if (loggato) {
    try { listini = await api('/api/listini-macchine'); }
    catch (e) {
      setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
        <div class="empty-title">Errore</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
      return;
    }
  }
  S.listiniMacchine = listini;

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Macchinari</div>
        <div class="page-subtitle">${listini.length} ${listini.length === 1 ? 'listino importato' : 'listini importati'}</div>
      </div>
      <div class="page-actions">
        ${loggato ? `<button class="btn-primary" onclick="importaPdfMacchine()">📄 Importa listino PDF</button>` : ''}
      </div>
    </div>
    <div class="page-body">
      <div class="macc-avviso">
        <span class="macc-avviso-ico">🔬</span>
        <div>Carica qui soltanto listini di analizzatori. Ogni riga del file verrà importata come macchina, comprese quelle che sembrano esami: se il PDF contiene anche prezzi di esami, importalo in Gestione piani o in Gestione concorrenti.</div>
      </div>
      ${loggato ? '' : `<div class="empty-state" style="padding:12px 16px;margin-bottom:14px;text-align:left">
        <div class="empty-sub">🔒 Accedi per gestire i tuoi macchinari.</div>
      </div>`}
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Listino</th><th>Provenienza</th><th style="width:110px">Macchine</th><th style="width:120px">Importato</th><th style="width:190px"></th></tr></thead>
            <tbody>
              ${listini.map(l => `<tr>
                <td>${escHtml(l.nome)}</td>
                <td class="td-muted">${l.concorrenteNome ? escHtml(l.concorrenteNome) : 'Mylav (mie)'}</td>
                <td class="td-muted">${l.nMacchine}</td>
                <td class="td-muted">${fmtDate(l.dataImport)}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="renderListinoMacchine(${l.id})">Vedi macchine</button>
                  <button class="btn-outline" onclick="eliminaListinoUI(${l.id})" style="color:var(--red);border-color:var(--red)">Elimina</button>
                </td>
              </tr>`).join('')}
              ${!listini.length ? `<tr><td colspan="5" class="td-muted" style="text-align:center;padding:26px">
                Nessun listino importato. Usa «Importa listino PDF» per aggiungerne uno.</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
      <div id="listino-macchine-wrap"></div>
    </div>
  `);
}

function importaPdfMacchine() {
  if (S.auth.guest || !S.auth.token) { alert('Accedi per importare un listino'); return; }
  ImportPdf.avvia({ entita: 'macchina', alFine: () => renderMacchinari() });
}

async function eliminaListinoUI(id) {
  const l = (S.listiniMacchine || []).find(x => x.id === id);
  const quante = l ? l.nMacchine : 0;
  if (!confirm(`Eliminare il listino "${l ? l.nome : ''}" e le sue ${quante} macchine?`)) return;
  try {
    await api(`/api/listini-macchine/${id}`, { method: 'DELETE' });
    renderMacchinari();
  } catch (e) { alert('Errore: ' + e.message); }
}
```

- [ ] **Step 2: Aggiungere il secondo livello**

Subito dopo, il dettaglio di un listino, con inserimento e modifica in riga:

```javascript
// Le macchine del listino aperto. L'aggiunta a mano serve a correggere o
// completare un import, quindi la riga nuova appartiene a questo listino: la
// provenienza non si richiede di nuovo, la eredita.
async function renderListinoMacchine(id) {
  let dettaglio;
  try { dettaglio = await api(`/api/listini-macchine/${id}`); }
  catch (e) { alert('Errore: ' + e.message); return; }

  S.listinoAperto = dettaglio;
  const wrap = el('listino-macchine-wrap');
  if (!wrap) return;
  const inMod = S.macchinaInModifica;

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">
        ${escHtml(dettaglio.nome)} —
        ${dettaglio.concorrenteNome ? escHtml(dettaglio.concorrenteNome) : 'Mylav (mie)'}
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px">
        <button class="btn-outline" onclick="nuovaMacchina(${id})">+ Aggiungi macchina</button>
        <button class="btn-ghost" onclick="chiudiListinoMacchine()">Chiudi</button>
      </div>
      <div class="table-scroll" style="max-height:420px;overflow-y:auto">
        <table>
          <thead><tr><th>Macchina</th><th style="width:120px">Prezzo</th><th style="width:170px"></th></tr></thead>
          <tbody>
            ${inMod ? `<tr class="macc-riga-modifica">
              <td><input class="roi-input" id="macc-nome" value="${escHtml(inMod.nome)}"
                         placeholder="Es. Analizzatore biochimico da banco" autocomplete="off"></td>
              <td><input class="roi-input roi-num" id="macc-prezzo" inputmode="decimal"
                         value="${inMod.prezzo === '' ? '' : escHtml(String(inMod.prezzo))}" placeholder="0,00"></td>
              <td style="display:flex;gap:6px">
                <button class="btn-primary" onclick="salvaMacchinaUI()">Salva</button>
                <button class="btn-outline" onclick="annullaModificaMacchina()">Annulla</button>
              </td>
            </tr>` : ''}
            ${dettaglio.macchine.filter(m => !inMod || m.id !== inMod.id).map(m => `<tr>
              <td>${escHtml(m.nome)}</td>
              <td class="td-num">${fmtEuro(m.prezzo)}</td>
              <td style="display:flex;gap:6px">
                <button class="btn-outline" onclick="modificaMacchina(${m.id})">Modifica</button>
                <button class="btn-outline" onclick="eliminaMacchinaUI(${m.id})" style="color:var(--red);border-color:var(--red)">Elimina</button>
              </td>
            </tr>`).join('')}
            ${!dettaglio.macchine.length && !inMod ? `<tr><td colspan="3" class="td-muted" style="text-align:center;padding:22px">
              Nessuna macchina in questo listino.</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>`;
}

function chiudiListinoMacchine() {
  S.listinoAperto = null;
  S.macchinaInModifica = null;
  const wrap = el('listino-macchine-wrap');
  if (wrap) wrap.innerHTML = '';
}

function nuovaMacchina(listinoId) {
  S.macchinaInModifica = { id: null, listinoId, nome: '', prezzo: '' };
  renderListinoMacchine(listinoId);
}

function modificaMacchina(id) {
  const l = S.listinoAperto;
  if (!l) return;
  const m = l.macchine.find(x => x.id === id);
  if (!m) return;
  S.macchinaInModifica = { id: m.id, listinoId: l.id, nome: m.nome, prezzo: m.prezzo };
  renderListinoMacchine(l.id);
}

function annullaModificaMacchina() {
  const l = S.listinoAperto;
  S.macchinaInModifica = null;
  if (l) renderListinoMacchine(l.id);
}

async function salvaMacchinaUI() {
  if (S.salvataggioMacchinaInCorso) return;
  const inMod = S.macchinaInModifica;
  if (!inMod) return;
  const nome = (el('macc-nome') || {}).value || '';
  const prezzoTesto = (el('macc-prezzo') || {}).value || '';
  const prezzo = parseFloat(String(prezzoTesto).replace(/\./g, '').replace(',', '.'));
  if (!nome.trim()) { alert('Inserisci il nome della macchina'); return; }
  if (!Number.isFinite(prezzo) || prezzo < 0) { alert('Inserisci un prezzo valido'); return; }

  S.salvataggioMacchinaInCorso = true;
  const corpo = JSON.stringify({ listinoId: inMod.listinoId, nome: nome.trim(), prezzo });
  try {
    if (inMod.id) {
      await api(`/api/macchine/${inMod.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: corpo });
    } else {
      await api('/api/macchine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
    }
    S.macchinaInModifica = null;
    await renderMacchinari();
    renderListinoMacchine(inMod.listinoId);
  } catch (e) { alert('Errore: ' + e.message); }
  finally { S.salvataggioMacchinaInCorso = false; }
}

async function eliminaMacchinaUI(id) {
  const l = S.listinoAperto;
  const m = l ? l.macchine.find(x => x.id === id) : null;
  if (!confirm(`Eliminare "${m ? m.nome : 'questa macchina'}" dal listino?`)) return;
  try {
    await api(`/api/macchine/${id}`, { method: 'DELETE' });
    await renderMacchinari();
    if (l) renderListinoMacchine(l.id);
  } catch (e) { alert('Errore: ' + e.message); }
}
```

- [ ] **Step 3: Aggiornare lo stato iniziale**

In `public/app.js`, nell'oggetto `S` iniziale, sostituire le voci del modulo Macchinari con quelle nuove, accanto a `piani` e `concorrenti`:

```javascript
  listiniMacchine: [],
  listinoAperto: null,
  macchinaInModifica: null,
  salvataggioMacchinaInCorso: false,
  macchine: [],
  confrontoMacchine: null,
```

E nei punti che azzerano lo stato al cambio di account e all'ingresso nella sezione, aggiungere `S.listinoAperto = null;` accanto agli azzeramenti di `S.macchinaInModifica` gia' presenti.

- [ ] **Step 4: Verificare**

Run: `node --check public/app.js`

Avviare il server, creare un account di prova, importare `lib/fixtures/listino-misto-macchine.pdf` dalla sezione Macchinari e verificare: il listino compare nell'elenco col numero di macchine e la data; «Vedi macchine» apre il dettaglio; «+ Aggiungi macchina» inserisce una riga nel listino aperto; «Modifica» ne cambia il prezzo; «Elimina» sulla macchina la rimuove; «Elimina» sul listino chiede conferma citando quante macchine porta via e lo rimuove con esse.

Se non e' disponibile un browser che componga le immagini, verificare il verificabile e dichiarare con onesta' cosa non si e' potuto osservare.

**Al termine rimuovere l'account di prova e tutte le sue righe.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: Macchinari a due livelli, listini importati e loro macchine"
```

---

### Task 4: Sezione «Confronto macchine»

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/macchine` (Task 2), che restituisce `[{id, nome, prezzo, listinoId, listinoNome, concorrenteId, concorrenteNome}]`.
- Produces: `renderConfrontoMacchine()`, raggiungibile da `navigate('confronto-macchine')`.

- [ ] **Step 1: Aggiungere la voce di menu**

In `public/app.js`, subito dopo la voce `macchinari`:

```javascript
    <div class="nav-item ${isActive('confronto-macchine')}" onclick="navigate('confronto-macchine')">
      <span class="nav-icon">⚖️</span> Confronto macchine
    </div>
```

E nello `switch` di `navigate`, dopo il caso `macchinari`:

```javascript
    case 'confronto-macchine': renderConfrontoMacchine();               break;
```

- [ ] **Step 2: Scrivere la pagina**

Sostituire la vecchia `renderCalcolatoreMacchine` (e le funzioni `cambiaConfrontoMacchina`, `aggiungiConfrontoMacchina`, `togliConfrontoMacchina`, che vanno conservate adattandole) con una pagina propria. La barra in testa segue `roi-toolbar`, come il simulatore esami.

```javascript
// ── Confronto macchine ──
// Sezione propria, con la stessa barra di comandi del simulatore esami.
// L'accoppiamento fra una macchina propria e una del concorrente e' scelto a
// mano riga per riga: nessuna mappatura salvata, nessun algoritmo di somiglianza.
async function renderConfrontoMacchine() {
  const loggato = !!(S.auth && S.auth.token && !S.auth.guest);
  let elenco = [];
  if (loggato) {
    try { elenco = await api('/api/macchine'); }
    catch (e) {
      setMain(`<div class="empty-state"><div class="empty-icon">⚠️</div>
        <div class="empty-title">Errore</div><div class="empty-sub">${escHtml(e.message)}</div></div>`);
      return;
    }
  }
  S.macchine = elenco;
  const mie = elenco.filter(m => !m.concorrenteId);
  const loro = elenco.filter(m => m.concorrenteId);

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Confronto macchine</div>
        <div class="page-subtitle">Mylav vs concorrenza</div>
      </div>
    </div>
    <div class="page-body">
      <div class="roi-toolbar">
        <div>
          <div class="roi-toolbar-title">Confronto macchine</div>
          <div class="roi-toolbar-sub">${mie.length} tue · ${loro.length} della concorrenza</div>
        </div>
        <div class="roi-toolbar-controls">
          ${mie.length && loro.length ? `<button class="btn-outline" onclick="aggiungiConfrontoMacchina()" style="font-size:12px">+ Aggiungi riga</button>
          <button class="btn-outline" onclick="rimuoviTuttoConfrontoMacchine()" style="font-size:12px">🗑️ Rimuovi tutto</button>` : ''}
          <button class="btn-outline" onclick="navigate('macchinari')" style="font-size:12px">🔬 Gestisci macchinari</button>
        </div>
      </div>
      <div id="confronto-macchine-corpo"></div>
    </div>
  `);
  renderCorpoConfrontoMacchine();
}

function renderCorpoConfrontoMacchine() {
  const wrap = el('confronto-macchine-corpo');
  if (!wrap) return;
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);

  if (!mie.length || !loro.length) {
    const manca = !mie.length && !loro.length
      ? 'Non ci sono ancora macchine in catalogo. Importa un listino di analizzatori nella sezione Macchinari: uno con le tue macchine e uno con quelle del concorrente.'
      : !mie.length
        ? 'Mancano le tue macchine: quelle della concorrenza ci sono già. Importa un listino con provenienza «Le mie macchine» nella sezione Macchinari.'
        : 'Manca il termine di paragone: le tue macchine ci sono già. Importa un listino indicando il concorrente a cui appartiene, nella sezione Macchinari.';
    wrap.innerHTML = `
      <div class="section-card">
        <div class="td-muted" style="padding:6px 0;line-height:1.5">${manca}</div>
        <button class="btn-primary" style="margin-top:12px" onclick="navigate('macchinari')">Vai a Macchinari</button>
      </div>`;
    return;
  }

  if (!Array.isArray(S.confrontoMacchine) || !S.confrontoMacchine.length) {
    S.confrontoMacchine = [{ mia: mie[0].id, sua: loro[0].id }];
  }
  // Una riga che punta a una macchina non piu' esistente direbbe una cosa
  // diversa da quella scelta: si scarta invece di ripiegare su un'altra.
  S.confrontoMacchine = S.confrontoMacchine.filter(r =>
    mie.some(m => m.id === r.mia) && loro.some(m => m.id === r.sua));
  if (!S.confrontoMacchine.length) S.confrontoMacchine = [{ mia: mie[0].id, sua: loro[0].id }];

  const opzioni = (lista, sel) => lista
    .map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${escHtml(m.nome)}</option>`).join('');

  let totMia = 0, totSua = 0;
  const righe = S.confrontoMacchine.map((r, i) => {
    const a = mie.find(m => m.id === r.mia);
    const b = loro.find(m => m.id === r.sua);
    totMia += a.prezzo; totSua += b.prezzo;
    const diff = a.prezzo - b.prezzo;
    return `<tr>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'mia',this.value)">${opzioni(mie, a.id)}</select></td>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'sua',this.value)">${opzioni(loro, b.id)}</select></td>
      <td class="td-num">${fmtEuro(a.prezzo)}</td>
      <td class="td-num">${fmtEuro(b.prezzo)}</td>
      <td class="td-num ${diff <= 0 ? 'macc-meglio' : 'macc-peggio'}">${diff <= 0 ? '−' : '+'}${fmtEuro(Math.abs(diff))}</td>
      <td>${S.confrontoMacchine.length > 1 ? `<button class="imp-x-riga" onclick="togliConfrontoMacchina(${i})" title="Togli riga">✕</button>` : ''}</td>
    </tr>`;
  }).join('');

  const diffTot = totMia - totSua;
  wrap.innerHTML = `
    <div class="table-card">
      <div class="table-scroll">
        <table class="macc-confronto">
          <thead><tr>
            <th>La mia macchina</th><th>Della concorrenza</th>
            <th style="width:110px">Mylav</th><th style="width:110px">Concorrenza</th>
            <th style="width:120px">Differenza</th><th style="width:40px"></th>
          </tr></thead>
          <tbody>${righe}</tbody>
          <tfoot><tr>
            <td colspan="2"><b>Totale</b></td>
            <td class="td-num"><b>${fmtEuro(totMia)}</b></td>
            <td class="td-num"><b>${fmtEuro(totSua)}</b></td>
            <td class="td-num ${diffTot <= 0 ? 'macc-meglio' : 'macc-peggio'}"><b>${diffTot <= 0 ? '−' : '+'}${fmtEuro(Math.abs(diffTot))}</b></td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
}

function cambiaConfrontoMacchina(i, lato, valore) {
  if (!S.confrontoMacchine || !S.confrontoMacchine[i]) return;
  S.confrontoMacchine[i][lato] = Number(valore);
  renderCorpoConfrontoMacchine();
}

function aggiungiConfrontoMacchina() {
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);
  if (!mie.length || !loro.length) return;
  if (!Array.isArray(S.confrontoMacchine)) S.confrontoMacchine = [];
  S.confrontoMacchine.push({ mia: mie[0].id, sua: loro[0].id });
  renderCorpoConfrontoMacchine();
}

function togliConfrontoMacchina(i) {
  if (!S.confrontoMacchine) return;
  S.confrontoMacchine.splice(i, 1);
  renderCorpoConfrontoMacchine();
}

function rimuoviTuttoConfrontoMacchine() {
  if (!confirm('Svuotare il confronto?')) return;
  S.confrontoMacchine = null;
  renderCorpoConfrontoMacchine();
}
```

- [ ] **Step 3: Togliere il calcolatore dalla pagina Macchinari**

In `public/app.js`, in `renderMacchinari`, eliminare il contenitore `macchinari-calcolatore` e la chiamata che disegnava il calcolatore: ora sta in un posto solo.

- [ ] **Step 4: Verificare**

Run: `node --check public/app.js`

Avviare il server, creare un account di prova, importare la fixture due volte nella sezione Macchinari — una volta con provenienza «Le mie macchine» e una indicando un concorrente (creandolo prima con un import in Gestione concorrenti) — poi aprire «Confronto macchine» e verificare: la barra riporta i due conteggi; il confronto mostra le due colonne, la differenza in blu quando conviene Mylav e in rosso quando conviene la concorrenza; «+ Aggiungi riga» e «✕» funzionano; «Gestisci macchinari» porta alla sezione Macchinari; con un solo lato presente il messaggio dice quale manca e il pulsante porta dove si risolve.

Dichiarare con onesta' cosa non si e' potuto osservare.

**Al termine rimuovere l'account di prova e tutte le sue righe.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: Confronto macchine in una sezione propria, con la barra del simulatore esami"
```

---

### Task 5: Verifica end-to-end

**Files:** nessuna modifica prevista; eventuali correzioni nei file toccati dai task precedenti.

- [ ] **Step 1: Eseguire l'intera suite**

Run: `npm test`
Expected: verde. Usare un timeout generoso: la suite impiega alcuni minuti.

- [ ] **Step 2: Percorso completo su un account nuovo**

Avviare il server e creare un account di prova. Poi, in quest'ordine:

1. Importare `lib/fixtures/listino-misto-macchine.pdf` in **Gestione piani**: 6 righe nei prezzi base, e `GET /api/listini-macchine` **vuoto** — nessuno smistamento automatico.
2. Importare lo stesso file in **Gestione concorrenti** col nome «IDEXX»: 6 esami al concorrente, listini macchine ancora vuoti.
3. Importare lo stesso file in **Macchinari** con provenienza «Le mie macchine»: un listino con 6 macchine.
4. Importarlo di nuovo in **Macchinari** indicando «IDEXX»: un secondo listino, 6 macchine, provenienza IDEXX.
5. Aprire **Confronto macchine**: entrambi i lati presenti, confronto funzionante.
6. Eliminare un listino: le sue macchine spariscono, l'altro resta.
7. Eliminare il concorrente IDEXX da Gestione concorrenti: riesce, e porta via il suo listino di macchine.

- [ ] **Step 3: Verificare lo stato del database**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const t of ['listini_macchine','macchine','concorrenti']) console.log(t, db.prepare('SELECT COUNT(*) c FROM '+t).get().c);
db.close();"
```

- [ ] **Step 4: Rimuovere l'account di prova**

Rimuovere l'account e tutte le righe che ha creato, lasciando il database allo stato iniziale: 11 utenti, 0 macchine, 0 listini, 0 concorrenti.

- [ ] **Step 5: Commit di eventuali correzioni**

Se la verifica ha richiesto correzioni, un commit unico che le descriva. Se non ne ha richieste, nessun commit.

---

## Self-review

**Copertura dello spec:**

| Requisito | Task |
|---|---|
| Le macchine appartengono a un listino | 1 |
| Provenienza sul listino, non sulla riga | 1 |
| Eliminare un listino porta via le sue macchine | 1 |
| `eliminaConcorrente` porta via i listini del concorrente | 1 |
| Isolamento per account risalendo al listino | 1, test dedicati |
| Un import scrive in una sola destinazione | 2 |
| Piani e concorrenti tornano al comportamento precedente | 2, Step 5 |
| Revisione a tabella singola, via i due gruppi | 2 |
| Il tipo resta solo per l'avviso in Macchinari | 2 |
| Macchinari a due livelli | 3 |
| Solo import PDF; aggiunta a mano dentro un listino | 3 |
| Avviso nuovo, verbatim | 3 |
| Confronto in sezione propria con barra dei comandi | 4 |
| Calcolatore rimosso dalla pagina Macchinari | 4 |

**Punti annotati durante la stesura:**

- `macchine` perde `user_id`: ogni funzione verifica l'account risalendo al listino, e `eliminaMacchina` usa una sottoquery sui listini dell'account. E' il punto piu' delicato del Task 1 e i test lo coprono da entrambi i lati.
- `UNIQUE(listino_id, nome)` sostituisce i due indici parziali precedenti: dentro un listino il nome e' unico, fra listini diversi no. Sparisce il motivo che aveva richiesto gli indici parziali.
- Il Task 2 elimina codice e stili introdotti pochi commit prima (i due gruppi, il pulsante di spostamento): e' voluto, non una dimenticanza.
- Importare due volte lo stesso file crea due listini con lo stesso nome: dichiarato fuori scope nello spec, non e' un difetto da correggere.
