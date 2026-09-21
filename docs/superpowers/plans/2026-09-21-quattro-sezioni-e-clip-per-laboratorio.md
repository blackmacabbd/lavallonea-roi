# Quattro sezioni e clip per laboratorio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far appartenere ogni clip al laboratorio che la vende, cosi' che il calcolatore proponga solo le clip del laboratorio scelto, e rendere il catalogo visibile e correggibile.

**Architecture:** La tabella `concorrenti` resta l'anagrafica unica dei laboratori e guadagna un secondo listino: `clip` prende una colonna `concorrente_id`. Le sezioni diventano quattro — esami interni ed esterni, macchinari interni ed esterni — e il calcolatore clip guadagna un selettore del laboratorio che filtra i suggerimenti.

**Tech Stack:** Node/Express, `node:sqlite`, JS vanilla senza build, test con `node:test` (`npm test` = `node --test lib/*.test.js`).

## Global Constraints

- **Nessuna dipendenza nuova.**
- `npm test` verde alla fine di ogni task. Oggi sono **211 test**.
- **Il calcolatore esami resta identico nel comportamento.** E' lo strumento che il committente usa davanti ai clienti.
- **In italiano l'interfaccia resta identica a oggi** per tutto cio' che questo piano non rinomina apposta: parola per parola, accenti, maiuscole, icone e spazi compresi.
- I dati dell'operatore non si traducono e non si alterano mai: nomi di clip, esami, laboratori, strutture e importi restano come sono.
- Ogni chiave di traduzione nuova va in **tutti e quattro** i blocchi di `public/i18n.js` (`it`, `en`, `fr`, `es`). C'e' un controllo di parita' su chiavi e segnaposto `{...}`; unica eccezione, le varianti `.uno`.
- Singolare e plurale: `chiave` piu' `chiave.uno`, scelte con `n === 1`; l'italiano della `.uno` copia il plurale.
- Commenti nel codice senza accenti (il progetto scrive `e'` al posto di «è»); testi visibili con accenti corretti. Francese con lo spazio prima di `:`, `?`, `!`, `%`; spagnolo con `¿` e `¡`.
- Terminologia: esame→test/analyse/análisis, listino→price list/tarif/tarifa, laboratorio→laboratory/laboratoire/laboratorio, struttura→practice/clinique/clínica, analizzatore→analyzer/analyseur/analizador. **«clip» resta invariato: e' un nome di prodotto.**
- **Nessuna migrazione distruttiva.** Il database contiene i dati di un account cliente reale (utente id 9, concorrente id 9 `2026_LISTINO PREZZI_Italy` con 517 esami) e contiene ancora le vecchie tabelle `macchine` e `listini_macchine`, che **hanno righe e vanno lasciate dove sono**.
- Il server sulla porta 3000 **non ricarica a caldo**: dopo aver toccato `server.js` o `lib/` va riavviato. E il browser serve i file di `public/` **dalla cache**: per provare una modifica usare `http://localhost:3000/?v=<numero>`, altrimenti si prova il codice vecchio.
- Stato del database da ripristinare dopo ogni verifica: **11 utenti** con 60 righe in `piani_sconto` ciascuno piu' il template `user_id IS NULL` con 60; **1 concorrente** (id 9, reale, **da non toccare mai**); 0 righe orfane; `clip`, `calcoli_clip`, `righe_calcolo_clip` a zero. Per rimuovere un account di prova servono, nell'ordine: `righe_calcolo_clip`, `calcoli_clip`, `clip`, `prezzi_piano_esame` (via `piano_id` e via `esame_id`), `prezzi_esami_custom`, `dati_foglio` (via `piano_id` e via `file_id`), `file_caricati` (via `struttura_id`), `strutture`, `esami_concorrente` (via `concorrente_id`), `concorrenti`, `piani_sconto`, `esami_riferimento`, `import_bozze`, `import_audit`, `sessions`, `reset_codes`, `users`. Un `DELETE FROM users` diretto fallisce con FOREIGN KEY.
- **Nessun push.**

---

## File Structure

| File | Responsabilita' | Task |
|---|---|---|
| `public/i18n.js` | rinomine e chiavi nuove | 1, 2, 3, 4, 5, 6 |
| `lib/clip.js` | `concorrente_id`, migrazione, ricerca per laboratorio | 2 |
| `lib/clip.test.js` | test della migrazione e dell'isolamento per laboratorio | 2 |
| `server.js` | rotte clip per laboratorio, recupero, catalogo interno | 2, 3, 5 |
| `public/app.js` | quattro sezioni, catalogo, selettore laboratorio | 1, 3, 4, 5 |
| `public/importpdf.js` | la spunta clip valorizza il laboratorio | 2 |

---

### Task 1: Rinomina delle due sezioni esistenti

**Files:**
- Modify: `public/i18n.js`

**Interfaces:**
- Nessuna interfaccia nuova. Cambiano solo i testi: le chiavi `menu.piani`, `menu.concorrenti`, `pagina.piani.titolo`, `pagina.concorrenti.titolo` restano con quei nomi, perche' rinominare anche le chiavi renderebbe il diff illeggibile senza guadagno.

