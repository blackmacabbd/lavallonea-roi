# I listini si leggono e si eliminano per PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni riga importata ricorda da quale PDF viene, le due sezioni dei
macchinari si leggono per PDF, un PDF si elimina in blocco, e i due calcolatori
lasciano scegliere il listino Mylav da usare.

**Architecture:** Una colonna `file_origine` su `clip` e su `analizzatori_mylav`,
aggiunta con `addColIfMissing` (additiva, mai distruttiva), valorizzata al
momento della conferma dell'import. Da quella colonna discende tutto il resto:
il raggruppamento nelle sezioni, l'eliminazione in blocco e il filtro dei
suggerimenti nei calcolatori. `analizzatori_mylav` guadagna i campi della clip
(`pezzi`, `sconto`) accanto a quelli che gia' ha.

**Tech Stack:** Node/Express, `node:sqlite`, JS vanilla senza build, `node:test`.

## Global Constraints

- Nessuna dipendenza nuova.
- `npm test` verde a ogni fetta; oggi **228 test**.
- **Nessuna migrazione distruttiva.** Il database contiene i dati di un account
  cliente reale, e le 2560 righe importate dal committente il 21/09 restano
  dove sono finche' non e' lui a eliminarle.
- **I due calcolatori restano identici nel comportamento** per tutto cio' che
  non viene aggiunto qui. Condividono `public/calcolatore.js`.
- In italiano l'interfaccia resta identica a oggi per tutto cio' che non viene
  aggiunto apposta.
- I dati dell'operatore non si traducono e non si alterano mai.
- Ogni chiave di traduzione in tutte e quattro le lingue (it, en, fr, es), oggi
  500 per lingua, con gli stessi segnaposto.
- Ogni lettura e ogni scrittura filtrano per `user_id`.
- Un valore dentro un `onclick` passa per DUE parser: si usa `jsAttr()`.
- Nessun push senza richiesta esplicita.

## Decisioni gia' prese, da non rimettere in discussione

- **Le clip Mylav stanno in `analizzatori_mylav`**, non nella tabella `clip`.
  Mescolare i due lati in una tabella sola metterebbe a rischio il percorso
  delle clip concorrenti, gia' verificato e in funzione, senza alcun guadagno.
  Il nome della tabella resta per non rompere niente.
- **`noleggio` e `note` restano.** Il committente non ha chiesto di toglierli,
  1280 righe li portano, e togliere una colonna e' distruttivo.
- **`prezzo` in `analizzatori_mylav` e' il prezzo della confezione.** E' gia'
  cio' che l'import ci scrive: si riusa, non si aggiunge una colonna gemella.
- **Le righe gia' in archivio hanno `file_origine` nullo** e si raccolgono sotto
  un gruppo dedicato, eliminabile come gli altri. Non si indovina la
  provenienza a posteriori: il registro degli import la suggerirebbe, ma
  attribuire d'ufficio 2560 righe a un file sulla base di un orario e' esattamente
  il genere di scorciatoia che questo progetto ha gia' pagato.
- **Eliminare un PDF porta via tutte le sue righe**, comprese quelle corrette a
  mano dopo l'import: sono righe di quel listino. La conferma le conta prima.

---

### Task 1: Ogni riga ricorda il suo PDF

**Files:**
- Modify: `lib/clip.js`, `lib/clip.test.js`, `lib/analizzatori.js`, `lib/analizzatori.test.js`, `server.js`

**Interfaces:**
- `clip` e `analizzatori_mylav` guadagnano `file_origine TEXT`.
- `upsertClip` e `upsertAnalizzatore` accettano `fileOrigine` e lo salvano.
- `listaClip` e `listaAnalizzatori` restituiscono `fileOrigine` su ogni riga.
- Nuove: `gruppiClip(db, userId)` e `gruppiAnalizzatori(db, userId)` →
  `[{ fileOrigine, n, dataUltimo }]`, ordinati per data decrescente, con
  `fileOrigine: null` per le righe senza provenienza.

- [ ] **Step 1: Scrivere i test**

