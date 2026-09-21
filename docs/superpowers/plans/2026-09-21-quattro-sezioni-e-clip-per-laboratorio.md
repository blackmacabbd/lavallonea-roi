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

### Task 4: Il selettore del laboratorio nel calcolatore clip

**Files:**
- Modify: `public/app.js`, `public/i18n.js`

**Interfaces:**
- Consumes: `GET /api/clip?concorrenteId=N` dal Task 2.
- Il descrittore del calcolatore clip vive in `public/app.js` (cercare `motoreClip`); il selettore del concorrente nel calcolatore esami (`selezionaConcorrente`, `roi-concorrente-btn`) e' il modello da imitare.

- [ ] **Step 1: Il selettore**

In cima al calcolatore clip, accanto al piano, un selettore **Laboratorio** con lo stesso aspetto di quello del concorrente nel calcolatore esami. Alla scelta si carica il catalogo di quel laboratorio in `S.clip.catalogo` e si aggiorna l'elenco dei suggerimenti.

- [ ] **Step 2: I suggerimenti filtrati**

`trovaClip` e la tendina leggono `S.clip.catalogo`, che ora contiene **solo** le clip del laboratorio scelto: e' questo che elimina il mix.

**Senza laboratorio scelto** il campo della clip lo chiede, invece di proporre tutto. Proporre tutto e' esattamente il problema da cui nasce questo lavoro.

- [ ] **Step 3: Cambiare laboratorio a riga compilata**

Valgono le due regole gia' in uso negli altri calcolatori, ed e' costato farle funzionare:
- un valore scritto dall'operatore non viene **mai** sovrascritto da un riempimento automatico;
- cambiando laboratorio, cio' che era stato riempito **da solo** con le clip del laboratorio precedente si azzera; quello scritto a mano resta.

- [ ] **Step 4: Verificare**

```bash
node --check public/app.js && npm test
```

Con due laboratori in catalogo, ciascuno con una clip dallo stesso nome ma prezzo diverso: scegliere il primo e verificare che il suggerimento e il prezzo siano i suoi; passare al secondo e verificare che cambino. E' la prova che il mix e' sparito.

Verificare anche il conto: una clip da **448,50** su **12** pezzi deve dare **37,38**.

**Al termine rimuovere l'account di prova.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/i18n.js
git commit -m "feat: il calcolatore clip propone solo le clip del laboratorio scelto"
```

---

### Task 5: Gestione macchinari interni

**Files:**
- Modify: `public/app.js`, `public/i18n.js`, `server.js`

**Interfaces:**
- Produces: tabella `analizzatori_mylav`, rotte `GET/POST/PUT/DELETE /api/analizzatori`, vista `'macchinari-interni'`.

**Portata dichiarata:** e' un **catalogo consultabile**, non entra nel calcolo del calcolatore clip. Li' il lato Mylav e' il piano di scontistica sugli esami; vendere o noleggiare un analizzatore e' un'altra trattativa. Se dovesse entrare nel confronto, la struttura cambierebbe e il committente lo dira'.

- [ ] **Step 1: La tabella**

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

`prezzo` e' il prezzo di vendita, `noleggio` il canone: un analizzatore puo' avere l'uno, l'altro o entrambi, quindi entrambi sono facoltativi.

- [ ] **Step 2: Le rotte**

Quattro rotte con `requireAuth`, tutte filtrate per `req.user.id`, con un `codice` sugli errori come le altre: `ANALIZZATORE_NON_TROVATO`, `ANALIZZATORE_DUPLICATO`.

- [ ] **Step 3: La sezione**

**«Gestione macchinari interni»** — `Mylav equipment` / `Équipements Mylav` / `Equipos Mylav`. Elenco con nome, prezzo, canone e note; aggiunta, modifica e cancellazione a mano; barra di ricerca con `Ricerca.corrisponde`.

L'import PDF di un listino di analizzatori Mylav **non** fa parte di questa fetta: prima serve capire se il committente ha un PDF di quel tipo, e con che forma.

- [ ] **Step 4: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Con un account di prova: creare un analizzatore, modificarlo, cercarlo, eliminarlo; verificare che un altro account non veda il primo.

**Al termine rimuovere l'account di prova.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/i18n.js server.js
git commit -m "feat: catalogo degli analizzatori che Mylav vende o noleggia"
```