- [ ] **Step 1: Cambiare i quattro testi in quattro lingue**

| chiave | it | en | fr | es |
|---|---|---|---|---|
| `menu.piani` | `Gestione esami interni` | `Internal tests` | `Analyses internes` | `Análisis internos` |
| `menu.concorrenti` | `Gestione esami esterni` | `External tests` | `Analyses externes` | `Análisis externos` |
| `pagina.piani.titolo` | `Gestione esami interni` | `Internal test management` | `Gestion des analyses internes` | `Gestión de análisis internos` |
| `pagina.concorrenti.titolo` | `Gestione esami esterni` | `External test management` | `Gestion des analyses externes` | `Gestión de análisis externos` |

Le voci di menu sono corte perche' stanno in una barra da 220 pixel e in francese il testo e' piu' lungo: c'e' gia' una funzione che mette un titolo al passaggio del mouse dove il testo sfora, quindi non serve altro.

- [ ] **Step 2: Cercare le altre occorrenze**

Altri testi nominano quelle sezioni e vanno adeguati, altrimenti l'interfaccia manda l'operatore in un posto che non esiste piu':

```bash
grep -nE "'(macchinari\.nessunConcorrenteArchivio|confronto\.mancaMie|confronto\.mancaLoro|stato\.ospiteAccedi|azione\.[a-zA-Z]+)'" public/i18n.js
grep -rn "Gestione piani\|Gestione concorrenti\|Manage discount plans\|Manage competitors" public/
```

Ogni frase che dice «importa prima un listino in Gestione concorrenti» va aggiornata nelle quattro lingue. Elencarle nel report.

- [ ] **Step 3: Verificare**

```bash
node --check public/i18n.js && npm test
```

Controllo di parita' delle chiavi:

```bash
node -e "
const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('public/i18n.js','utf8').replace('window.I18n =','window.__DIZ = DIZIONARIO; window.I18n =');
const c={window:{},localStorage:{getItem:()=>null,setItem:()=>{}},document:{documentElement:{},addEventListener:()=>{},getElementById:()=>null},console};
c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const D=c.window.__DIZ, it=Object.keys(D.it);
console.log('chiavi:', ['it','en','fr','es'].map(l=>l+'='+Object.keys(D[l]).length).join(' '));
let ko=0;
for (const l of ['en','fr','es']) {
  if (it.some(k=>!(k in D[l])) || Object.keys(D[l]).some(k=>!(k in D.it))) { ko++; console.log('PARITA',l); }
  for (const k of it) {
    const a=(D.it[k].match(/\{\w+\}/g)||[]).sort().join(','), b=((D[l][k]||'').match(/\{\w+\}/g)||[]).sort().join(',');
    if (a!==b && !k.endsWith('.uno')) { ko++; console.log('SEGNAPOSTO',k,l); }
  }
}
console.log(ko?ko+' problemi':'parita e segnaposto ok');
"
```

Poi aprire l'applicazione nelle quattro lingue e controllare che il menu dica i nomi nuovi e che nessuna frase rimandi ancora ai vecchi.

- [ ] **Step 4: Commit**

```bash
git add public/i18n.js
git commit -m "feat: le due sezioni esami si chiamano interni ed esterni"
```

---

### Task 2: Le clip appartengono a un laboratorio

**Files:**
- Modify: `lib/clip.js`, `lib/clip.test.js`, `server.js`, `public/importpdf.js`

**Interfaces:**
- `upsertClip(db, { userId, concorrenteId, nome, prezzoConfezione, pezzi, sconto, fonte })` — `concorrenteId` puo' essere `null`.
- `listaClip(db, userId, concorrenteId)` — con `concorrenteId` restituisce solo le clip di quel laboratorio; senza, tutte, ciascuna col suo `concorrenteId` e `concorrenteNome`.
- `GET /api/clip?concorrenteId=N` filtra; senza parametro restituisce tutto.
- Il Task 3 usa `listaClip`; il Task 4 usa la rotta filtrata.

- [ ] **Step 1: Scrivere i test**

Aggiungere in `lib/clip.test.js`:

```javascript
// Due laboratori possono vendere una clip con lo stesso nome: e' il caso
// normale, non l'eccezione. Il vincolo di unicita' vecchio lo impediva, e la
// seconda avrebbe sovrascritto la prima in silenzio.
test('due laboratori possono avere una clip con lo stesso nome', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12', prezzoConfezione: 448.5, pezzi: 12, fonte: 'concorrente' });
  clip.upsertClip(db, { userId: 1, concorrenteId: 20, nome: 'Chem 17 CLIP 12', prezzoConfezione: 500, pezzi: 12, fonte: 'concorrente' });
  const tutte = clip.listaClip(db, 1);
  assert.equal(tutte.length, 2, 'restano due righe distinte');
  assert.equal(clip.listaClip(db, 1, 10)[0].prezzoConfezione, 448.5);
  assert.equal(clip.listaClip(db, 1, 20)[0].prezzoConfezione, 500);
  db.close();
});

// Reimportare lo stesso listino dello stesso laboratorio aggiorna, non duplica.
test('upsertClip sullo stesso laboratorio e nome aggiorna', () => {
  const db = dbProva();
  const d = { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12', pezzi: 12, fonte: 'concorrente' };
  clip.upsertClip(db, { ...d, prezzoConfezione: 448.5 });
  clip.upsertClip(db, { ...d, prezzoConfezione: 460 });
  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzoConfezione, 460);
  db.close();
});

// Le clip salvate prima di questa modifica non hanno un laboratorio: restano
// dove sono, visibili, e si assegnano a mano. Attribuirle d'ufficio a un
// laboratorio che l'operatore non ha scelto sarebbe inventare un dato.
test('una clip senza laboratorio resta leggibile e non si perde', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Vecchia CLIP 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  const tutte = clip.listaClip(db, 1);
  assert.equal(tutte.length, 1);
  assert.equal(tutte[0].concorrenteId, null);
  assert.equal(clip.listaClip(db, 1, 10).length, 0, 'non compare sotto un laboratorio a caso');
  db.close();
});

// Con concorrente_id NULL, SQLite considera distinte due righe uguali: senza
// una difesa esplicita lo stesso nome potrebbe entrare due volte.
test('senza laboratorio, lo stesso nome non entra due volte', () => {
  const db = dbProva();
  const d = { userId: 1, concorrenteId: null, nome: 'Senza lab 12', pezzi: 12, fonte: 'pdf' };
  clip.upsertClip(db, { ...d, prezzoConfezione: 100 });
  clip.upsertClip(db, { ...d, prezzoConfezione: 120 });
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'una sola riga');
  assert.equal(righe[0].prezzoConfezione, 120);
  db.close();
});

test('le clip restano isolate per account anche con lo stesso laboratorio', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'X 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, concorrenteId: 10, nome: 'X 12', prezzoConfezione: 200, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1).length, 1);
  assert.equal(clip.listaClip(db, 1)[0].prezzoConfezione, 100);
  db.close();
});
```

Piu' un test della migrazione, che e' la parte rischiosa:

```javascript
// La migrazione gira su database veri: deve conservare le righe e gli id, e
// deve poter girare due volte senza fare danni.
test('la migrazione conserva le clip gia salvate e i loro id', () => {
  const db = new DatabaseSync(':memory:');
  // schema vecchio: nessun concorrente_id, unicita' su (user_id, nome)
  db.exec(`
    CREATE TABLE clip (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, nome TEXT NOT NULL,
      prezzo_confezione REAL, pezzi INTEGER, sconto REAL, fonte TEXT,
      data_import DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, nome));
  `);
  db.prepare(`INSERT INTO clip (id, user_id, nome, prezzo_confezione, pezzi, fonte)
              VALUES (7, 1, 'Chem 17 CLIP 12', 448.5, 12, 'concorrente')`).run();

  clip.ensureSchema(db);
  clip.ensureSchema(db);   // due volte: deve essere idempotente

  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'la riga non si perde');
  assert.equal(righe[0].id, 7, 'e mantiene il suo id');
  assert.equal(righe[0].prezzoConfezione, 448.5);
  assert.equal(righe[0].concorrenteId, null, 'senza laboratorio, da assegnare');
  const cols = db.prepare(`PRAGMA table_info(clip)`).all().map(c => c.name);
  assert.ok(cols.includes('concorrente_id'));
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/clip.test.js`
Expected: FAIL — `concorrenteId` non esiste ancora.

- [ ] **Step 3: La migrazione**

**Ordine obbligato, provato mentre si scriveva il piano:** `clip.ensureSchema`
dichiara una chiave esterna verso `concorrenti`, quindi quella tabella deve
esistere prima. In `server.js` l'ordine e' gia' giusto (`concorrenti.ensureSchema`
viene prima), ma **il `dbProva()` di `lib/clip.test.js` crea solo la tabella
clip** e va aggiornato per creare prima l'anagrafica, altrimenti i test falliscono
con `no such table: main.concorrenti`.

SQLite non sa togliere un vincolo `UNIQUE` con `ALTER TABLE`: la tabella va ricostruita. E' l'unico punto rischioso del piano, quindi si fa cosi' e non altrimenti:

```javascript
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      concorrente_id    INTEGER REFERENCES concorrenti(id),
      nome              TEXT NOT NULL,
      prezzo_confezione REAL,
      pezzi             INTEGER,
      sconto            REAL,
      fonte             TEXT,
      data_import       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- L'unicita' e' per laboratorio, non piu' per account: due laboratori
    -- vendono la stessa clip ed e' normale. Due indici perche' in SQLite i NULL
    -- sono distinti fra loro, quindi senza il secondo una clip senza
    -- laboratorio potrebbe entrare due volte.
    CREATE UNIQUE INDEX IF NOT EXISTS clip_per_laboratorio
      ON clip(user_id, concorrente_id, nome) WHERE concorrente_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS clip_senza_laboratorio
      ON clip(user_id, nome) WHERE concorrente_id IS NULL;
  `);

  // Database creato con lo schema precedente: la colonna manca e l'unicita' e'
  // ancora quella vecchia, dentro la definizione della tabella. Si ricostruisce
  // conservando righe e id, che sono l'unica cosa che conta.
  const colonne = db.prepare(`PRAGMA table_info(clip)`).all().map(c => c.name);
  if (!colonne.includes('concorrente_id')) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE clip_nuova (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id           INTEGER NOT NULL,
          concorrente_id    INTEGER REFERENCES concorrenti(id),
          nome              TEXT NOT NULL,
          prezzo_confezione REAL,
          pezzi             INTEGER,
          sconto            REAL,
          fonte             TEXT,
          data_import       DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO clip_nuova (id, user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, data_import)
          SELECT id, user_id, NULL, nome, prezzo_confezione, pezzi, sconto, fonte, data_import FROM clip;
        DROP TABLE clip;
        ALTER TABLE clip_nuova RENAME TO clip;
        CREATE UNIQUE INDEX clip_per_laboratorio
          ON clip(user_id, concorrente_id, nome) WHERE concorrente_id IS NOT NULL;
        CREATE UNIQUE INDEX clip_senza_laboratorio
          ON clip(user_id, nome) WHERE concorrente_id IS NULL;
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
```

`upsertClip` scrive con `ON CONFLICT` sull'indice giusto a seconda che il laboratorio ci sia o no. `listaClip(db, userId, concorrenteId)` unisce a `concorrenti` per restituire anche `concorrenteNome`, e filtra per laboratorio solo se il parametro e' stato passato — attenzione a distinguere «parametro assente» da «parametro null», che significano due cose diverse.

- [ ] **Step 4: Eseguire i test**

Run: `node --test lib/clip.test.js`
Expected: PASS.

- [ ] **Step 5: Eliminare un laboratorio porta via le sue clip**

**Provato mentre si scriveva questo piano, e fallisce:** con la chiave esterna
verso `concorrenti`, eliminare un laboratorio che ha delle clip da
`FOREIGN KEY constraint failed`. E' lo stesso difetto corretto pochi giorni fa
sui listini di macchinari, reintrodotto da questa fetta se non lo si previene.

In `lib/concorrenti.js`, `eliminaConcorrente` deve togliere anche le clip del
laboratorio, dentro la stessa transazione, con la guardia sull'esistenza della
tabella come gia' fa per le vecchie tabelle dei macchinari. Il test va scritto
**prima**, e deve fallire senza la correzione:

```javascript
test('eliminaConcorrente porta via anche le clip di quel laboratorio', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);
  require('./clip.js').ensureSchema(db);
  upsertConcorrente(db, 'IDEXX', [{ nome_originale: 'E', prezzo: 1, sconto: null }], 9);
  const cid = db.prepare('SELECT id FROM concorrenti').get().id;
  require('./clip.js').upsertClip(db, {
    userId: 9, concorrenteId: cid, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.5, pezzi: 12, fonte: 'concorrente'
  });
  assert.equal(eliminaConcorrente(db, cid, 9), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM clip').get().c, 0,
    'le clip del laboratorio se ne vanno con lui');
  db.close();
});
```

**E la conferma mostrata all'operatore deve nominarle.** Oggi dice «Eliminare X e
i suoi N esami?»: se porta via anche delle clip e non lo dice, e' una perdita di
dati silenziosa — rilievo gia' emerso una volta in questo progetto. Servono le
varianti della frase con e senza clip, nelle quattro lingue.

- [ ] **Step 6: L'import valorizza il laboratorio**

Nella conferma dell'import in `server.js`, la scrittura nel catalogo clip passa il concorrente appena creato o aggiornato, invece di lasciare il campo vuoto: l'`upsertConcorrente` restituisce gia' l'identificativo.

- [ ] **Step 7: Verificare sui dati veri**

```bash
node --check server.js && npm test
```

Poi, in sola lettura sul database reale, controllare che la migrazione non abbia perso nulla:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
const cols=db.prepare('PRAGMA table_info(clip)').all().map(c=>c.name);
console.log('colonne clip:', cols.join(', '));
console.log('righe clip:', db.prepare('SELECT COUNT(*) c FROM clip').get().c);
console.log('indici:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='clip'\").all().map(r=>r.name).join(', '));
db.close();"
```

Riavviare il server e importare `lib/fixtures/listino-misto-macchine.pdf` come laboratorio, spuntando una riga: la clip deve nascere col `concorrente_id` di quel laboratorio.

**Al termine rimuovere l'account di prova seguendo l'ordine dei vincoli globali.**

- [ ] **Step 8: Commit**

```bash
git add lib/clip.js lib/clip.test.js lib/concorrenti.js lib/concorrenti.test.js server.js public/importpdf.js public/i18n.js
git commit -m "feat: ogni clip appartiene al laboratorio che la vende"
```

---

### Task 3: Gestione macchinari esterni

**Files:**
- Modify: `public/app.js`, `public/i18n.js`, `server.js`

**Interfaces:**
- Consumes: `listaClip` e le rotte del Task 2.
- Produces: la vista `'macchinari-esterni'`, e `POST /api/clip/recupera` che restituisce le clip riconosciute nei listini esami gia' importati, **senza scriverle**.

- [ ] **Step 1: La sezione a due livelli**

Come Gestione esami esterni: l'elenco dei laboratori con quante clip ha ciascuno, e aprendone uno la tabella delle sue clip — nome, prezzo di confezione, pezzi, sconto, e il costo per clip calcolato. Modifica e cancellazione per riga, piu' un comando per aggiungerne una a mano.

