# Calcolatore clip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Togliere la sezione Macchinari e costruire al suo posto un secondo calcolatore, gemello di quello degli esami, che confronta il costo di una clip fatta in casa col prezzo Mylav dello stesso profilo.

**Architecture:** I due calcolatori condividono un motore in `public/calcolatore.js` che tiene cio' che in entrambi e' identico (sincronia campi-stato, totali, aggiunta e rimozione righe, suggerimenti, salvataggio); ciascuno porta il proprio elenco di colonne, la propria riga vuota e la propria cascata di riempimento. Le clip vivono in un catalogo unico per account, popolato da un import PDF dedicato o da una spunta nella revisione dell'import concorrenti.

**Tech Stack:** Node/Express, `node:sqlite`, JS vanilla senza build, test con `node:test` (`npm test` = `node --test lib/*.test.js`).

## Global Constraints

- **Nessuna dipendenza nuova.**
- `npm test` verde alla fine di ogni task. Oggi sono **212 test**.
- **Il calcolatore esami deve comportarsi esattamente come oggi.** E' lo strumento che il committente usa davanti ai clienti: una regressione la' vale piu' di qualunque funzione nuova.
- **In italiano l'interfaccia resta identica a oggi**, parola per parola, accenti, maiuscole, icone e spazi compresi. Se un testo sembra migliorabile, lasciarlo e scriverlo nel report.
- I dati dell'operatore non si traducono e non si alterano mai: nomi di esami, clip, profili, concorrenti, strutture e importi restano come sono.
- Ogni chiave di traduzione nuova va in **tutti e quattro** i blocchi di `public/i18n.js` (`it`, `en`, `fr`, `es`). Un controllo automatico verifica parita' delle chiavi e dei segnaposto `{...}`; unica eccezione ammessa, le varianti `.uno`.
- Convenzione singolare/plurale: `chiave` piu' `chiave.uno`, scelta con `n === 1`. L'italiano della `.uno` copia il plurale.
- Palette: **rosso** = il costo che il veterinario sostiene da solo, **blu** = Mylav.
- Testi visibili con accenti corretti; commenti nel codice senza accenti (il progetto scrive `e'` al posto di «è»). Tipografia: francese con lo spazio prima di `:`, `?`, `!`, `%`; spagnolo con `¿` e `¡` di apertura.
- Terminologia: esame→test/analyse/análisis, listino→price list/tarif/tarifa, concorrente→competitor/concurrent/competidor, profilo→profile/profil/perfil, clip→clip/clip/clip (nome di prodotto, invariato).
- **Nessuna migrazione distruttiva.** Il database contiene un account cliente reale (utente id 9) con un concorrente, due strutture e sei file caricati. Le colonne nuove si aggiungono con `addColIfMissing`, che e' gia' in uso.
- Stato del database da ripristinare dopo ogni verifica: **11 utenti** con 60 righe in `piani_sconto` ciascuno, piu' il template `user_id IS NULL` con 60; **1 concorrente** (id 9, reale, da non toccare); **0 righe orfane** in `piani_sconto` e `esami_riferimento`. `users` ha figli in queste tabelle, da svuotare prima di cancellare un utente di prova: `prezzi_piano_esame` (via `piano_id` e via `esame_id`), `prezzi_esami_custom`, `dati_foglio` (via `piano_id` e via `file_id`), `file_caricati` (via `struttura_id`), `strutture`, `esami_concorrente` (via `concorrente_id`), `concorrenti`, `piani_sconto`, `esami_riferimento`, `import_bozze`, `import_audit`, `sessions`, `reset_codes`. Un `DELETE FROM users` diretto fallisce con FOREIGN KEY.
- Il server sulla porta 3000 **non ricarica a caldo**: dopo aver toccato `server.js` o `lib/`, riavviarlo prima di verificare, altrimenti si prova il codice vecchio.
- **Nessun push.**

---

## File Structure

| File | Responsabilita' | Task |
|---|---|---|
| `lib/macchine.js`, `lib/macchine.test.js` | da eliminare | 1 |
| `public/calcolatore.js` | motore comune dei due calcolatori | 2 |
| `lib/clip.js` | catalogo clip: schema, lettura pezzi dal nome, upsert | 3 |
| `lib/clip.test.js` | test del catalogo e del riconoscimento | 3, 4 |
| `server.js` | rotte macchine via, rotte clip e calcoli clip | 1, 3, 4, 6 |
| `public/importpdf.js` | ramo macchina via, spunta «e' una clip» | 1, 4 |
| `public/app.js` | sezioni macchine via, calcolatore clip, cronologia | 1, 2, 5, 6 |
| `public/i18n.js` | chiavi orfane via, chiavi nuove | 1, 3, 5, 6, 7 |
| `public/style.css` | stili macchine via, stili del calcolatore clip | 1, 5 |

---

### Task 1: Rimozione dei macchinari

**Files:**
- Delete: `lib/macchine.js`, `lib/macchine.test.js`
- Modify: `server.js`, `public/app.js`, `public/importpdf.js`, `public/i18n.js`, `public/style.css`

**Interfaces:**
- Produces: nessuna interfaccia nuova. Dopo questo task non esistono piu' `listini_macchine`, `macchine`, ne' l'entita' `macchina` nell'import.

**Cosa NON toccare.** `lib/pdfclassifica.js` resta **intatto**, test compresi. Riconosce i capitoli di analizzatori e per questo non segnala come errore un prezzo da 8.500 euro: e' il motivo per cui l'import del listino reale da 117 pagine non e' pieno di falsi allarmi. Togliere quella conoscenza renderebbe rumoroso un percorso che oggi funziona. Sparisce solo lo **smistamento**, non la classificazione.

- [ ] **Step 1: Censire la superficie**

```bash
grep -rn "macchin\|Macchin" --include=*.js --include=*.html --include=*.css public/ lib/ server.js | grep -v pdfclassifica | wc -l
grep -rn "listini-macchine\|api/macchine\|entita.*macchina\|'macchina'" server.js public/ lib/ | grep -v pdfclassifica
```

