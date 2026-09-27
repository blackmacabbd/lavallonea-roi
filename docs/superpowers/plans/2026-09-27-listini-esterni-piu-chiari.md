# Gestioni esterne più chiare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un elenco solo di listini in Gestione macchinari esterni, niente laboratori vuoti in Gestione esami esterni, e ogni sezione che elimina solo il suo.

**Architecture:** La chiave di un listino diventa **laboratorio + file** (oggi e' il solo file). Due nuove funzioni di libreria eliminano per sezione — solo gli esami, o solo le clip di un listino — e nella stessa transazione tolgono il laboratorio se resta vuoto in entrambe. Il client disegna una tabella sola, con la stessa forma di quella degli esami esterni.

**Tech Stack:** Node/Express, `node:sqlite`, JS vanilla senza build, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-listini-esterni-piu-chiari-design.md`

## Global Constraints

- Nessuna dipendenza nuova.
- `npm test` verde a ogni fetta; oggi **285 test** (`node --test lib/*.test.js`).
- Nessuna migrazione distruttiva; questo lavoro non tocca lo schema.
- **Mai scrivere nell'account del cliente per provare.** Server di prova su database temporaneo: `PORT=<porta libera> DB_PATH=<file temporaneo> UPLOADS_DIR=<cartella temporanea> node server.js`, poi rimuovere i file.
- Ogni lettura e scrittura filtra per `user_id`.
- In italiano l'interfaccia resta identica per tutto cio' che non viene cambiato apposta.
- I dati dell'operatore (nomi di laboratori, file, clip, importi) non si traducono e non si alterano.
- Ogni chiave di traduzione in tutte e quattro le lingue di `public/i18n.js` (it, en, fr, es), oggi 507 per lingua, con gli stessi segnaposto. Le chiavi che restano inutilizzate si tolgono.
- Un valore dentro un `onclick` passa per due parser: `jsAttr()`. **`jsAttr(null)` diventa `""`**: un valore che puo' essere nullo va scritto `null` a mano, come gia' fa il codice esistente.
- Mai scrivere un byte NUL o un altro carattere di controllo in un sorgente; controllare prima di ogni commit.
- `node --check` non vede un identificatore indefinito in un template literal: dopo ogni rinomina o rimozione, cercare il vecchio nome in tutto `public/` e `server.js`.
- Nessun push senza richiesta esplicita.

---

### Task 1: Il listino e' laboratorio + file, e ogni sezione elimina solo il suo

**Files:**
- Modify: `lib/concorrenti.js` (funzione `eliminaConcorrente` e `module.exports`)
- Modify: `lib/clip.js` (require in cima, `gruppiClip`, `eliminaGruppoClip`)
- Modify: `lib/clip.test.js` (tre chiamate alla vecchia firma di `eliminaGruppoClip`, righe ~316, ~330, ~341)
- Modify: `server.js` (`DELETE /api/concorrenti/:id` ~riga 1342, `DELETE /api/clip/gruppo` ~riga 1507)
- Create: `lib/eliminazioni.test.js`

**Interfaces:**
- Produces, in `lib/concorrenti.js`:
  - `eliminaSeVuoto(db, concorrenteId, userId)` → `boolean`. Toglie il laboratorio se non ha esami ne' clip. **Non apre una transazione.**
  - `eliminaEsamiConcorrente(db, id, userId)` → `{ trovato, eliminati, laboratorioRimosso }`.
  - `eliminaConcorrente` resta, con lo stesso comportamento di oggi.
- Produces, in `lib/clip.js`:
  - `eliminaGruppoClip(db, concorrenteId, fileOrigine, userId)` → `{ eliminate, laboratorioRimosso }`. **Firma nuova**: prima era `(db, fileOrigine, userId)`.
  - `gruppiClip(db, userId)` → `[{ concorrenteId, fileOrigine, n, dataUltimo }]`.
- Produces, in `server.js`:
  - `DELETE /api/concorrenti/:id` → `{ success, eliminati, laboratorioRimosso }`; toglie **solo gli esami**.
  - `DELETE /api/clip/gruppo`, corpo `{ concorrenteId, fileOrigine }` → `{ eliminate, laboratorioRimosso }`.

**Il difetto che questa fetta chiude.** Oggi `eliminaGruppoClip` cancella per **solo nome del file**, in tutti i laboratori dell'account: lo stesso file caricato per due laboratori viene cancellato per entrambi. E `DELETE /api/concorrenti/:id` cancella il laboratorio **con le sue clip**: eliminando gli esami di «cdvet» sparirebbe anche il suo listino macchinari.

- [ ] **Step 1: Scrivere i test**

Creare `lib/eliminazioni.test.js`. Il database ha le chiavi esterne **attive** (il default di `node:sqlite`, come in produzione): e' proprio la condizione in cui una cancellazione nell'ordine sbagliato fallisce.

```javascript
'use strict';
// Cosa cancella «Elimina» in ciascuna delle due sezioni esterne. Ogni sezione
// toglie solo il suo; un laboratorio vuoto in entrambe sparisce da solo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const concorrenti = require('./concorrenti');
const clip = require('./clip');

// Chiavi esterne ATTIVE, come in produzione.
function dbProva() {
  const db = new DatabaseSync(':memory:');
  concorrenti.ensureSchema(db);
  clip.ensureSchema(db);
  return db;
}
const lab = (db, nome, userId = 1) => concorrenti.trovaOCreaConcorrente(db, nome, userId).id;
const esame = (db, cid, nome) => db.prepare(
  'INSERT INTO esami_concorrente (concorrente_id, nome_originale, prezzo) VALUES (?, ?, ?)').run(cid, nome, 10);
const unaClip = (db, cid, nome, file, userId = 1) => clip.upsertClip(db, {
  userId, concorrenteId: cid, nome, prezzoConfezione: 100, pezzi: 10, sconto: null, fonte: 'pdf', fileOrigine: file });
const nClip = (db, cid) => db.prepare('SELECT COUNT(*) AS n FROM clip WHERE concorrente_id IS ?').get(cid).n;
const esiste = (db, cid) => !!db.prepare('SELECT 1 FROM concorrenti WHERE id = ?').get(cid);

test('eliminaGruppoClip toglie solo quel file di quel laboratorio', () => {
  const db = dbProva();
  const a = lab(db, 'IVET'), b = lab(db, 'ivet');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  unaClip(db, b, 'cPL', 'listino.xlsx');   // stesso file, altro laboratorio
  unaClip(db, a, 'cTSH', 'altro.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'listino.xlsx', 1);
  assert.equal(r.eliminate, 1);
  assert.equal(nClip(db, b), 1, 'lo stesso file dell\'altro laboratorio resta');
  assert.equal(nClip(db, a), 1, 'l\'altro listino dello stesso laboratorio resta');
  db.close();
});

test('eliminaGruppoClip toglie il laboratorio se resta vuoto in entrambe le sezioni', () => {
  const db = dbProva();
  const a = lab(db, 'Solo macchinari');
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(esiste(db, a), false);
  db.close();
});

test('eliminaGruppoClip lascia il laboratorio se ha ancora esami', () => {
  const db = dbProva();
  const a = lab(db, 'Esami e macchinari');
  esame(db, a, 'EMOCROMO');
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, false);
  assert.equal(esiste(db, a), true);
  db.close();
});

// In SQL "= NULL" non e' mai vero: senza il ramo IS NULL questa cancellazione
// toglierebbe zero righe dicendo che e' andata bene.
test('eliminaGruppoClip sa eliminare le clip senza laboratorio e senza file', () => {
  const db = dbProva();
  unaClip(db, null, 'vecchia', null);
  const a = lab(db, 'IVET');
  unaClip(db, a, 'nuova', null);
  const r = clip.eliminaGruppoClip(db, null, null, 1);
  assert.equal(r.eliminate, 1);
  assert.equal(nClip(db, a), 1, 'le clip senza file ma con laboratorio restano');
  db.close();
});

test('eliminaEsamiConcorrente toglie solo gli esami: le clip restano', () => {
  const db = dbProva();
  const a = lab(db, 'cdvet');
  esame(db, a, 'EMOCROMO');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  const r = concorrenti.eliminaEsamiConcorrente(db, a, 1);
  assert.deepEqual(r, { trovato: true, eliminati: 1, laboratorioRimosso: false });
  assert.equal(nClip(db, a), 1, 'il listino macchinari resta');
  assert.equal(esiste(db, a), true);
  db.close();
});

test('eliminaEsamiConcorrente toglie il laboratorio se non ha clip', () => {
  const db = dbProva();
  const a = lab(db, 'Solo esami');
  esame(db, a, 'EMOCROMO');
  const r = concorrenti.eliminaEsamiConcorrente(db, a, 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(esiste(db, a), false);
  db.close();
});

test('eliminaEsamiConcorrente non tocca un laboratorio di un altro account', () => {
  const db = dbProva();
  const a = lab(db, 'IVET', 1);
  esame(db, a, 'EMOCROMO');
  assert.deepEqual(concorrenti.eliminaEsamiConcorrente(db, a, 2),
    { trovato: false, eliminati: 0, laboratorioRimosso: false });
  assert.equal(esiste(db, a), true);
  db.close();
});

test('eliminaGruppoClip non tocca le clip di un altro account', () => {
  const db = dbProva();
  const a = lab(db, 'IVET', 1), b = lab(db, 'IVET', 2);
  unaClip(db, a, 'cPL', 'listino.xlsx', 1);
  unaClip(db, b, 'cPL', 'listino.xlsx', 2);
  clip.eliminaGruppoClip(db, b, 'listino.xlsx', 1);   // account sbagliato
  assert.equal(nClip(db, b), 1);
  assert.equal(esiste(db, b), true, 'eliminaSeVuoto non deve toccare il laboratorio di un altro');
  db.close();
});

// Le vecchie tabelle dei macchinari non le legge piu' nessuno: un laboratorio
// che ha solo righe li' e' vuoto, e sparendo se le porta via (hanno una chiave
// esterna verso di lui, quindi vanno tolte PRIMA della sua riga).
test('le vecchie tabelle dei macchinari non contano e se ne vanno col laboratorio', () => {
  const db = dbProva();
  db.exec(`
    CREATE TABLE listini_macchine (id INTEGER PRIMARY KEY, concorrente_id INTEGER REFERENCES concorrenti(id));
    CREATE TABLE macchine (id INTEGER PRIMARY KEY, listino_id INTEGER REFERENCES listini_macchine(id));
  `);
  const a = lab(db, 'Vecchio');
  const l = db.prepare('INSERT INTO listini_macchine (concorrente_id) VALUES (?)').run(a).lastInsertRowid;
  db.prepare('INSERT INTO macchine (listino_id) VALUES (?)').run(l);
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listini_macchine').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM macchine').get().n, 0);
  db.close();
});

test('gruppiClip raggruppa per laboratorio e file', () => {
  const db = dbProva();
  const a = lab(db, 'IVET'), b = lab(db, 'ivet');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  unaClip(db, a, 'cTSH', 'listino.xlsx');
  unaClip(db, b, 'cPL', 'listino.xlsx');
  const g = clip.gruppiClip(db, 1);
  assert.equal(g.length, 2, 'stesso file, due laboratori: due listini');
  assert.equal(g.find(x => x.concorrenteId === a).n, 2);
  assert.equal(g.find(x => x.concorrenteId === b).n, 1);
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/eliminazioni.test.js`
Expected: FAIL — `eliminaEsamiConcorrente` e `eliminaSeVuoto` non esistono, `eliminaGruppoClip` ha la firma vecchia.

- [ ] **Step 3: `lib/concorrenti.js`**

Sostituire `eliminaConcorrente` con queste quattro funzioni. Il corpo di oggi diventa `rimuoviLaboratorio`, senza transazione, cosi' puo' vivere dentro quella di chi chiama.

```javascript
// Toglie un laboratorio e tutto cio' che gli punta. NON apre una transazione:
// la apre chi chiama, cosi' la rimozione puo' stare nella stessa transazione
// di cio' che l'ha resa necessaria (vedi eliminaSeVuoto).
//
// Le vecchie tabelle dei macchinari e le clip hanno una chiave esterna verso
// concorrenti: vanno tolte PRIMA della riga del laboratorio, o la
// cancellazione fallisce con FOREIGN KEY constraint failed. Le tabelle possono
// mancare (installazioni nuove, test): si controlla prima.
function rimuoviLaboratorio(db, cid) {
  const esiste = t => !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid);
  if (esiste('listini_macchine')) {
    if (esiste('macchine')) {
      db.prepare(`DELETE FROM macchine WHERE listino_id IN (
        SELECT id FROM listini_macchine WHERE concorrente_id = ?)`).run(cid);
    }
    db.prepare(`DELETE FROM listini_macchine WHERE concorrente_id = ?`).run(cid);
  }
  if (esiste('clip')) db.prepare(`DELETE FROM clip WHERE concorrente_id = ?`).run(cid);
  db.prepare(`DELETE FROM concorrenti WHERE id = ?`).run(cid);
}

// Elimina un laboratorio con tutto quello che ha. Comportamento invariato;
// l'interfaccia non la usa piu' (ogni sezione elimina solo il suo), resta per
// i test e per eliminaSeVuoto, che ne condivide il corpo.
function eliminaConcorrente(db, id, userId) {
  const cid = Number(id);
  const esiste = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!esiste) return false;
  db.exec('BEGIN');
  try {
    rimuoviLaboratorio(db, cid);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Un laboratorio vuoto in entrambe le sezioni — nessun esame, nessuna clip —
// si toglie. Senza questa regola resterebbe invisibile ovunque, e
// trovaOCreaConcorrente continuerebbe a riusarlo per nome. Le vecchie tabelle
// dei macchinari non contano: nessuna schermata le legge piu'.
// NON apre una transazione: vive dentro quella di chi elimina.
function eliminaSeVuoto(db, concorrenteId, userId) {
  if (concorrenteId == null) return false;
  const cid = Number(concorrenteId);
  const lab = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!lab) return false;
  const nEsami = db.prepare(`SELECT COUNT(*) AS n FROM esami_concorrente WHERE concorrente_id = ?`).get(cid).n;
  if (nEsami > 0) return false;
  const haClip = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='clip'`).get();
  if (haClip && db.prepare(`SELECT COUNT(*) AS n FROM clip WHERE concorrente_id = ?`).get(cid).n > 0) return false;
  rimuoviLaboratorio(db, cid);
  return true;
}

// «Elimina» in Gestione esami esterni: toglie SOLO gli esami del laboratorio.
// I suoi listini macchinari restano: sono un'altra sezione, e cancellarli di
// nascosto era la trappola da togliere. Se il laboratorio resta vuoto, si
// toglie nella stessa transazione.
function eliminaEsamiConcorrente(db, id, userId) {
  const cid = Number(id);
  const lab = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!lab) return { trovato: false, eliminati: 0, laboratorioRimosso: false };
  db.exec('BEGIN');
  try {
    const eliminati = db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid).changes;
    const laboratorioRimosso = eliminaSeVuoto(db, cid, userId);
    db.exec('COMMIT');
    return { trovato: true, eliminati, laboratorioRimosso };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

Aggiungere `eliminaSeVuoto` ed `eliminaEsamiConcorrente` a `module.exports`. **`lib/concorrenti.js` non deve richiedere `lib/clip.js`**: `clip.js` richiede gia' `concorrenti.js`, e il giro chiuso darebbe a uno dei due un modulo vuoto.

- [ ] **Step 4: `lib/clip.js`**

In cima:

```javascript
const { trovaOCreaConcorrente, eliminaSeVuoto } = require('./concorrenti');
```

Sostituire `gruppiClip` ed `eliminaGruppoClip`:

```javascript
// Un listino e' un file importato PER UN LABORATORIO: la chiave e' la coppia.
// Raggruppare per solo nome del file fondeva in una riga lo stesso file
// caricato per due laboratori. In SQLite GROUP BY mette tutti i NULL insieme
// (al contrario degli indici UNIQUE): le clip senza laboratorio, o senza file,
// fanno ciascuna un gruppo loro.
function gruppiClip(db, userId) {
  return db.prepare(`
    SELECT concorrente_id AS concorrenteId, file_origine AS fileOrigine,
           COUNT(*) AS n, MAX(data_import) AS dataUltimo
    FROM clip WHERE user_id = ?
    GROUP BY concorrente_id, file_origine
    ORDER BY dataUltimo DESC
  `).all(Number(userId));
}

// «Elimina» in Gestione macchinari esterni: toglie le clip di UN listino — quel
// file, per quel laboratorio. Prima cancellava per solo nome del file, in tutti
// i laboratori dell'account. In SQL "= NULL" non e' mai vero: laboratorio e
// file nulli si cercano con IS NULL, un solo WHERE per entrambi i casi. Se il
// laboratorio resta vuoto in entrambe le sezioni si toglie nella stessa
// transazione.
function eliminaGruppoClip(db, concorrenteId, fileOrigine, userId) {
  const labOk = concorrenteId == null ? null : Number(concorrenteId);
  const fileOk = fileOrigine == null ? null : String(fileOrigine);
  db.exec('BEGIN');
  try {
    const eliminate = db.prepare(`
      DELETE FROM clip
      WHERE user_id = ?
        AND (concorrente_id = ? OR (? IS NULL AND concorrente_id IS NULL))
        AND (file_origine = ? OR (? IS NULL AND file_origine IS NULL))
    `).run(Number(userId), labOk, labOk, fileOk, fileOk).changes;
    const laboratorioRimosso = eliminaSeVuoto(db, labOk, userId);
    db.exec('COMMIT');
    return { eliminate, laboratorioRimosso };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

In `lib/clip.test.js` le tre chiamate alla firma vecchia (righe ~316, ~330, ~341) passano un laboratorio nullo davanti: `clip.eliminaGruppoClip(db, null, 'uno.pdf', 1)`, `clip.eliminaGruppoClip(db, null, null, 1)`. Quei test creano clip senza laboratorio, quindi il significato non cambia.

- [ ] **Step 5: `server.js`**

```javascript
// «Elimina» in Gestione esami esterni: solo gli esami del laboratorio. I suoi
// listini macchinari restano (vedi eliminaEsamiConcorrente).
app.delete('/api/concorrenti/:id', requireAuth, (req, res) => {
  try {
    const r = concorrenti.eliminaEsamiConcorrente(db, req.params.id, req.user.id);
    if (!r.trovato) return res.status(404).json({ error: 'Concorrente non trovato', codice: 'CONCORRENTE_NON_TROVATO' });
    res.json({ success: true, eliminati: r.eliminati, laboratorioRimosso: r.laboratorioRimosso });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

In `DELETE /api/clip/gruppo`, il corpo porta anche il laboratorio. Un laboratorio che non e' un intero positivo ne' nullo e' una richiesta sbagliata: 400, invece di cancellare con un filtro strano.

```javascript
app.delete('/api/clip/gruppo', requireAuth, express.json(), (req, res) => {
  try {
    const { concorrenteId, fileOrigine } = req.body || {};
    const lab = concorrenteId == null ? null : Number(concorrenteId);
    if (lab !== null && !(Number.isInteger(lab) && lab > 0)) {
      return res.status(400).json({ error: 'Laboratorio non valido', codice: 'LABORATORIO_NON_VALIDO' });
    }
    const r = clipLib.eliminaGruppoClip(db, lab, fileOrigine == null ? null : fileOrigine, req.user.id);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

Aggiungere `errore.LABORATORIO_NON_VALIDO` nelle quattro lingue: «Laboratorio non valido» / «Invalid laboratory» / «Laboratoire non valide» / «Laboratorio no válido». Aggiornare i commenti sopra le due rotte, che oggi descrivono il comportamento vecchio.

- [ ] **Step 6: Eseguire i test**

Run: `npm test`
Expected: PASS, 285 test piu' i 10 nuovi.

- [ ] **Step 7: Commit**

```bash
git add lib/concorrenti.js lib/clip.js lib/clip.test.js lib/eliminazioni.test.js server.js public/i18n.js
git commit -m "fix: il listino e' laboratorio + file, e ogni sezione elimina solo il suo"
```

---

### Task 2: Gestione esami esterni senza laboratori vuoti

**Files:**
- Modify: `public/app.js` (`renderConcorrentiAdmin` ~riga 1850, `eliminaConcorrenteUI` ~riga 2001)
- Modify: `public/i18n.js`

**Interfaces:**
- Consumes: `DELETE /api/concorrenti/:id` dal Task 1 (toglie solo gli esami).
- Consumes: `GET /api/concorrenti?soloConEsami=1`, gia' esistente (usato da `loadConcorrenti`).

- [ ] **Step 1: L'elenco senza righe vuote**

In `renderConcorrentiAdmin`, la chiamata diventa `api('/api/concorrenti?soloConEsami=1')`, e dalla cella del nome si toglie l'etichetta:

```javascript
<td>${escHtml(c.nome)}</td>
```

Il commento sopra la chiamata va riscritto: oggi spiega perche' l'elenco era completo (era l'unico posto per eliminare un laboratorio senza esami), e quel motivo non vale piu' — i listini macchinari si eliminano dalla loro sezione.

- [ ] **Step 2: La conferma parla solo degli esami**

```javascript
async function eliminaConcorrenteUI(id) {
  const c = S.concorrenti.find(x => x.id === id);
  const nome = c ? c.nome : t('concorrenti.questoConcorrente');
  const n = c && c.n_esami != null ? c.n_esami : '?';
  // Si eliminano SOLO gli esami: i listini macchinari del laboratorio restano,
  // e la conferma lo dice. Il conteggio sta fra parentesi, cosi' la frase non
  // ha bisogno di singolare e plurale in nessuna delle quattro lingue.
  if (!confirm(t('concorrenti.confermaEliminaEsami', { nome, n }))) return;
  try {
    await api(`/api/concorrenti/${id}`, { method: 'DELETE' });
    scordaSottoVista('concorrente', id);
    await loadConcorrenti();
    renderConcorrentiAdmin();
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}
```

Sparisce la richiesta a `/api/clip?concorrenteId=…`, che serviva solo a contare le clip da nominare nella conferma, e sparisce `scordaSottoVista('macchDett', id)`: eliminare esami non tocca piu' i macchinari.

- [ ] **Step 3: Traduzioni**

Aggiungere nelle quattro lingue:

| lingua | `concorrenti.confermaEliminaEsami` |
|---|---|
| it | `Eliminare gli esami di "{nome}" ({n})? I listini dei macchinari di questo laboratorio restano dove sono. L'operazione non è reversibile.` |
| en | `Delete the tests of "{nome}" ({n})? This laboratory's equipment price lists stay where they are. This action cannot be undone.` |
| fr | `Supprimer les analyses de « {nome} » ({n}) ? Les tarifs d'équipements de ce laboratoire restent en place. Cette action est irréversible.` |
| es | `¿Eliminar los análisis de "{nome}" ({n})? Las tarifas de equipos de este laboratorio se mantienen. Esta acción no se puede deshacer.` |

Togliere dalle quattro lingue le chiavi rimaste senza uso: `concorrenti.soloMacchinari`, `concorrenti.confermaElimina.conClip`, `concorrenti.confermaElimina.uno`, `concorrenti.confermaElimina.molti`, `concorrenti.confermaElimina.senzaConteggio`. **Prima di togliere, cercare ogni chiave in `public/`**: se ne resta un uso, la chiave resta.

- [ ] **Step 4: Verificare**

```bash
node --check public/app.js && node --check public/i18n.js && npm test
```

Parita' delle chiavi: stessa lista nelle quattro lingue, nessuna chiave usata e assente.

Sul server di prova, con un account usa e getta: un laboratorio con esami, uno con soli macchinari. In Gestione esami esterni deve comparire solo il primo. Eliminarne gli esami quando ha anche un listino macchinari: il laboratorio sparisce dagli esami e il listino resta nei macchinari.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/i18n.js
git commit -m "feat: gli esami esterni mostrano solo i laboratori con esami, ed Elimina toglie solo quelli"
```

---

### Task 3: Gestione macchinari esterni, un elenco solo di listini

**Files:**
- Modify: `public/app.js` (`renderMacchinariEsterni` ~2199, `gruppiClipClient` ~2248, `renderMacchinariListiniBody` ~2260, `eliminaGruppoClipUI` ~2310, `renderMacchinariListaBody` ~2331, `filtraMacchinariLab` ~2382, `renderMacchinariDettaglio` ~2564, `salvaClipManuale` ~2723, `riapriSottoVista` ~418)
- Modify: `public/style.css`
- Modify: `public/i18n.js`

**Interfaces:**
- Consumes: `DELETE /api/clip/gruppo` con corpo `{ concorrenteId, fileOrigine }` dal Task 1.
- Consumes: `POST /api/clip`, che accetta gia' `fileOrigine`.

**Design deciso (frontend-design).** La tabella ha la **stessa forma di quella degli esami esterni** — Nome · Data import · Clip · pulsanti — perche' il committente ha indicato quella sezione come il modello: le due gestioni esterne devono leggersi allo stesso modo. Nella cella del nome, il **laboratorio in evidenza** e sotto, piccolo e tenue, il **file**: e' cio' che distingue due righe «IVET» di due listini diversi. Nessun colore nuovo: «Elimina» resta rosso bordato come negli esami esterni.

- [ ] **Step 1: Il raggruppamento**

```javascript
// Un listino e' un file importato PER UN LABORATORIO: la chiave e' la coppia.
// Raggruppare per solo file fondeva in una riga lo stesso file caricato per
// due laboratori. Il nome del laboratorio si prende dall'elenco dei
// laboratori della pagina, e in mancanza da quello che la clip porta con se'.
function gruppiClipClient(clip, concorrenti) {
  const nomeDi = new Map((concorrenti || []).map(c => [c.id, c.nome]));
  const per = new Map();
  clip.forEach(c => {
    const lab = c.concorrenteId == null ? null : c.concorrenteId;
    const file = c.fileOrigine == null ? null : c.fileOrigine;
    const k = JSON.stringify([lab, file]);
    if (!per.has(k)) {
      per.set(k, { concorrenteId: lab, fileOrigine: file, n: 0, dataUltimo: null,
        nomeLab: lab == null ? null : (nomeDi.get(lab) || c.concorrenteNome || '') });
    }
    const g = per.get(k);
    g.n++;
    if (c.dataImport && (!g.dataUltimo || c.dataImport > g.dataUltimo)) g.dataUltimo = c.dataImport;
  });
  return [...per.values()];
}
```

- [ ] **Step 2: La tabella**

`renderMacchinariListaBody` diventa l'unico elenco; `renderMacchinariListiniBody` si toglie, insieme al contenitore `#macch-listini-wrap` in `renderMacchinariEsterni` e a ogni sua chiamata. Tenere il nome `renderMacchinariListaBody` evita di cambiare tutti i punti che lo richiamano dopo una modifica.

```javascript
function renderMacchinariListaBody() {
  const st = S.macch;
  const wrap = el('macch-lista-wrap');
  if (!wrap || !st) return;

  const q = st.filtro.trim();
  const etichettaFile = g => g.fileOrigine == null ? t('clip.senzaFile') : g.fileOrigine;
  const etichettaLab = g => g.concorrenteId == null ? t('macchinari.senzaLaboratorio') : g.nomeLab;
  const listini = gruppiClipClient(st.clip, st.concorrenti)
    .filter(g => !q || Ricerca.corrisponde(etichettaLab(g), q) || Ricerca.corrisponde(etichettaFile(g), q))
    // Per laboratorio (quelli senza laboratorio in fondo), poi dal piu' recente.
    .sort((a, b) => (a.concorrenteId == null) - (b.concorrenteId == null)
      || String(etichettaLab(a)).localeCompare(String(etichettaLab(b)), 'it', { sensitivity: 'base' })
      || String(b.dataUltimo || '').localeCompare(String(a.dataUltimo || '')));

  const sub = el('macch-sottotitolo');
  const tutti = gruppiClipClient(st.clip, st.concorrenti).length;
  if (sub) sub.textContent = t('pagina.macchinariEsterni.sottotitolo' + (tutti === 1 ? '.uno' : ''), { n: tutti });

  if (!listini.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🧰</div>
      <div class="empty-title">${t('stato.nessunDato')}</div></div>`;
    return;
  }

  // Laboratorio e file possono essere nulli: jsAttr(null) darebbe "" e il
  // gestore li scambierebbe per un nome vuoto, quindi il null si scrive a mano.
  const arg = v => v == null ? 'null' : (typeof v === 'number' ? String(v) : jsAttr(v));
  const dataFmt = d => d ? new Date(d).toLocaleDateString('it-IT') : '';

  const rigaHtml = g => `<tr>
    <td>
      <div class="listino-lab">${g.concorrenteId == null ? `<em>${escHtml(etichettaLab(g))}</em>` : escHtml(etichettaLab(g))}</div>
      <div class="listino-file">${escHtml(etichettaFile(g))}</div>
    </td>
    <td class="td-muted">${dataFmt(g.dataUltimo)}</td>
    <td class="td-muted">${g.n}</td>
    <td style="display:flex;gap:6px">
      <button class="btn-outline" onclick="renderMacchinariDettaglio(${arg(g.concorrenteId)}, ${arg(g.fileOrigine)})">${t('macchinari.vediListino')}</button>
      <button class="btn-outline" onclick="eliminaGruppoClipUI(${arg(g.concorrenteId)}, ${arg(g.fileOrigine)}, ${g.n})" style="color:var(--red);border-color:var(--red)">${t('comune.elimina')}</button>
    </td>
  </tr>`;

  wrap.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>${t('concorrenti.tabella.nome')}</th><th>${t('concorrenti.tabella.dataImport')}</th>
          <th>${t('clip.tabella.clip')}</th><th></th></tr></thead>
        <tbody>${listini.map(rigaHtml).join('')}</tbody>
      </table>
    </div>`;
}
```

In `public/style.css`, accanto agli stili delle tabelle:

```css
/* Elenco dei listini esterni: il laboratorio e' la cosa da trovare, il file
   sta sotto, piu' piccolo e tenue, e distingue due listini dello stesso
   laboratorio. Il nome di un file e' lungo e senza spazi: va a capo dove
   serve invece di allargare la tabella. */
.listino-lab { font-weight: 600; color: var(--ink); }
.listino-file { font-size: 12px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
```

Verificare che `--ink` e `--muted` esistano in `:root`.

- [ ] **Step 3: «Vedi listino»**

`renderMacchinariDettaglio(concorrenteId, fileOrigine)` apre le clip **di quel file per quel laboratorio**:

```javascript
async function renderMacchinariDettaglio(concorrenteId, fileOrigine) {
  const file = fileOrigine == null ? null : fileOrigine;
  _sottoVista = { tipo: 'macchDett', arg: { concorrenteId, fileOrigine: file } };
  let tutteLeClip;
  try { tutteLeClip = await api('/api/clip'); }
  catch (e) { alert(t('errore.generico', { msg: e.message })); return; }

  const stessoLab = c => concorrenteId == null ? c.concorrenteId == null : c.concorrenteId === concorrenteId;
  const stessoFile = c => file == null ? c.fileOrigine == null : c.fileOrigine === file;
  const clipDelListino = tutteLeClip.filter(c => stessoLab(c) && stessoFile(c));
  const lab = concorrenteId == null ? null : ((S.macch && S.macch.concorrenti) || []).find(c => c.id === concorrenteId);

  S.macchDett = { concorrenteId, fileOrigine: file, nomeLab: lab ? lab.nome : null, clip: clipDelListino, filtro: '' };
  // ... il resto della funzione come oggi, con due cambiamenti:
}
```

1. Il titolo usa la chiave nuova `macchinari.dettaglio.titoloListino` con `{ nome, file }`, dove `nome` e' il laboratorio (o `macchinari.senzaLaboratorio`) e `file` il file (o `clip.senzaFile`), entrambi passati per `escHtml`.
2. Il pulsante di salvataggio della clip aggiunta a mano passa anche il file, scritto come `null` a mano se nullo: `salvaClipManuale(${concorrenteId == null ? 'null' : concorrenteId}, ${file == null ? 'null' : jsAttr(file)})`.

`salvaClipManuale(concorrenteId, fileOrigine)` manda `fileOrigine` nel corpo di `POST /api/clip`, e alla fine ridisegna l'elenco e riapre `renderMacchinariDettaglio(concorrenteId, fileOrigine)`. **Senza il file, la clip aggiunta dentro un listino finirebbe in un'altra riga dell'elenco** — quella «importate prima che si tenesse traccia del file».

In `riapriSottoVista`, il ramo `macchDett` riceve un oggetto:

```javascript
if (sotto.tipo === 'macchDett') {
  const a = sotto.arg && typeof sotto.arg === 'object' ? sotto.arg : { concorrenteId: sotto.arg, fileOrigine: null };
  return Promise.resolve(renderMacchinariDettaglio(a.concorrenteId, a.fileOrigine));
}
```

**Attenzione:** `scordaSottoVista` confronta `Number(arg)`, che con un oggetto da' `NaN`. Non usarla per `macchDett`: chi deve chiudere il listino aperto lo fa confrontando laboratorio e file (vedi lo Step 4).

- [ ] **Step 4: «Elimina»**

```javascript
// Elimina un listino — quel file, per quel laboratorio. Il numero di righe
// nella conferma e' l'unica cosa che distingue tre righe da milleduecento.
async function eliminaGruppoClipUI(concorrenteId, fileOrigine, n) {
  const lab = concorrenteId == null ? null : ((S.macch && S.macch.concorrenti) || []).find(c => c.id === concorrenteId);
  const nomeLab = concorrenteId == null ? t('macchinari.senzaLaboratorio') : (lab ? lab.nome : '');
  const nomeFile = fileOrigine == null ? t('clip.senzaFile') : fileOrigine;
  if (!confirm(t('macchinari.confermaEliminaListino', { nome: `${nomeLab} — ${nomeFile}`, n }))) return;
  try {
    await api('/api/clip/gruppo', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concorrenteId, fileOrigine })
    });
    // Si ricaricano laboratori E clip: eliminare l'ultimo listino di un
    // laboratorio senza esami toglie anche il laboratorio. Non si ridisegna
    // la pagina intera: un ALTRO listino aperto sotto deve restare aperto.
    try {
      const [concorrenti, clip] = await Promise.all([api('/api/concorrenti'), api('/api/clip')]);
      S.macch.concorrenti = concorrenti;
      S.macch.clip = clip;
    } catch (_) { /* la cancellazione e' riuscita: al peggio l'elenco resta vecchio fino al prossimo giro */ }
    renderMacchinariListaBody();
    if (S.macchDett && S.macchDett.concorrenteId === concorrenteId && S.macchDett.fileOrigine === fileOrigine) {
      // Il listino aperto era proprio questo: non ha piu' niente da mostrare.
      S.macchDett = null;
      _sottoVista = null;
      const wrap = el('macch-dettaglio-wrap');
      if (wrap) wrap.innerHTML = '';
    }
  } catch (e) { alert(t('errore.generico', { msg: e.message })); }
}
```

Le altre funzioni che ridisegnano l'elenco — `eliminaClipUI`, `salvaClipManuale`, `assegnaLaboratorioClip` — oggi chiamano anche `renderMacchinariListiniBody()`: la chiamata si toglie, `renderMacchinariListaBody()` basta. `assegnaLaboratorioClip` non cambia altro: la clip assegnata passa dalla riga «Laboratorio non indicato» a quella del laboratorio scelto con lo stesso file, e l'elenco ridisegnato lo mostra da solo.

Il commento sopra `S.macch = { concorrenti, clip, filtro: '' }` in `renderMacchinariEsterni` resta valido (l'elenco completo dei laboratori serve per i nomi e per il selettore «assegna laboratorio»); il commento sopra `gruppiClipClient`, che parla di un elenco «ortogonale al raggruppamento per laboratorio sopra», va sostituito con quello dello Step 1.

Cercare ogni altro punto che filtra `S.macchDett.clip` per il solo laboratorio (per esempio subito dopo un salvataggio o un'assegnazione): deve filtrare per laboratorio **e** file.

La ricerca: `filtraMacchinariLab` resta com'e' (aggiorna `S.macch.filtro` e ridisegna `renderMacchinariListaBody`), ora cerca anche nel file.

- [ ] **Step 5: Traduzioni**

Nuove, nelle quattro lingue:

| chiave | it | en | fr | es |
|---|---|---|---|---|
| `macchinari.vediListino` | Vedi listino | View price list | Voir le tarif | Ver tarifa |
| `macchinari.dettaglio.titoloListino` | Listino di {nome} — {file} | {nome} price list — {file} | Tarif de {nome} — {file} | Tarifa de {nome} — {file} |

Cambiate apposta, nelle quattro lingue:

| chiave | it | en | fr | es |
|---|---|---|---|---|
| `pagina.macchinariEsterni.sottotitolo` | {n} listini importati | {n} price lists imported | {n} tarifs importés | {n} tarifas importadas |
| `pagina.macchinariEsterni.sottotitolo.uno` | {n} listino importato | {n} price list imported | {n} tarif importé | {n} tarifa importada |
| `macchinari.cercaLaboratorioPlaceholder` | 🔍 Cerca laboratorio o file… | 🔍 Search laboratory or file… | 🔍 Rechercher un laboratoire ou un fichier… | 🔍 Buscar laboratorio o archivo… |

(L'emoji iniziale c'e' gia' oggi in tutte le lingue: resta.)

Poi cercare in `public/` le chiavi che restano senza uso — prevedibilmente `macchinari.listiniTitolo`, `macchinari.eliminaListinoBtn`, `macchinari.vediClip`, `macchinari.tabella.laboratorio`, `macchinari.dettaglio.titolo`, `macchinari.dettaglio.titoloSenzaLaboratorio` — e togliere dalle quattro lingue quelle davvero inutilizzate.

- [ ] **Step 6: Verificare**

```bash
node --check public/app.js && node --check public/i18n.js && npm test
```

Nessun riferimento rimasto a `renderMacchinariListiniBody` o `macch-listini-wrap`. Parita' delle chiavi. Nessun byte NUL.

Sul server di prova, con un account usa e getta: importare lo stesso file Excel per due laboratori («IVET» e «ivet») e un secondo file per «IVET». L'elenco deve mostrare **tre righe**. Eliminare il listino di «ivet»: restano le due di «IVET», e «ivet», rimasto senza niente, sparisce. Aprire «Vedi listino» su una riga, aggiungere una clip a mano, e verificare che resti nella **stessa** riga. Cambiare lingua col listino aperto: si riapre lo stesso listino. Nessun errore in console.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css public/i18n.js
git commit -m "feat: i macchinari esterni si leggono come un elenco solo di listini"
```