In `lib/clip.test.js`:

```javascript
test('upsertClip salva il file di provenienza e lo rilegge', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.50, pezzi: 12, sconto: null, fonte: 'pdf',
    fileOrigine: 'listino-A.pdf' });
  assert.equal(listaClip(db, 1)[0].fileOrigine, 'listino-A.pdf');
  db.close();
});

// Le righe entrate prima che si tenesse traccia del file non spariscono e non
// vengono attribuite a nessun PDF: restano in un gruppo loro.
test('gruppiClip raccoglie le righe senza provenienza sotto null', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Vecchia',
    prezzoConfezione: 10, pezzi: 1, sconto: null, fonte: 'pdf' });
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Nuova',
    prezzoConfezione: 20, pezzi: 2, sconto: null, fonte: 'pdf',
    fileOrigine: 'listino-A.pdf' });
  const g = gruppiClip(db, 1);
  assert.equal(g.length, 2);
  const senza = g.find(x => x.fileOrigine == null);
  assert.ok(senza, 'il gruppo senza provenienza esiste');
  assert.equal(senza.n, 1);
  assert.equal(g.find(x => x.fileOrigine === 'listino-A.pdf').n, 1);
  db.close();
});

test('i gruppi sono isolati per account', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'x.pdf' });
  upsertClip(db, { userId: 2, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'y.pdf' });
  assert.equal(gruppiClip(db, 1).length, 1);
  assert.equal(gruppiClip(db, 1)[0].fileOrigine, 'x.pdf');
  db.close();
});
```

In `lib/analizzatori.test.js`, gli stessi tre con `upsertAnalizzatore`,
`listaAnalizzatori` e `gruppiAnalizzatori`.

E il test che protegge il lavoro a mano, perche' senza di esso il difetto
trovato dalla revisione finale tornerebbe:

```javascript
// Il canone e le note non arrivano dal PDF: l'interfaccia dice di scriverli a
// mano. Un secondo import NON deve azzerarli.
test('reimportare non cancella il canone e le note scritti a mano', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000,
    fileOrigine: 'mylav.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', noleggio: 250,
    note: 'consegna in due settimane' });
  // Il PDF nuovo porta solo nome e prezzo, come fa l'import vero.
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500,
    fileOrigine: 'mylav-2027.pdf' });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.prezzo, 11500, 'il prezzo si aggiorna');
  assert.equal(r.noleggio, 250, 'il canone scritto a mano resta');
  assert.equal(r.note, 'consegna in due settimane', 'le note restano');
  db.close();
});
```

Lo stesso per le clip: un reimport non azzera `pezzi` e `sconto` completati a
mano quando il PDF non li porta.

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/clip.test.js lib/analizzatori.test.js`
Expected: FAIL — `fileOrigine` non esiste, `gruppiClip` non e' una funzione, e
il reimport azzera canone e note.

- [ ] **Step 3: Le colonne**

In `server.js`, accanto agli altri `addColIfMissing`:

```javascript
addColIfMissing('clip', 'file_origine', 'TEXT');
addColIfMissing('analizzatori_mylav', 'file_origine', 'TEXT');
addColIfMissing('analizzatori_mylav', 'pezzi', 'INTEGER');
addColIfMissing('analizzatori_mylav', 'sconto', 'REAL');
```

Additive: le righe esistenti restano con le colonne nuove a `null`, che e'
esattamente cio' che significano.

- [ ] **Step 4: L'aggiornamento parziale**

Il `DO UPDATE SET` deve smettere di scrivere `null` sui campi che chi chiama non
ha passato. La forma:

```sql
ON CONFLICT(user_id, nome) DO UPDATE SET
  prezzo   = COALESCE(excluded.prezzo, prezzo),
  noleggio = COALESCE(excluded.noleggio, noleggio),
  note     = COALESCE(excluded.note, note),
  ...