Serve anche un gruppo **«laboratorio non indicato»** per le clip con `concorrente_id` vuoto, con un comando per assegnarle a un laboratorio. Senza, quelle righe esisterebbero nel database e non si vedrebbero da nessuna parte.

Una barra di ricerca per blocco, con `Ricerca.corrisponde`, come nelle altre sezioni.

- [ ] **Step 2: Il recupero dai listini gia' importati**

`POST /api/clip/recupera` scorre `esami_concorrente` dell'account, applica `sembraClip` e `leggiPezzi`, e **restituisce l'elenco senza scrivere niente**: nome, prezzo, pezzi, laboratorio di provenienza, e se quella clip e' gia' in catalogo.

Il client mostra l'elenco con una casella per riga, gia' spuntata dove la clip non e' ancora presente, e scrive solo alla conferma. **Niente si sposta da solo:** e' la regola che ha gia' fatto buttare una volta la logica dei macchinari.

Sul listino reale in archivio questo comando deve trovare **11 clip**.

- [ ] **Step 3: La voce di menu**

**«Gestione macchinari esterni»** — `Equipment suppliers` / `Fournisseurs d'équipements` / `Proveedores de equipos`. Va nel gruppo GESTIONE della barra, sotto le due sezioni esami.

- [ ] **Step 4: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Con un account di prova: importare un listino, usare il recupero, verificare che le clip trovate compaiano nel catalogo col laboratorio giusto e che quelle gia' presenti non vengano duplicate. Correggere il prezzo di una clip a mano e verificare che resti. Assegnare un laboratorio a una clip che non ce l'ha.

**Al termine rimuovere l'account di prova.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/i18n.js server.js
git commit -m "feat: catalogo clip visibile e correggibile, con recupero dai listini importati"
```

---

### Task 4: Import PDF dedicato in Gestione macchinari esterni

**Files:**
- Modify: `lib/importbozze.js`, `lib/concorrenti.js`, `lib/concorrenti.test.js`, `server.js`, `public/importpdf.js`, `public/app.js`, `public/i18n.js`

**Interfaces:**
- `ENTITA` in `lib/importbozze.js` diventa `['piano', 'concorrente', 'clip', 'analizzatore']`.
- `trovaOCreaConcorrente(db, nome, userId)` in `lib/concorrenti.js` → `{ id }`: trova il laboratorio per nome o lo crea, **senza scrivere righe di esami**. Serve perche' `upsertConcorrente` scrive anche il listino, e qui il listino e' di clip.
- Il Task 5 usa la stessa forma per `'analizzatore'`.

**La regola decisa dal committente:** chi importa in questa sezione sta dichiarando che quel PDF e' un listino di macchinari. Quindi **tutte le righe col prezzo diventano clip**, non solo quelle riconosciute: l'applicazione crede alla dichiarazione invece di indovinare riga per riga. Il riconoscimento serve ancora per **leggere i pezzi** dal nome, non per decidere cosa entra.

- [ ] **Step 1: Il laboratorio senza listino esami**

Scrivere prima il test in `lib/concorrenti.test.js`:

```javascript
test('trovaOCreaConcorrente crea il laboratorio senza scrivere esami', () => {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  const a = trovaOCreaConcorrente(db, 'IDEXX', 9);
  assert.ok(a.id > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM esami_concorrente').get().c, 0,
    'un listino di clip non deve inventare righe di esami');
  const b = trovaOCreaConcorrente(db, 'IDEXX', 9);
  assert.equal(b.id, a.id, 'lo stesso nome non crea un secondo laboratorio');
  const c = trovaOCreaConcorrente(db, 'IDEXX', 10);
  assert.notEqual(c.id, a.id, 'un altro account ha il suo');
  db.close();
});
```

Poi implementarlo: cerca per `nome` e `user_id`, inserisce se manca. E' lo stesso ritaglio gia' presente dentro `upsertConcorrente`: va **estratto e riusato da entrambi**, non copiato, altrimenti nascono due modi di creare un laboratorio che possono divergere.

- [ ] **Step 2: La destinazione `clip` nell'import**

In `lib/importbozze.js`, `'clip'` entra in `ENTITA`. In `public/importpdf.js`, `'clip'` entra in `ENTITA_VALIDE` e la finestra chiede **il nome del laboratorio**, con lo stesso campo che gia' chiede il nome del concorrente: e' obbligatorio, e senza di esso la conferma si blocca con un avviso.

In `server.js`, nella conferma, accanto ai rami esistenti:

```javascript
} else if (bozza.entita === 'clip') {
  // Chi importa qui sta dichiarando che questo PDF e' un listino di macchinari:
  // ogni riga col prezzo e' una clip di quel laboratorio. I pezzi si leggono dal
  // nome quando ci sono; quando non ci sono si lascia vuoto, perche' un costo
  // per clip sbagliato di un fattore dodici e' peggio di un costo mancante, e
  // l'operatore lo completa dal catalogo.
  const nomeLab = String(nome || '').trim();
  if (!nomeLab) return res.status(400).json({
    error: 'Manca il nome del laboratorio', codice: 'NOME_LABORATORIO_MANCANTE' });
  const lab = concorrenti.trovaOCreaConcorrente(db, nomeLab, req.user.id);
  for (const r of valide) {
    clipLib.upsertClip(db, {
      userId: req.user.id, concorrenteId: lab.id, nome: r.nome,
      prezzoConfezione: r.prezzo, pezzi: clipLib.leggiPezzi(r.nome),
      sconto: null, fonte: 'pdf'
    });
  }
  risultato = { concorrenteId: lab.id, clipImportate: valide.length };
}
```

La chiave `errore.NOME_LABORATORIO_MANCANTE` va nelle quattro lingue.

- [ ] **Step 3: Il pulsante nella sezione**

In Gestione macchinari esterni, un pulsante **«Importa listino PDF»** come quello di Gestione esami esterni, che apre `ImportPdf.avvia({ entita: 'clip', alFine: ... })`.

Sotto il pulsante, una riga che dice cosa succede, perche' qui la regola e' diversa dall'altra sezione: **ogni riga con un prezzo diventera' una clip di questo laboratorio.** Dirlo prima evita la sorpresa di un listino misto importato per errore.

- [ ] **Step 4: Verificare**

```bash
node --check server.js && node --check public/importpdf.js && node --check public/app.js && npm test
```

Riavviare il server: `server.js` e `lib/` non ricaricano a caldo. Con un account di prova, importare `lib/fixtures/listino-misto-macchine.pdf` come listino di macchinari del laboratorio «ZZ Prova»: **tutte** le righe col prezzo devono diventare clip di quel laboratorio, comprese quelle che sembrano esami — e' la regola decisa. Verificare che i pezzi siano letti dove il nome li porta e vuoti dove non ci sono. Confermare senza il nome del laboratorio deve essere impedito.

**Al termine rimuovere l'account di prova seguendo l'ordine dei vincoli globali.**

- [ ] **Step 5: Commit**

```bash
git add lib/ server.js public/
git commit -m "feat: import PDF dedicato per i listini di macchinari esterni"
```

---

### Task 5: Gestione macchinari interni

**Files:**
- Create: `lib/analizzatori.js`, `lib/analizzatori.test.js`
- Modify: `server.js`, `public/app.js`, `public/i18n.js`, `public/importpdf.js`, `lib/importbozze.js`

**Interfaces:**
- `lib/analizzatori.js`: `ensureSchema(db)`, `upsertAnalizzatore(db, {userId, nome, prezzo, noleggio, note})`, `listaAnalizzatori(db, userId)`, `eliminaAnalizzatore(db, id, userId)`.
- Rotte `GET/POST/PUT/DELETE /api/analizzatori`, e la destinazione `'analizzatore'` nell'import.

**Portata dichiarata:** e' un catalogo. Non entra nel calcolo del calcolatore macchinari, dove il lato Mylav e' il piano di scontistica sugli esami.

- [ ] **Step 1: Scrivere i test**

Creare `lib/analizzatori.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const an = require('./analizzatori');