---

## Self-review

| Requisito della spec | Task |
|---|---|
| Un elenco solo di listini, nome del laboratorio in evidenza, file sotto | 3 |
| «Vedi listino» apre le clip di quel file per quel laboratorio | 3 |
| «Elimina» su ogni listino | 3 |
| Ricerca su laboratorio e file | 3 |
| Righe per clip senza file e senza laboratorio | 3 (etichette), 1 (eliminazione con IS NULL) |
| La chiave del listino e' laboratorio + file | 1 (server e libreria), 3 (client) |
| Esami esterni senza laboratori vuoti, etichetta tolta | 2 |
| Elimina negli esami toglie solo gli esami | 1, 2 |
| Elimina nei macchinari toglie solo quel listino | 1, 3 |
| Laboratorio vuoto in entrambe le sezioni si toglie da solo | 1 |
| Vecchie tabelle non contano e se ne vanno col laboratorio | 1 |
| Cancellazione e pulizia nella stessa transazione | 1 |
| Grafica Mylav, stessa forma degli esami esterni | 3 |

**Punti annotati durante la stesura:**

- `eliminaSeVuoto` e `rimuoviLaboratorio` **non aprono una transazione**: in `node:sqlite` un `BEGIN` dentro un'altra transazione fallisce, e la spec chiede che cancellazione e pulizia stiano nella stessa.
- `lib/concorrenti.js` non deve richiedere `lib/clip.js`: il contrario esiste gia', e il giro chiuso darebbe a uno dei due un modulo vuoto.
- `jsAttr(null)` da' `""`: laboratorio e file nulli vanno scritti `null` a mano negli `onclick`.
- `scordaSottoVista` confronta con `Number()`: con l'argomento-oggetto di `macchDett` non funzionerebbe, e non va usata li'.
- La clip aggiunta a mano dentro un listino deve portare il file, o cambierebbe riga.