```

`COALESCE` tiene il valore vecchio quando il nuovo e' nullo. Significa che da
qui **non si puo' piu' svuotare un campo passando null**: lo svuotamento resta
possibile dalla rotta `PUT` dedicata, che sa distinguere «campo assente» da
«campo presente e vuoto». Scriverlo nel commento, perche' e' la differenza che
rende il comportamento corretto invece che sorprendente.

`file_origine`, invece, si sovrascrive sempre: l'ultimo PDF che ha portato quella
riga e' quello a cui appartiene adesso.

- [ ] **Step 5: I gruppi**

```sql
SELECT file_origine AS fileOrigine, COUNT(*) AS n, MAX(data_import) AS dataUltimo
FROM clip WHERE user_id = ?
GROUP BY file_origine
ORDER BY dataUltimo DESC
```

In SQLite `GROUP BY` mette tutti i `NULL` in un gruppo solo, che e' quello che
serve qui (al contrario di `UNIQUE`, dove invece sono distinti — la differenza
ha gia' morso questo progetto).

- [ ] **Step 6: L'import valorizza la colonna**

In `server.js`, nei rami `'clip'` e `'analizzatore'` della conferma, passare il
nome del file della bozza a `upsertClip` / `upsertAnalizzatore`. Il nome sta
gia' sulla bozza: e' quello che il registro degli import scrive in `nome_file`.

- [ ] **Step 7: Verificare**

```bash
node --check server.js && npm test
```

Riavviare il server e controllare che le colonne ci siano e che nulla si sia
perso:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const t of ['clip','analizzatori_mylav']) {
  console.log(t, db.prepare('SELECT COUNT(*) c FROM '+t).get().c,
    '| senza provenienza:', db.prepare('SELECT COUNT(*) c FROM '+t+' WHERE file_origine IS NULL').get().c);
}
db.close();"
```

Attese: 1280 e 1280, tutte senza provenienza. **Nessuna riga persa.**

- [ ] **Step 8: Commit**

```bash
git add lib/ server.js
git commit -m "feat: ogni riga importata ricorda da quale PDF viene"
```

---

### Task 2: Gestione macchinari interni si legge per PDF

**Files:**
- Modify: `server.js`, `public/app.js`, `public/i18n.js`

**Interfaces:**
- `GET /api/analizzatori/gruppi` → l'elenco dei PDF.
- `GET /api/analizzatori?fileOrigine=...` → le righe di un PDF; il valore
  speciale che indica «senza provenienza» va scelto e documentato, perche' una
  stringa vuota in una query non si distingue da un parametro assente.

- [ ] **Step 1: La schermata a due livelli**

La sezione diventa come Gestione macchinari esterni: **l'elenco dei PDF**, con
nome, numero di righe e data, e cliccandone uno si aprono le sue righe.

Le righe sono clip a tutti gli effetti, come dal lato esterno: nome, prezzo
della confezione, pezzi, sconto, e il costo per clip calcolato. Accanto restano
**canone di noleggio** e **note**, facoltativi, che dal PDF non arrivano e si
scrivono a mano.

Il gruppo senza provenienza porta l'etichetta `analizzatori.senzaFile`, da
tradurre nelle quattro lingue: «Importate prima che si tenesse traccia del
file».

Il costo per clip si mostra vuoto quando i pezzi mancano, **non zero**: e' la
stessa regola gia' in vigore per il canone. Sulle 1280 righe in archivio i pezzi
mancano quasi sempre, quindi questa colonna sara' vuota quasi ovunque — ed e'
l'informazione giusta, non un difetto.

- [ ] **Step 2: La ricerca**

La barra di ricerca resta e cerca **dentro il PDF aperto**, con
`Ricerca.corrisponde`. Al primo livello cerca fra i nomi dei PDF.

- [ ] **Step 3: Verificare**

```bash
node --check server.js && node --check public/app.js && npm test
```

Riavviare, aprire la sezione: deve mostrare **un gruppo solo**, quello senza
provenienza, con 1280 righe. Aprirlo, cercare una riga, modificarne una a mano
e verificare che il valore resti dopo aver riaperto.

- [ ] **Step 4: Commit**

```bash
git add server.js public/
git commit -m "feat: i macchinari interni si leggono per PDF, come gli esterni"
```