function dbProva() { const db = new DatabaseSync(':memory:'); an.ensureSchema(db); return db; }

test('upsertAnalizzatore salva e rilegge', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000, noleggio: 250 });
  assert.ok(id > 0);
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 12000);
  assert.equal(righe[0].noleggio, 250);
  db.close();
});

// Un analizzatore puo' essere solo venduto o solo noleggiato: entrambi i campi
// sono facoltativi, e "non previsto" non e' la stessa cosa di "costa zero".
test('prezzo e noleggio sono facoltativi e restano distinti da zero', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Solo noleggio', prezzo: null, noleggio: 180 });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.prezzo, null);
  assert.equal(r.noleggio, 180);
  db.close();
});

test('reimportare lo stesso nome aggiorna invece di duplicare', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500 });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 11500);
  db.close();
});

test('gli analizzatori sono isolati per account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'A', prezzo: 2 });
  assert.equal(an.listaAnalizzatori(db, 1).length, 1);
  assert.equal(an.listaAnalizzatori(db, 1)[0].prezzo, 1);
  db.close();
});

test('eliminaAnalizzatore tocca solo il proprio account', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.eliminaAnalizzatore(db, id, 2);
  assert.equal(an.listaAnalizzatori(db, 1).length, 1, 'un altro account non puo cancellarlo');
  an.eliminaAnalizzatore(db, id, 1);
  assert.equal(an.listaAnalizzatori(db, 1).length, 0);
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/analizzatori.test.js`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Il modulo**

```sql
CREATE TABLE IF NOT EXISTS analizzatori_mylav (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  nome        TEXT NOT NULL,
  prezzo      REAL,
  noleggio    REAL,
  note        TEXT,
  data_import DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, nome)
);
```

Stesso stile degli altri moduli: `snake_case` nel database, `camelCase` in uscita, filtro per `user_id` su ogni lettura e scrittura. Attenzione a non confondere `null` con `0` nella conversione: un canone non previsto e un canone gratuito sono due cose diverse.

- [ ] **Step 4: Rotte e import**

Le quattro rotte con `requireAuth`, coi codici `ANALIZZATORE_NON_TROVATO` e `ANALIZZATORE_DUPLICATO`, tradotti nelle quattro lingue. E la destinazione `'analizzatore'` nell'import, che **non chiede nessun laboratorio** — il laboratorio e' Mylav — e porta ogni riga col prezzo nel catalogo, come fa `'clip'` col suo.

- [ ] **Step 5: La sezione**

**«Gestione macchinari interni»**, con lo stesso impianto delle altre: pulsante di import, elenco con nome, prezzo, canone e note, aggiunta, modifica e cancellazione a mano, barra di ricerca con `Ricerca.corrisponde`.

Dove il canone non e' previsto la cella resta vuota, non mostra zero: zero vuol dire gratis, ed e' un'altra informazione.

- [ ] **Step 6: Verificare**

```bash
node --check server.js && node --check public/app.js && npm test
```

Riavviare il server. Con un account di prova: importare un PDF come listino Mylav e verificare che le righe entrino nel catalogo; aggiungere un analizzatore a mano con il solo canone e verificare che il prezzo resti vuoto; modificarlo, cercarlo, eliminarlo.

**Al termine rimuovere l'account di prova.**

- [ ] **Step 7: Commit**

```bash
git add lib/analizzatori.js lib/analizzatori.test.js server.js public/
git commit -m "feat: gestione macchinari interni, con import PDF e catalogo"
```

---

### Task 6: La colonna Laboratorio nel calcolatore macchinari

**Files:**
- Modify: `public/app.js`, `public/i18n.js`, `public/style.css`, `server.js`

**Interfaces:**
- Consumes: `GET /api/clip?concorrenteId=N` e l'elenco dei laboratori.
- Il descrittore del calcolatore vive in `public/app.js` (cercare `motoreClip`); il motore comune e' `public/calcolatore.js`.

**Come lo vuole il committente:** si scrive la struttura, si scrive il laboratorio, e da quel momento la ricerca delle clip pesca **dal listino di quel laboratorio**.

- [ ] **Step 1: La colonna**

Nuova colonna `laboratorio`, **subito dopo `struttura`**, prima del blocco delle clip:

```javascript
{ col: 'laboratorio', intestazione: 'clip.tabella.laboratorio', tipo: 'testo',
  larghezza: 150, gruppo: 'concorrenza', elenco: 'clip-lab-list',
  segnaposto: 'clip.placeholderLaboratorio' }