Scrivere l'elenco nel report: serve a chi rivede per controllare che non resti nulla.

- [ ] **Step 2: Togliere le rotte e lo schema dal server**

In `server.js`: eliminare le sette rotte `/api/listini-macchine` e `/api/macchine` (intorno alle righe 1676-1720), la `require` di `lib/macchine.js`, la chiamata `macchineLib.ensureSchema(db)` all'avvio, la funzione `statoErroreMacchina` e i codici d'errore che restano senza emittente (`LISTINO_NON_TROVATO`, `MACCHINA_NON_TROVATA`, `MACCHINA_DUPLICATA`).

Nel ramo dell'import: `'macchina'` esce da `ENTITA` in `lib/importbozze.js`, e il ramo `bozza.entita === 'macchina'` esce dalla conferma in `server.js`.

Le tabelle `listini_macchine` e `macchine` si eliminano con `DROP TABLE IF EXISTS`, **una sola volta e solo se vuote**:

```javascript
// I macchinari confrontavano il prezzo di acquisto degli analizzatori, che non
// e' la decisione che il veterinario prende. La logica e' stata sostituita dal
// calcolatore clip: le due tabelle non servono piu'.
// Il DROP gira solo a tabella vuota: se qualcuno avesse dei dati, e' meglio
// fallire l'avvio e accorgersene che cancellarglieli.
for (const t of ['macchine', 'listini_macchine']) {
  const esiste = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  if (!esiste) continue;
  const righe = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  if (righe > 0) {
    throw new Error(`La tabella ${t} contiene ${righe} righe: rimuovile prima di aggiornare.`);
  }
  db.exec(`DROP TABLE ${t}`);
}
```

- [ ] **Step 3: Togliere le sezioni dall'interfaccia**

In `public/app.js`: le voci di menu Macchinari e Confronto macchine, i `case 'macchinari'` e `case 'confronto-macchine'` di `navigate`, e tutte le funzioni che servivano solo a loro — `renderMacchinari`, `disegnaMacchinari`, `bloccoListiniHtml`, `filtraListiniMie`, `filtraListiniLoro`, `importaPdfMacchineMie`, `importaPdfMacchineConcorrente`, `renderListinoMacchine`, `renderListinoMacchineBody`, `filtraMacchine`, `chiudiListinoMacchine`, `nuovaMacchina`, `modificaMacchina`, `salvaMacchinaUI`, `annullaModificaMacchina`, `eliminaMacchinaUI`, `eliminaListinoUI`, `renderConfrontoMacchine`, `renderCorpoConfrontoMacchine`, `rimuoviTuttoConfrontoMacchine`, e i campi di `S` che restano inutilizzati (`listiniMacchine`, `listinoAperto`, `macchinaInModifica`, `filtroMacchine`, `filtroListiniMie`, `filtroListiniLoro`, `confrontoMacchine`, `salvataggioMacchinaInCorso`, `macchine`).

Attenzione a tre punti che toccano codice condiviso e vanno adeguati, non cancellati:
- `_sottoVista` conosce il tipo `'listinoMacchine'`: quel ramo esce da `riapriSottoVista` e da `scordaSottoVista`.
- `eliminaConcorrenteUI` nomina i listini di macchine nella conferma: il testo torna a parlare dei soli esami.
- `lib/concorrenti.js` cancella i listini di macchine dentro `eliminaConcorrente`: quelle due `DELETE` escono, e il test che le copre va aggiornato di conseguenza (dichiararlo nel report).

In `public/importpdf.js`: `'macchina'` esce da `ENTITA_VALIDE`, spariscono il parametro `lato`, il campo del concorrente legato alle macchine e l'avviso «nessun analizzatore riconosciuto» (riga ~547).

In `public/style.css`: le regole `.macc-blocco*`.

- [ ] **Step 4: Togliere le chiavi di traduzione rimaste orfane**

Tutte le chiavi `macchinari.*` e `confronto.*` che nessuno usa piu', in tutti e quattro i blocchi. Verificare quali con questo controllo, che tiene conto delle chiavi costruite a pezzi:

```bash
node -e "
const fs=require('fs'),vm=require('vm');
let src=fs.readFileSync('public/i18n.js','utf8').replace('window.I18n =','window.__DIZ = DIZIONARIO; window.I18n =');
const c={window:{},localStorage:{getItem:()=>null,setItem:()=>{}},document:{documentElement:{},addEventListener:()=>{},getElementById:()=>null},console};
c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const D=c.window.__DIZ, chiavi=Object.keys(D.it);
const codice=fs.readFileSync('public/app.js','utf8')+fs.readFileSync('public/importpdf.js','utf8')+fs.readFileSync('public/index.html','utf8')+fs.readFileSync('public/i18n.js','utf8');
const usata = k => codice.includes(\"'\"+k+\"'\") || codice.includes('\\\"'+k+'\\\"')
  || (k.endsWith('.uno') && codice.includes(\"'\"+k.slice(0,-4)+\"'\"))
  || k.startsWith('errore.')
  || (k.lastIndexOf('.')>0 && codice.includes(\"'\"+k.slice(0,k.lastIndexOf('.')+1)+\"' +\"));
const morte=chiavi.filter(k=>!usata(k));
console.log('mai riferite:', morte.length); morte.forEach(k=>console.log('  ',k));
"
```

Le chiavi che questo controllo segnala vanno tolte da tutti e quattro i blocchi, dopo aver verificato a mano che non siano costruite in modo che il controllo non vede.

- [ ] **Step 5: Verificare**

```bash
node --check server.js && node --check public/app.js && node --check public/importpdf.js && node --check public/i18n.js && npm test
```