---

### Task 3: Eliminare una riga e eliminare un PDF

**Files:**
- Modify: `lib/clip.js`, `lib/clip.test.js`, `lib/analizzatori.js`, `lib/analizzatori.test.js`, `server.js`, `public/app.js`, `public/i18n.js`

**Interfaces:**
- `eliminaGruppoClip(db, fileOrigine, userId)` → `{ eliminate }`
- `eliminaGruppoAnalizzatori(db, fileOrigine, userId)` → `{ eliminate }`
- `DELETE /api/clip/gruppo` e `DELETE /api/analizzatori/gruppo`, col file nel
  corpo della richiesta e non nell'indirizzo: un nome di file contiene punti,
  spazi e barre, e infilarlo in un percorso e' un invito agli sbagli.

- [ ] **Step 1: Scrivere i test**

```javascript
test('eliminaGruppoClip toglie solo le righe di quel PDF', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'due.pdf' });
  const r = eliminaGruppoClip(db, 'uno.pdf', 1);
  assert.equal(r.eliminate, 1);
  assert.deepEqual(listaClip(db, 1).map(c => c.nome), ['B']);
  db.close();
});

// Il gruppo senza provenienza si elimina come gli altri: e' l'unica via per
// ripulire cio' che e' entrato prima che si tenesse traccia del file.
test('eliminaGruppoClip sa eliminare il gruppo senza provenienza', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf' });
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'due.pdf' });
  assert.equal(eliminaGruppoClip(db, null, 1).eliminate, 1);
  assert.deepEqual(listaClip(db, 1).map(c => c.nome), ['B']);
  db.close();
});

test('eliminaGruppoClip non tocca gli altri account', () => {
  const db = dbProva();
  upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  upsertClip(db, { userId: 2, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  assert.equal(eliminaGruppoClip(db, 'uno.pdf', 1).eliminate, 1);
  assert.equal(listaClip(db, 2).length, 1, 'l\'altro account non si tocca');
  db.close();
});
```

Gli stessi tre per gli analizzatori.

Attenzione a `WHERE file_origine = ?` con `null`: **in SQL `= NULL` non e' mai
vero**, quindi il gruppo senza provenienza va cercato con `IS NULL`. Un solo
`WHERE` che valga per entrambi i casi:

```sql
WHERE user_id = ? AND (file_origine = ? OR (? IS NULL AND file_origine IS NULL))
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/clip.test.js lib/analizzatori.test.js`
Expected: FAIL, le funzioni non esistono.

- [ ] **Step 3: Implementare**

Le funzioni, poi le due rotte con `requireAuth`, che restituiscono il numero di
righe eliminate.

- [ ] **Step 4: I comandi nell'interfaccia**

In **tutt'e due** le sezioni dei macchinari:
- su ogni riga, l'eliminazione della singola clip (dal lato esterno c'e' gia':
  riusarla, non riscriverla);
- su ogni PDF dell'elenco, **«Elimina questo listino»**, con una conferma che
  **dice quante righe se ne vanno**: «Eliminare "listino-A.pdf"? Se ne vanno
  tutte le sue righe (1280). L'operazione non e' reversibile.»

Il numero nella conferma non e' un dettaglio: e' l'unica cosa che distingue
l'eliminazione di tre righe da quella di milleduecentottanta.

Il nome del file finisce dentro un `onclick`: `jsAttr()`, non `escHtml`.

- [ ] **Step 5: Verificare**

```bash
node --check server.js && node --check public/app.js && npm test
```

Riavviare. Con un account usa e getta: importare due listini, eliminare il
primo, verificare che il secondo resti intero. Poi eliminare il gruppo senza
provenienza e verificare che sparisca solo quello.

**Non eliminare le righe del committente.** Sono sue e la sezione ora gli da'
il comando per farlo quando vuole.

- [ ] **Step 6: Commit**

```bash
git add lib/ server.js public/
git commit -m "feat: si elimina una clip, e si elimina un intero listino"
```

---

### Task 4: Il listino Mylav si sceglie nei due calcolatori