```

Sta nel gruppo della concorrenza e ne prende la tinta rossa: e' il lato di chi vende la clip, e cosi' introduce il blocco invece di restare in un limbo neutro.

La riga vuota guadagna `laboratorio: ''`. Il salvataggio e la riapertura lo conservano, quindi serve una colonna `laboratorio` anche in `righe_calcolo_clip`, aggiunta con `addColIfMissing` — additiva, mai distruttiva.

- [ ] **Step 2: I suggerimenti del laboratorio**

Il campo e' a testo libero con la tendina, come gli altri: si scrive qualche lettera e compaiono i laboratori **che hanno clip in catalogo**, con `Ricerca.corrisponde`, quindi tollerante agli errori di battitura e all'ordine delle parole.

- [ ] **Step 3: Il filtro delle clip, per riga**

Scritto un laboratorio che corrisponde a uno esistente, il catalogo **di quella riga** diventa il suo: la tendina della clip e `trovaClip` propongono solo le sue.

**Il catalogo filtrato deve stare per riga, non per tabella.** Due righe possono confrontare laboratori diversi nello stesso calcolo, ed e' un caso normale quando si mettono a confronto due fornitori: tenerlo in una variabile unica del calcolatore darebbe alla seconda riga le clip della prima, che e' il mix in forma peggiore perche' sembra corretto.

Senza laboratorio scritto, il campo della clip **lo chiede** invece di proporre tutto.

- [ ] **Step 4: Cambiare laboratorio a riga compilata**

Valgono le due regole degli altri calcolatori, ed e' costato farle funzionare:
- un valore scritto dall'operatore non viene **mai** sovrascritto da un riempimento automatico;
- cambiando laboratorio, cio' che era stato riempito **da solo** per il laboratorio precedente si azzera, **e anche il nome della clip** se quella clip non esiste nel listino nuovo. Lasciarlo mostrerebbe la clip di un laboratorio sotto il nome di un altro.

- [ ] **Step 5: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Con **due** laboratori, ciascuno con una clip dallo stesso nome e prezzo diverso: scrivere il primo e verificare che suggerimento e prezzo siano i suoi; passare al secondo e verificare che cambino. Poi **due righe con due laboratori diversi nello stesso calcolo**: ciascuna deve proporre le sue. E' la prova che il mix e' sparito.

Verificare anche che 448,50 su 12 pezzi dia **37,38**, e che salvando e riaprendo il calcolo il laboratorio resti.

**Al termine rimuovere l'account di prova.**

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/i18n.js public/style.css server.js
git commit -m "feat: colonna laboratorio nel calcolatore, con le clip di quel listino"
```

---

### Task 7: Le quattro sezioni come due coppie, traduzioni e verifica

**Files:**
- Modify: `public/app.js`, `public/style.css`, `public/i18n.js`

- [ ] **Step 1: Il colore dice a chi appartiene la cosa**