Riavviare il server, entrare come ospite e poi con un account di prova, e controllare: il menu non ha piu' le due voci; nessun errore in console; l'import PDF di un listino esami e di un listino concorrente funziona come prima (usare `lib/fixtures/listino-testo.pdf` e `lib/fixtures/listino-misto-macchine.pdf`); il calcolatore esami e' intatto.

**Al termine rimuovere l'account di prova seguendo il grafo delle chiavi esterne dei vincoli globali.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: via la logica dei macchinari, sostituita dal calcolatore clip"
```

---

### Task 2: Motore comune dei calcolatori

**Files:**
- Create: `public/calcolatore.js`
- Modify: `public/index.html`, `public/app.js`

**Interfaces:**
- Produces `window.Calcolatore.crea(descrittore)` → oggetto con `{ disegnaTabella(), aggiornaRiga(tr), totali(), aggiungiRiga(), rimuoviRiga(i), righeValide(), sincronizza() }`.
- Il descrittore ha questa forma, e il Task 5 ne costruisce un secondo:

```javascript
{
  chiave: 'esami',              // identifica il calcolatore, usato negli id del DOM
  idTbody: 'roi-tbody',
  stato: () => S.roi,           // dove vivono struttura, piano, righe
  rigaVuota: () => ({ ... }),
  colonne: [ /* vedi sotto */ ],
  calcolaRiga: r => ({ ... }),  // i valori calcolati di una riga
  totali: righe => ({ ... }),
  suCampoUscito: async (tr, col) => {}   // la cascata di riempimento
}
```

Una colonna e' descritta cosi':

```javascript
{ col: 'listino_lav',      // nome del campo nello stato, e data-col nel DOM
  intestazione: 'roi.tabella.listinoMyl',   // chiave i18n
  tipo: 'numero',          // 'testo' | 'numero' | 'calcolato' | 'vuota'
  larghezza: 95,
  gruppo: 'mylav',         // 'nessuno' | 'concorrenza' | 'mylav' — decide il colore
  segnaposto: '0.00',
  elenco: 'mylav-esami-list' }   // datalist, facoltativo
```

**Perche' questo task viene prima del calcolatore nuovo.** Copiare mille righe significa che ogni correzione futura va fatta due volte, e una delle due verra' dimenticata: e' gia' successo in questo progetto con la guardia sui segnaposto, che esisteva in due copie e solo una controllava il caso che contava.

- [ ] **Step 1: Fotografare il comportamento attuale**

Prima di spostare una riga, scrivere una prova che fissi cio' che il calcolatore esami fa oggi, da rieseguire dopo l'estrazione. Non e' un test automatico — il calcolatore vive nel DOM — ma una sequenza scritta da ripetere identica:

1. Scrivere un esame concorrente riconosciuto: si riempiono prezzo e sconto, e se e' abbinato anche il nome Mylav.
2. Cambiare l'esame concorrente con uno non abbinato: il nome Mylav riempito da solo sparisce, quello scritto a mano resta.
3. Quantita' indipendenti: 3 a sinistra e 1 a destra danno due totali diversi.
4. Tab sull'ultimo campo dell'ultima riga: ne compare una nuova.
5. Cambiare piano: i prezzi Mylav si aggiornano, quelli scritti a mano no.
6. «Rimuovi tutto»: la tabella si svuota davvero.
7. Salvare: compare in Cronologia file e si riapre con gli stessi valori.

Annotare i valori ottenuti. Sono il metro del passo 4.

- [ ] **Step 2: Estrarre il motore**

Creare `public/calcolatore.js` spostandoci **senza cambiarle** le parti che nei due calcolatori sono identiche: `syncRoiStateFromDOM`, `addRigaRoi`, `removeRigaRoi`, `getRoiRigheValide`, `roiAutocomplete` con la sua tendina, la gestione di Tab ed Escape, `roiMsg`, e la costruzione di intestazioni, righe e piede a partire dall'elenco delle colonne.

Restano in `public/app.js`, come descrittore del calcolatore esami: `roiRigaVuota`, `buildRoiRigaHtml` ridotto al solo calcolo, `calcolaRoiTotali`, `aggiornaPrezziAutomatici`, `aggiornaMatchConcorrente`, `compilaDaEsameConcorrente`, `salvaAbbinamentoRiga`, `mostraConsiglioTotale`, `mostraClassificaPiani`, `salvaCalcolo`.

**Regola di questo passo: nessun cambiamento di comportamento.** Se durante lo spostamento si nota un difetto, non correggerlo qui: annotarlo nel report e lasciarlo per un commit a se'. Mescolare un'estrazione e una correzione rende impossibile capire quale delle due ha rotto qualcosa.

- [ ] **Step 3: Caricare lo script**

In `public/index.html`, `calcolatore.js` va **prima** di `app.js` e dopo `i18n.js`.

- [ ] **Step 4: Verificare che nulla sia cambiato**

```bash
node --check public/calcolatore.js && node --check public/app.js && npm test
```

Rieseguire **tutte e sette** le prove del passo 1 e confrontare i valori con quelli annotati. Qualunque differenza e' una regressione da correggere prima di proseguire: il calcolatore esami e' lo strumento che il committente usa davanti ai clienti.

- [ ] **Step 5: Commit**

```bash
git add public/calcolatore.js public/index.html public/app.js
git commit -m "refactor: motore comune dei calcolatori, comportamento invariato"
```

---

### Task 3: Catalogo clip e lettura dei pezzi

**Files:**
- Create: `lib/clip.js`, `lib/clip.test.js`
- Modify: `server.js`, `public/i18n.js`

**Interfaces:**
- Produces `lib/clip.js` con:
  - `ensureSchema(db)`
  - `leggiPezzi(nome)` → `number | null`
  - `sembraClip(nome)` → `boolean`
  - `upsertClip(db, { userId, nome, prezzoConfezione, pezzi, sconto, fonte })` → `{ id }`
  - `listaClip(db, userId)` → array
  - `eliminaClip(db, id, userId)`
- Rotte: `GET/POST/PUT/DELETE /api/clip`.
- Il Task 4 usa `sembraClip` e `leggiPezzi`; il Task 5 usa `listaClip`.

- [ ] **Step 1: Scrivere i test**

Creare `lib/clip.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const clip = require('./clip');