**Files:**
- Modify: `public/app.js`, `public/i18n.js`, `server.js`

- [ ] **Step 1: Il calcolatore macchinari**

Una colonna **Listino Mylav** nel gruppo blu, davanti a `profilo_mylav`, a
specchio della colonna «Laboratorio conc.» del gruppo rosso. Testo libero con i
suggerimenti dei PDF disponibili, ricerca tollerante.

Scritto un PDF, i suggerimenti del lato Mylav pescano **solo da quel listino**.
Senza PDF scritto, il campo lo chiede invece di proporre tutto.

**Lo stato del filtro va tenuto per riga, non per tabella.** E' la stessa regola
della colonna del laboratorio, e per la stessa ragione: due righe possono
confrontare due listini nello stesso calcolo, e una variabile unica darebbe alla
seconda i valori della prima senza che si veda.

La colonna persiste per riga in `righe_calcolo_clip` (`addColIfMissing`), come
`laboratorio`. **Non** come `struttura`, che e' una sola per calcolo.

- [ ] **Step 2: Il calcolatore esami**

La stessa colonna nel gruppo blu, dove il lato Mylav e' il listino dei prezzi
base. Scritto un PDF, i prezzi di listino si prendono da quello.

`public/calcolatore.js` e' condiviso dai due calcolatori: **cio' che si tocca la'
cambia entrambi**. Se una modifica al motore serve, va verificato a mano che il
comportamento dell'altro calcolatore non cambi, e detto nel rapporto.

- [ ] **Step 3: Verificare**

```bash
node --check public/app.js && node --check server.js && npm test
```

Con due listini Mylav diversi contenenti una riga omonima a prezzo diverso: due
righe nello stesso calcolo, ciascuna col suo listino, devono riempirsi coi
propri valori. Poi salvare, riaprire dalla cronologia e verificare che il
listino scelto resti su ogni riga.

Rifare il giro del calcolatore esami e verificare che, senza scrivere niente
nella colonna nuova, si comporti **esattamente come prima**.

- [ ] **Step 4: Commit**

```bash
git add public/ server.js
git commit -m "feat: si sceglie il listino Mylav da usare, in tutti e due i calcolatori"
```

---

## Self-review

| Richiesta del committente | Fetta |
|---|---|
| Macchinari interni ordinati come esami interni, per PDF | 2 |
| Cliccando un PDF si vedono le clip | 2 |
| Le righe interne sono clip come le esterne | 1 (colonne), 2 (schermata) |
| Colonna per scegliere il PDF dal lato Mylav, calcolatore macchinari | 4 |
| Colonna per scegliere il PDF dal lato Mylav, calcolatore esami | 4 |
| Eliminare le clip, esterni e interni | 3 |
| Eliminare i PDF, esterni e interni | 3 |

**Punti annotati durante la stesura:**

- `= NULL` non e' mai vero in SQL: il gruppo senza provenienza si cerca con
  `IS NULL`. Un `WHERE` scritto senza pensarci eliminerebbe zero righe e
  direbbe che e' andato tutto bene — il peggiore dei silenzi.
- `GROUP BY` raccoglie i NULL insieme, `UNIQUE` li tiene distinti. Le due cose
  sembrano in contraddizione e non lo sono; qui servono entrambe, ciascuna dove
  sta.
- `COALESCE` nel `DO UPDATE` chiude il difetto per cui un reimport azzerava
  canone, note, pezzi e sconto scritti a mano. In cambio toglie all'upsert la
  capacita' di svuotare un campo: lo svuotamento resta alla rotta `PUT`, che sa
  distinguere un campo assente da un campo vuoto. Va scritto nel commento,
  altrimenti il prossimo lo scopre da un difetto.
- Il filtro per riga nel calcolatore e' la stessa trappola gia' evitata con la
  colonna del laboratorio. Ripetuta qui perche' chi implementa la fetta 4 non
  ha visto la fetta 6 del blocco precedente.
- Il numero di righe nella conferma di eliminazione e' la sola cosa che
  distingue tre righe da milleduecentottanta.