---

### Task 6: Traduzioni e verifica end-to-end

**Files:**
- Modify: `public/i18n.js`, e correzioni dove la verifica le richiede.

- [ ] **Step 1: Censire le stringhe nuove**

```bash
grep -nE ">[A-ZÀ-Ú][^<>{}]{3,70}<|placeholder=\"[^\"]+\"|alert\('[^']+'|alert\(\`[^\`]+|confirm\(\`[^\`]+|confirm\('[^']+'" public/app.js public/importpdf.js
```

Ogni stringa visibile introdotta dai task 2-5 deve passare da `t()`, con la chiave nei quattro blocchi. Il censimento va nel report.

- [ ] **Step 2: Parita' delle chiavi**

Rieseguire il controllo dello Step 3 del Task 1.

- [ ] **Step 3: Giro completo nelle quattro lingue**

Con un account di prova, in italiano, inglese, francese e spagnolo: le quattro sezioni nuove o rinominate, i due calcolatori, le due cronologie, e la finestra di import fino alla revisione. Cercare testo italiano residuo e avvisi «chiave mancante» in console.

- [ ] **Step 4: La prova che conta**

Due laboratori, ciascuno con una `Chem 17 CLIP` a prezzi diversi. Nel calcolatore, scegliendo l'uno o l'altro, il suggerimento e il prezzo devono cambiare. E il costo per clip di una confezione da **448,50** su **12** pezzi deve essere **37,38**.

Sul listino reale, il recupero deve trovare **11 clip**.

- [ ] **Step 5: Suite e stato del database**

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

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: traduzioni delle quattro sezioni e verifica nelle quattro lingue"
```

---

## Self-review

**Copertura dello spec:**

| Requisito | Task |
|---|---|
| Rinomina esami interni ed esterni | 1 |
| Un laboratorio, due listini | 2 |
| Le clip esistenti non si perdono e non vengono attribuite d'ufficio | 2 (test), 3 (gruppo «non indicato») |
| Due laboratori possono vendere la stessa clip | 2 (test) |
| Catalogo clip visibile e correggibile | 3 |
| Recupero dai listini gia' importati, con conferma | 3 |
| Selettore laboratorio, suggerimenti filtrati | 4 |
| Gestione macchinari interni come catalogo | 5 |
| Quattro lingue | 1-5 per le chiavi, 6 per la verifica |

**Punti annotati durante la stesura:**

- Il vincolo `UNIQUE(user_id, nome)` sulla tabella `clip` e' il punto rischioso: impedirebbe a due laboratori di vendere la stessa clip, e SQLite non sa toglierlo senza ricostruire la tabella. Il Task 2 lo fa dentro una transazione, conservando gli id, con un test che parte dallo schema vecchio e verifica che la riga sopravviva.
- In SQLite i `NULL` sono distinti fra loro dentro un `UNIQUE`: senza il secondo indice parziale, una clip senza laboratorio potrebbe entrare due volte. E' un difetto in cui questo progetto e' gia' incappato, e c'e' un test apposta.
- Le clip senza laboratorio devono essere **visibili**, altrimenti esistono nel database e non si vedono da nessuna parte. Il gruppo «laboratorio non indicato» del Task 3 e' cio' che le rende raggiungibili.
- Il recupero dai listini **non scrive niente** finche' l'operatore non conferma. Smistare righe senza conferma e' l'errore che ha reso sbagliata la logica dei macchinari.