function dbProva() {
  const db = new DatabaseSync(':memory:');
  clip.ensureSchema(db);
  return db;
}

// I nomi veri vengono dai PDF dei fornitori e finiscono col codice prodotto
// seguito dal numero di pezzi della confezione. E' il numero su cui poggia
// tutto il calcolo: il prezzo del listino e' per confezione, non per clip.
test('leggiPezzi prende il numero in coda al nome', () => {
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 17 CLIP 98-11003-02 12'), 12);
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 15 CLIP 98-11004-01 12'), 12);
  assert.equal(clip.leggiPezzi('Catalyst™ CORT Cortisolo 99-0020377 6'), 6);
  assert.equal(clip.leggiPezzi('Catalyst™ Lyte 4 CLIP 98-11009-02 12'), 12);
});

test('leggiPezzi torna null quando il numero non c e', () => {
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 17 CLIP'), null);
  assert.equal(clip.leggiPezzi(''), null);
  assert.equal(clip.leggiPezzi(null), null);
});

// Un numero enorme in coda e' un codice, non una confezione: nessuno vende
// clip in scatole da mille.
test('leggiPezzi ignora i numeri troppo grandi per essere una confezione', () => {
  assert.equal(clip.leggiPezzi('Qualcosa 99-0010257 1000'), null);
  assert.equal(clip.leggiPezzi('Qualcosa 12345'), null);
});

test('leggiPezzi ignora lo zero', () => {
  assert.equal(clip.leggiPezzi('Qualcosa 98-11003-02 0'), null);
});

// I codici prodotto finiscono con un trattino e due cifre: quella coda non e'
// una confezione. Il numero dei pezzi e' staccato da uno spazio.
test('leggiPezzi non scambia la coda di un codice per una confezione', () => {
  assert.equal(clip.leggiPezzi('Qualcosa -3'), null);
  assert.equal(clip.leggiPezzi('Codice 98-11003-02'), null);
});

// Il riconoscimento serve a proporre, non a decidere: l'operatore conferma
// sempre. Deve pero' essere abbastanza stretto da non riempire il catalogo di
// esami qualunque, perche' 127 voci su 517 del listino reale hanno un numero
// in coda al nome.
test('sembraClip riconosce le voci dei listini reali', () => {
  assert.equal(clip.sembraClip('Catalyst™ Chem 17 CLIP 98-11003-02 12'), true);
  assert.equal(clip.sembraClip('Catalyst™ Chem 18 Profile 99-0010257 12'), true);
  assert.equal(clip.sembraClip('Catalyst™ Lyte 4 CLIP 98-11009-02 12'), true);
  assert.equal(clip.sembraClip('Menù in costante evoluzione: Catalyst™ Chem 10 CLIP 98-11005-01 12'), true);
});

test('sembraClip non scambia un esame per una clip', () => {
  assert.equal(clip.sembraClip('Profilo zecche 5(cane) Test immunologico 2 ml siero 1 –'), false);
  assert.equal(clip.sembraClip('EMOCROMO COMPLETO'), false);
  assert.equal(clip.sembraClip('Leishmania IFI 2'), false);
  assert.equal(clip.sembraClip(''), false);
});

test('upsertClip salva e rilegge', () => {
  const db = dbProva();
  const { id } = clip.upsertClip(db, {
    userId: 1, nome: 'Catalyst™ Chem 17 CLIP 98-11003-02 12',
    prezzoConfezione: 448.5, pezzi: 12, sconto: null, fonte: 'concorrente'
  });
  assert.ok(id > 0);
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzoConfezione, 448.5);
  assert.equal(righe[0].pezzi, 12);
  db.close();
});

// Reimportare lo stesso listino non deve creare doppioni: aggiorna il prezzo.
test('upsertClip sullo stesso nome aggiorna invece di duplicare', () => {
  const db = dbProva();
  const dati = { userId: 1, nome: 'Chem 17 CLIP 12', pezzi: 12, sconto: null, fonte: 'pdf' };
  clip.upsertClip(db, { ...dati, prezzoConfezione: 448.5 });
  clip.upsertClip(db, { ...dati, prezzoConfezione: 460 });
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'una sola riga');
  assert.equal(righe[0].prezzoConfezione, 460, 'col prezzo aggiornato');
  db.close();
});

// Ogni account vede solo le sue clip: e' lo stesso isolamento del resto del
// progetto, dove un difetto di questo tipo aveva gia' fatto vedere a un account
// i dati di un altro.
test('le clip sono isolate per account', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, nome: 'Clip di uno 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, nome: 'Clip di due 12', prezzoConfezione: 200, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1).length, 1);
  assert.equal(clip.listaClip(db, 1)[0].nome, 'Clip di uno 12');
  assert.equal(clip.listaClip(db, 2).length, 1);
  db.close();
});

test('due account possono avere una clip con lo stesso nome', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzoConfezione: 448.5, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, nome: 'Chem 17 CLIP 12', prezzoConfezione: 500, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1)[0].prezzoConfezione, 448.5);
  assert.equal(clip.listaClip(db, 2)[0].prezzoConfezione, 500);
  db.close();
});