Il progetto usa gia' **blu `--blue` per Mylav e rosso `--red` per la concorrenza**, ed e' il vocabolario dei due calcolatori. Le quattro voci di gestione lo ereditano: **interni blu, esterni rossi**, con una barretta di colore a sinistra della voce nel menu.

Non e' decorazione: e' l'informazione che il testo gia' porta, detta anche dall'occhio. E **non si aggiunge nessun colore nuovo** — la tavolozza resta quella, che e' il motivo per cui l'operatore la sa gia' leggere.

Le quattro voci stanno sotto un unico divisore **GESTIONE**, in quest'ordine: esami interni, esami esterni, macchinari interni, macchinari esterni. Prima la coppia che si usa di piu', e dentro ogni coppia prima Mylav.

```css
/* Le quattro sezioni di gestione sono due coppie: il colore lo dice senza
   parole, riusando il codice che l'operatore gia' legge nei calcolatori. */
.nav-item-interni { box-shadow: inset 3px 0 0 var(--blue); }
.nav-item-esterni { box-shadow: inset 3px 0 0 var(--red); }
```

Attenzione alla specificita': `.nav-item.active` definisce gia' un `box-shadow` e vincerebbe. Le regole della voce attiva vanno scritte per entrambe le classi, altrimenti la barretta sparisce proprio quando sei dentro quella sezione — e' un difetto gia' incontrato in questo progetto con il peso del testo.

- [ ] **Step 2: Censire le stringhe nuove**

```bash
grep -nE ">[A-ZÀ-Ú][^<>{}]{3,70}<|placeholder=\"[^\"]+\"|alert\('[^']+'|confirm\('[^']+'" public/app.js public/importpdf.js
```

Ogni stringa visibile introdotta dai task 4-6 deve passare da `t()`, con la chiave nei quattro blocchi.

- [ ] **Step 3: Parita' delle chiavi**

Rieseguire il controllo dello Step 3 del Task 1.

- [ ] **Step 4: Giro completo nelle quattro lingue**

Le quattro sezioni, i due calcolatori, le due cronologie e la finestra di import fino alla revisione, in italiano, inglese, francese e spagnolo. Cercare testo italiano residuo e avvisi «chiave mancante» in console.

- [ ] **Step 5: La prova che conta**

Importare un listino di macchinari per il laboratorio A e uno per il laboratorio B, con una clip dallo stesso nome e prezzi diversi. Nel calcolatore, due righe: scrivendo A nella prima e B nella seconda, ciascuna deve proporre e riempire **le sue**. E 448,50 su 12 pezzi deve dare **37,38**.

- [ ] **Step 6: Suite e stato del database**

```bash
npm test
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const t of ['users','concorrenti','clip','analizzatori_mylav','calcoli_clip']) {
  console.log(t, db.prepare('SELECT COUNT(*) c FROM '+t).get().c);
}
console.log('orfani piani:', db.prepare('SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)').get().c);
db.close();"
```

Attese: 11 utenti, 1 concorrente, 0 orfani, e le tabelle nuove vuote dopo la pulizia.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: le quattro sezioni si leggono come due coppie, e verifica nelle quattro lingue"
```

---

## Self-review

**Copertura della correzione del 2026-09-21:**

| Requisito | Task |
|---|---|
| Ogni sezione ha il suo import PDF | 4 (esterni), 5 (interni) |
| Tutte le righe col prezzo diventano clip | 4 |
| Il laboratorio si nomina all'import | 4 |
| La spunta e il recupero restano | gia' fatti nelle fette 2 e 3 |
| Gestione macchinari interni esiste | 5 |
| Colonna laboratorio subito dopo struttura | 6 |
| I suggerimenti pescano da quel listino | 6 |
| Le quattro sezioni come due coppie, coi colori Mylav | 7 |
| Quattro lingue | 4-6 per le chiavi, 7 per la verifica |

**Punti annotati durante la stesura:**

- `trovaOCreaConcorrente` esiste perche' `upsertConcorrente` scrive anche righe di esami: usarlo per un listino di clip inventerebbe un listino esami vuoto. Il ritaglio va estratto e condiviso, non copiato, altrimenti nascono due modi di creare un laboratorio che possono divergere.
- Il catalogo filtrato dev'essere **per riga** e non per tabella. Due righe possono confrontare laboratori diversi nello stesso calcolo, e una variabile unica darebbe alla seconda le clip della prima: e' lo stesso errore del mix che questo lavoro elimina, in forma peggiore perche' non si vede.
- Cambiando laboratorio va azzerato anche il nome della clip se non appartiene al listino nuovo. Lasciarlo mostrerebbe la clip di un laboratorio sotto il nome di un altro, e sembrerebbe corretto.
- Il colore delle quattro sezioni non introduce nulla di nuovo: riusa il blu e il rosso che l'operatore gia' legge nei calcolatori. Un terzo colore avrebbe aggiunto una convenzione da imparare per dire una cosa che il testo gia' dice.
- La specificita' di `.nav-item.active` ha gia' morso una volta in questo progetto, portando via il peso del testo alle voci grandi della barra. Qui porterebbe via la barretta di colore esattamente quando serve.