test('eliminaClip tocca solo le clip del proprio account', () => {
  const db = dbProva();
  const a = clip.upsertClip(db, { userId: 1, nome: 'Mia 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.eliminaClip(db, a.id, 2);
  assert.equal(clip.listaClip(db, 1).length, 1, 'un altro account non puo cancellarla');
  clip.eliminaClip(db, a.id, 1);
  assert.equal(clip.listaClip(db, 1).length, 0);
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/clip.test.js`
Expected: FAIL, `lib/clip.js` non esiste.

- [ ] **Step 3: Scrivere il modulo**

Creare `lib/clip.js`. Lo schema:

```sql
CREATE TABLE IF NOT EXISTS clip (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  nome              TEXT NOT NULL,
  prezzo_confezione REAL,
  pezzi             INTEGER,
  sconto            REAL,
  fonte             TEXT,
  data_import       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, nome)
);
```

Le due funzioni di riconoscimento:

```javascript
// Il numero di pezzi e' l'ultimo elemento del nome, dopo il codice prodotto.
// Si accetta solo un intero piccolo: le confezioni vanno da poche unita' a
// qualche decina, e un numero piu' grande e' un codice travestito.
const PEZZI_MAX = 200;
function leggiPezzi(nome) {
  // Lo spazio prima del numero non e' un dettaglio: i codici prodotto finiscono
  // con "-02" e senza quel vincolo "Qualcosa -3" varrebbe tre pezzi.
  const m = String(nome == null ? '' : nome).trim().match(/(?:^|\s)(\d{1,3})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= PEZZI_MAX ? n : null;
}

// Riconoscere una clip serve a proporla all'operatore, che conferma sempre.
// Servono due segni insieme: un nome di prodotto (CLIP, Chem, Profile) e un
// numero di pezzi in coda. Il solo numero non basta: nel listino reale 127
// voci su 517 ne hanno uno, e quasi tutte sono esami.
const NOME_CLIP = /\b(clip|chem\s*\d|profile)\b/i;
function sembraClip(nome) {
  const n = String(nome == null ? '' : nome);
  return NOME_CLIP.test(n) && leggiPezzi(n) != null;
}
```

`upsertClip` scrive con `ON CONFLICT(user_id, nome) DO UPDATE`, aggiornando prezzo, pezzi, sconto e fonte. `listaClip` restituisce le righe convertite in `camelCase` (`prezzoConfezione`, `pezzi`, `sconto`, `fonte`), come fanno gli altri moduli del progetto. `eliminaClip` filtra sempre per `user_id`.

- [ ] **Step 4: Eseguire i test**

Run: `node --test lib/clip.test.js`
Expected: PASS, 11 test verdi.

- [ ] **Step 5: Provare il riconoscimento sui dati veri**

Il listino reale e' il metro migliore. Questo controllo e' di sola lettura:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const clip=require('./lib/clip');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
const r=db.prepare('SELECT nome_originale,prezzo FROM esami_concorrente').all();
const viste=r.filter(x=>clip.sembraClip(x.nome_originale));
console.log('voci totali:',r.length,'| riconosciute come clip:',viste.length);
viste.forEach(x=>console.log('  ',x.prezzo,'/',clip.leggiPezzi(x.nome_originale),'=',
  (x.prezzo/clip.leggiPezzi(x.nome_originale)).toFixed(2),'|',x.nome_originale.slice(0,70)));
db.close();"
```

Attese, gia' misurate mentre si scriveva questo piano: **11 voci su 517**, tutte con `CLIP`, `Chem` o `Profile` nel nome, nessun falso positivo, e un costo per clip fra **9,35 e 45,68 euro** — la `Chem 17` da' **37,38**. Se i numeri escono diversi, qualcosa e' cambiato e va capito prima di proseguire.

**Un limite noto, da scrivere nel report invece di correggerlo qui:** voci come `Catalyst™ CORT Cortisolo 99-0020377 6` sono consumabili a test singolo, hanno i pezzi in coda ma non portano `CLIP`, `Chem` o `Profile` nel nome, quindi non vengono riconosciute. E' il verso giusto in cui sbagliare: la casella nella revisione (Task 4) si spunta anche a mano, mentre un riconoscimento largo riempirebbe il catalogo di esami e l'operatore dovrebbe togliere le spunte una per una.

- [ ] **Step 6: Rotte e avvio**

In `server.js`: `clipLib.ensureSchema(db)` all'avvio, accanto alle altre, e le rotte `GET /api/clip`, `POST /api/clip`, `PUT /api/clip/:id`, `DELETE /api/clip/:id`, tutte con `requireAuth` e tutte filtrate per `req.user.id`. Gli errori portano un `codice`, come gia' fanno gli altri: `CLIP_NON_TROVATA`, `CLIP_DUPLICATA`, `NOME_PREZZO_NON_VALIDI` (quest'ultimo esiste gia').

- [ ] **Step 7: Verificare**

```bash
node --check server.js && npm test
```

Riavviare il server e provare le quattro rotte con un account di prova: creare una clip, rileggerla, modificarne il prezzo, cancellarla. **Rimuovere l'account alla fine.**

- [ ] **Step 8: Commit**

```bash
git add lib/clip.js lib/clip.test.js server.js
git commit -m "feat: catalogo clip, con lettura dei pezzi dal nome"
```

---

### Task 4: Riconoscimento nella revisione dell'import

**Files:**
- Modify: `public/importpdf.js`, `server.js`, `public/i18n.js`
- Test: `lib/clip.test.js`

**Interfaces:**
- Consumes: `sembraClip`, `leggiPezzi`, `upsertClip` dal Task 3.
- La conferma dell'import accetta per ogni riga un campo `clip: true|false`; le righe con `clip: true` entrano **anche** nel catalogo clip, senza uscire dal listino del concorrente.

- [ ] **Step 1: Il server accetta e usa la spunta**

Nella conferma dell'import (`POST /api/import-pdf/:id/conferma`), dopo aver scritto il listino del concorrente, le righe con `clip === true` entrano nel catalogo:

```javascript
// Una clip e' una voce del listino del concorrente e li' resta: entra nel
// catalogo clip in aggiunta, non al posto. Spostare le righe senza dirlo e'
// l'errore che ha reso sbagliata la logica dei macchinari.
let clipImportate = 0;
for (const r of valide) {
  if (!r.clip) continue;
  clipLib.upsertClip(db, {
    userId: req.user.id, nome: r.nome, prezzoConfezione: r.prezzo,
    pezzi: clipLib.leggiPezzi(r.nome), sconto: null, fonte: 'concorrente'
  });
  clipImportate++;
}
```

`clipImportate` torna nella risposta, cosi' la finestra puo' dirlo.

Attenzione: `normalizzaRighe` in `lib/importbozze.js` filtra e normalizza le righe, e oggi conserva solo `nome` e `prezzo`. Il campo `clip` va conservato anche li', altrimenti arriva al server e si perde per strada. Aggiungere in `lib/importbozze.test.js` un test che lo verifica.

- [ ] **Step 2: La casella nella revisione**

In `public/importpdf.js`, la tabella di revisione guadagna una colonna `clip` con una casella per riga, **solo quando l'entita' e' `concorrente`**: negli import dei piani non ha senso.

La casella nasce segnata dove `sembraClip(nome)` e' vero. Il riconoscimento gira sul client, quindi la stessa logica serve nel browser: **non duplicarla**. Esporla da `lib/clip.js` non e' possibile (e' un modulo Node), quindi si aggiunge una rotta `POST /api/clip/riconosci` che riceve i nomi e restituisce per ciascuno `{ clip, pezzi }`. Una sola chiamata alla comparsa della revisione, non una per riga.

Sopra la tabella, una riga di riepilogo dice quante righe sono state riconosciute e offre due comandi, «segna tutte» e «togli tutte», perche' su un listino lungo spuntare a mano dieci caselle sparse e' un lavoro inutile.

- [ ] **Step 3: Conferma e messaggio finale**

La conferma invia `clip` per ogni riga. Il messaggio finale dice anche quante clip sono entrate nel catalogo, con la coppia singolare/plurale.

- [ ] **Step 4: Verificare**

```bash
node --check public/importpdf.js && node --check server.js && npm test
```

Riavviare il server e importare `lib/fixtures/listino-misto-macchine.pdf` come concorrente: nessuna sua riga somiglia a una clip, quindi nessuna casella deve nascere segnata — e' la prova che il riconoscimento non e' troppo largo. Poi spuntarne una a mano, confermare, e verificare che compaia nel catalogo clip **e** che sia rimasta fra gli esami del concorrente.

**Rimuovere l'account di prova alla fine.**

- [ ] **Step 5: Commit**

```bash
git add public/importpdf.js server.js lib/importbozze.js lib/importbozze.test.js public/i18n.js
git commit -m "feat: le clip si riconoscono nella revisione dell'import, con conferma"
```

---

### Task 5: Il calcolatore clip

**Files:**
- Modify: `public/app.js`, `public/i18n.js`, `public/style.css`, `server.js`

**Interfaces:**
- Consumes: `window.Calcolatore.crea` dal Task 2, `GET /api/clip` dal Task 3.
- Produces: la vista `'calcolatore-clip'` in `navigate`, e `POST /api/calcolo-clip/salva` usata dal Task 6.

- [ ] **Step 1: La riga e il suo calcolo**

La riga vuota:

```javascript
function clipRigaVuota() {
  return {
    clip_nome: '', n_clip: 1, prezzo_confezione: '', pezzi: '', sconto_clip: '',
    profilo_mylav: '', n_mylav: 1, listino_lav: '', prezzo_scontato_lav: ''
  };
}
```

Il calcolo:

```javascript
// Il listino del fornitore da il prezzo della confezione: il costo di una
// singola analisi si ottiene dividendo per i pezzi. Senza pezzi non si inventa
// un numero, si lascia vuoto: un costo sbagliato di un fattore dodici in una
// trattativa e' peggio di un costo mancante.
function calcolaRigaClip(r) {
  const pezzi = parseFloat(r.pezzi) || 0;
  const prezzoConf = parseFloat(r.prezzo_confezione) || 0;
  const sconto = parseFloat(r.sconto_clip) || 0;
  const costoClip = pezzi > 0
    ? parseFloat((prezzoConf / pezzi * (1 - sconto / 100)).toFixed(2))
    : null;
  const nClip = parseFloat(r.n_clip) || 1;
  const totaleClip = costoClip == null ? null : costoClip * nClip;

  const nMyl = parseFloat(r.n_mylav) || 1;
  const listinoLav = parseFloat(r.listino_lav) || 0;
  const prezzoPiano = parseFloat(r.prezzo_scontato_lav) || 0;
  // Senza piano il veterinario paga il listino: usarlo evita un falso
  // risparmio positivo quando il piano non e' stato scelto.
  const totaleMylav = (prezzoPiano > 0 ? prezzoPiano : listinoLav) * nMyl;

  const risparmio = totaleClip == null ? null : totaleClip - totaleMylav;
  return { costoClip, totaleClip, totaleMylav, risparmio };
}
```

**Il segno del risparmio.** Qui `risparmio` positivo significa che **Mylav conviene**: la clip costa piu' del profilo Mylav. E' l'inverso del calcolatore esami, dove il positivo e' il risparmio rispetto al concorrente — ma il senso per chi legge e' lo stesso: positivo e blu significa «conviene Mylav». Scriverlo nel commento accanto al calcolo.

- [ ] **Step 2: Le colonne**

```javascript
const COLONNE_CLIP = [
  { col: 'struttura',         intestazione: 'comune.struttura',        tipo: 'testo',      larghezza: 130, gruppo: 'nessuno', elenco: 'roi-strutture-list' },
  { col: 'clip_nome',         intestazione: 'clip.tabella.clip',       tipo: 'testo',      larghezza: 200, gruppo: 'concorrenza', elenco: 'clip-list' },
  { col: 'n_clip',            intestazione: 'roi.tabella.n',           tipo: 'numero',     larghezza: 60,  gruppo: 'concorrenza' },
  { col: 'prezzo_confezione', intestazione: 'clip.tabella.prezzoConf', tipo: 'numero',     larghezza: 95,  gruppo: 'concorrenza', tenue: true },
  { col: 'pezzi',             intestazione: 'clip.tabella.pezzi',      tipo: 'numero',     larghezza: 60,  gruppo: 'concorrenza', tenue: true },
  { col: 'sconto_clip',       intestazione: 'roi.tabella.scontoPct',   tipo: 'numero',     larghezza: 65,  gruppo: 'concorrenza' },
  { col: 'costo_clip',        intestazione: 'clip.tabella.costoClip',  tipo: 'calcolato',  larghezza: 95,  gruppo: 'concorrenza' },
  { col: 'totale_clip',       intestazione: 'clip.tabella.totaleClip', tipo: 'calcolato',  larghezza: 95,  gruppo: 'concorrenza' },
  { col: 'profilo_mylav',     intestazione: 'clip.tabella.profilo',    tipo: 'testo',      larghezza: 180, gruppo: 'mylav', elenco: 'mylav-esami-list' },
  { col: 'n_mylav',           intestazione: 'roi.tabella.n',           tipo: 'numero',     larghezza: 60,  gruppo: 'mylav' },
  { col: 'listino_lav',       intestazione: 'roi.tabella.listinoMyl',  tipo: 'numero',     larghezza: 95,  gruppo: 'mylav' },
  { col: 'prezzo_scontato_lav', intestazione: 'roi.tabella.pianoMyl',  tipo: 'numero',     larghezza: 95,  gruppo: 'mylav' },
  { col: 'totale_mylav',      intestazione: 'clip.tabella.totaleMylav', tipo: 'calcolato', larghezza: 95,  gruppo: 'mylav' },
  { col: 'risparmio',         intestazione: 'comune.risparmio',        tipo: 'calcolato',  larghezza: 95,  gruppo: 'nessuno' }
];
```

Il campo `tenue: true` marca le tre colonne del conto — prezzo confezione, pezzi, costo clip — che vanno rese piu' chiare delle altre: sono il passaggio, non la decisione. L'occhio deve cadere su **costo clip** e **totale**.

- [ ] **Step 3: La cascata di riempimento**

Scrivendo il nome della clip, con i suggerimenti dal catalogo e la ricerca tollerante di `window.Ricerca`, si riempiono prezzo di confezione, pezzi e sconto abituale. Scrivendo il profilo Mylav parte la stessa cascata del calcolatore esami, piano compreso.

Valgono le due regole gia' in uso nel calcolatore esami, e vanno rispettate anche qui:
- un valore scritto dall'operatore non viene mai sovrascritto da un riempimento automatico;
- cambiando l'identita' di un lato, i valori che erano stati riempiti **da soli** per il lato precedente si azzerano, quelli scritti a mano restano.

- [ ] **Step 4: La sezione**

Nuova voce di menu **«Calcolatore clip»** e vista `'calcolatore-clip'` in `navigate`, con la stessa intestazione del calcolatore esami: selettore del piano, pulsanti «+ Aggiungi riga», «Rimuovi tutto», «Salva calcolo».

Il titolo dice cosa si sta decidendo, non come funziona lo strumento: «Conviene farlo in casa o mandarlo a Mylav?».

- [ ] **Step 5: Salvataggio**

`POST /api/calcolo-clip/salva` scrive in due tabelle nuove:

```sql
CREATE TABLE IF NOT EXISTS calcoli_clip (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  struttura_nome TEXT,
  nome_file TEXT,
  piano_id INTEGER,
  data DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS righe_calcolo_clip (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  calcolo_id INTEGER NOT NULL REFERENCES calcoli_clip(id),
  clip_nome TEXT, n_clip INTEGER,
  prezzo_confezione REAL, pezzi INTEGER, sconto_clip REAL,
  costo_clip REAL, totale_clip REAL,
  profilo_mylav TEXT, n_mylav INTEGER,
  listino_lav REAL, prezzo_scontato_lav REAL, totale_mylav REAL,
  risparmio REAL
);
```

I valori si salvano **come erano al momento del salvataggio**, non come riferimenti al catalogo: un listino che cambia domani non deve riscrivere una trattativa di ieri.

- [ ] **Step 6: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Riavviare il server e, con un account di prova e almeno una clip in catalogo: verificare che scrivendo la clip si riempiano prezzo, pezzi e costo; che il costo per clip sia `prezzo ÷ pezzi` applicato lo sconto; che svuotando i pezzi il costo resti vuoto invece di mostrare un numero; che le due quantita' siano indipendenti; che cambiando piano si aggiorni il lato Mylav; e che salvando compaia una riga in `calcoli_clip` coi valori giusti.

**Rimuovere l'account di prova alla fine.**

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/i18n.js public/style.css server.js
git commit -m "feat: calcolatore clip, fare in casa o mandare a Mylav"
```

---

### Task 6: Cronologia clip

**Files:**
- Modify: `public/app.js`, `server.js`, `public/i18n.js`

**Interfaces:**
- Consumes: `calcoli_clip` e `righe_calcolo_clip` dal Task 5.
- Produces: la vista `'cronologia-clip'`, e `GET /api/calcolo-clip`, `GET /api/calcolo-clip/:id`, `DELETE /api/calcolo-clip/:id`.

- [ ] **Step 1: Le rotte**

Tre rotte con `requireAuth`, tutte filtrate per `req.user.id`: l'elenco dei calcoli con struttura, data e numero di righe; il dettaglio con le sue righe; la cancellazione, che rimuove prima le righe e poi il calcolo, nella stessa transazione.

- [ ] **Step 2: La vista**

Voce di menu **«Cronologia clip»**, accanto a «Cronologia file». Elenco dei calcoli salvati con struttura, data, numero di righe e differenziale totale; un comando apre il calcolo nel calcolatore clip, un altro lo elimina previa conferma che dice cosa si perde.

I due tipi di calcolo non si mescolano mai: questa vista legge solo `calcoli_clip`, e Cronologia file resta com'e'.

- [ ] **Step 3: Riapertura**

Aprire un calcolo salvato riempie il calcolatore clip con le sue righe e seleziona il piano che era in uso. Se quel piano non esiste piu', il calcolo si apre senza piano e lo dice, invece di fallire.

- [ ] **Step 4: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Con un account di prova: salvare due calcoli, verificarli nell'elenco, riaprirne uno e controllare che i valori siano quelli salvati, eliminarne uno e verificare che spariscano anche le sue righe (`SELECT COUNT(*) FROM righe_calcolo_clip`). Verificare che Cronologia file non mostri i calcoli clip e viceversa.

**Rimuovere l'account di prova alla fine.**

- [ ] **Step 5: Commit**

```bash
git add public/app.js server.js public/i18n.js
git commit -m "feat: cronologia dei calcoli clip, separata da quella dei file"
```

---

### Task 7: Traduzioni e verifica end-to-end

**Files:**
- Modify: `public/i18n.js`, e correzioni dove la verifica le richiede.

- [ ] **Step 1: Censire le stringhe nuove**

```bash
grep -nE ">[A-ZÀ-Ú][^<>{}]{3,70}<|placeholder=\"[^\"]+\"|alert\('[^']+'|alert\(\`[^\`]+|confirm\(\`[^\`]+|confirm\('[^']+'" public/app.js public/importpdf.js
```

Ogni stringa visibile introdotta dai task 3-6 deve passare da `t()`, con la chiave in tutti e quattro i blocchi. Il censimento va nel report.

- [ ] **Step 2: Controllo di parita'**

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
  const m=it.filter(k=>!(k in D[l])), e=Object.keys(D[l]).filter(k=>!(k in D.it));
  if (m.length||e.length) { ko++; console.log('PARITA',l,m.join(','),e.join(',')); }
  for (const k of it) {
    const a=(D.it[k].match(/\{\w+\}/g)||[]).sort().join(','), b=((D[l][k]||'').match(/\{\w+\}/g)||[]).sort().join(',');
    if (a!==b && !k.endsWith('.uno')) { ko++; console.log('SEGNAPOSTO',k,l); }
  }
}
console.log(ko?ko+' problemi':'parita e segnaposto ok');
"
```

- [ ] **Step 3: Giro completo nelle quattro lingue**

Con un account di prova, in italiano, inglese, francese e spagnolo: Dashboard, Gestione piani, Gestione concorrenti, **Calcolatore clip**, **Cronologia clip**, Confronto strutture, Cronologia file, e la finestra di import fino alla revisione con la colonna delle clip. Cercare testo italiano residuo e avvisi «chiave mancante» in console.

Verificare anche che il menu non abbia piu' Macchinari ne' Confronto macchine in nessuna delle quattro lingue.

- [ ] **Step 4: Prova sui dati veri**

Il metro finale e' il listino reale. Importare un listino concorrente che contenga le clip, confermare le righe riconosciute, e costruire nel calcolatore un confronto completo: `Catalyst™ Chem 17 CLIP` a 448,50 su 12 pezzi deve dare **37,38** di costo per clip. Se quel numero non viene, qualcosa nella catena e' sbagliato.

- [ ] **Step 5: Suite completa e stato del database**

```bash
npm test
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const t of ['users','concorrenti','clip','calcoli_clip','righe_calcolo_clip']) {
  console.log(t, db.prepare('SELECT COUNT(*) c FROM '+t).get().c);
}
console.log('orfani piani:', db.prepare('SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)').get().c);
db.close();"
```

Attese: 11 utenti, 1 concorrente, 0 orfani, e le tabelle clip vuote dopo la pulizia degli account di prova.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: traduzioni del calcolatore clip e verifica nelle quattro lingue"
```

---

## Self-review

**Copertura dello spec:**

| Requisito | Task |
|---|---|
| Rimozione sezioni, tabelle, ramo import macchine | 1 |
| `pdfclassifica` resta intatto | 1 (dichiarato) |
| Motore comune, calcolatore esami invariato | 2 |
| Catalogo clip unico per account | 3 |
| Prezzo per confezione diviso per i pezzi | 3 (test), 5 (calcolo) |
| Pezzi letti dal nome e modificabili | 3, 5 |
| Import PDF dedicato | 3 (rotte), 5 (sezione) |
| Riconoscimento nella revisione, con conferma | 4 |
| Le clip restano nel listino del concorrente | 4 |
| Riga gemella, ogni campo a mano | 5 |
| Lato Mylav col piano di scontistica | 5 |
| Colonne del conto piu' tenui | 5 |
| Cronologia separata con voce propria | 6 |
| Valori salvati com'erano, non riferimenti | 5, 6 |
| Quattro lingue | 3-6 per le chiavi, 7 per la verifica |

**Punti annotati durante la stesura:**

- Il Task 2 non aggiunge funzioni: sposta e basta. E' il task piu' rischioso del piano, perche' tocca lo strumento che il committente usa davanti ai clienti, e per questo ha una fotografia del comportamento prima e dopo. Se un difetto emerge durante lo spostamento, va annotato e corretto in un commit separato: un'estrazione mescolata a una correzione rende impossibile capire quale delle due ha rotto qualcosa.
- Il riconoscimento delle clip richiede **due** segni insieme, il nome di prodotto e i pezzi in coda. Il solo numero non basta: nel listino reale 127 voci su 517 ne hanno uno, e quasi tutte sono esami. Il Task 3 lo prova sui dati veri prima che qualcuno ci costruisca sopra.
- Il segno del risparmio e' invertito rispetto al calcolatore esami, e il Task 5 lo dice esplicitamente perche' e' il tipo di dettaglio che si scopre tardi e male.
- La rimozione delle due tabelle rifiuta di girare se contengono righe. Oggi sono vuote, ma un `DROP` incondizionato in un progetto con dati di un cliente reale non e' una cosa che si scrive.
