# Macchinari (analizzatori) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separare automaticamente gli analizzatori dagli esami nei listini PDF, raccoglierli in una sezione propria e confrontare le macchine proprie con quelle del concorrente.

**Architecture:** Il classificatore PDF guadagna il riconoscimento delle intestazioni di sezione e marca ogni riga con `tipo: 'esame' | 'macchina'`. Una nuova tabella `macchine` affianca `concorrenti` con lo stesso schema di isolamento per account. La conferma dell'import smista i due gruppi in due destinazioni diverse in un solo passaggio. La sezione Macchinari ospita catalogo e calcolatore di confronto.

**Tech Stack:** Node/Express, `node:sqlite` (`DatabaseSync`), JS vanilla senza build, test con `node:test` (`npm test` = `node --test lib/*.test.js`).

## Global Constraints

- Nessuna dipendenza nuova.
- `npm test` deve restare verde alla fine di ogni task.
- Nessuna regressione sui listini di soli esami: senza intestazioni riconoscibili tutte le righe restano `tipo: 'esame'` e il comportamento e' identico a oggi.
- Ogni lettura e scrittura sui dati e' vincolata a `user_id`: le macchine di un account non sono leggibili ne' modificabili da un altro.
- UI in italiano. Palette e componenti gia' in uso: `--ink #26262a`, `--blue #0f76bc`, `--red #ce181e`, classi `.table-card`, `.btn-outline`, `.btn-primary`, `.roi-input`, `.page-header`, `.page-actions`.
- Testo del disclaimer, verbatim: «Carica qui solo listini di analizzatori. I listini di esami vanno in Gestione piani o Gestione concorrenti.»
- Nessun push senza autorizzazione esplicita dell'utente.
- Gli account di prova creati durante le verifiche vanno rimossi al termine di ogni task.

---

## File Structure

| File | Responsabilita' | Task |
|---|---|---|
| `lib/pdfclassifica.js` | riconoscimento sezioni, campo `tipo`, tetto prezzo per tipo | 1 |
| `lib/pdfclassifica.test.js` | test del riconoscimento | 1 |
| `scripts/genera-fixture-pdf.js` | fixture con entrambe le sezioni | 1 |
| `lib/fixtures/listino-misto-macchine.pdf` | fixture generata | 1 |
| `lib/macchine.js` | schema e repository macchine | 2 |
| `lib/macchine.test.js` | test isolamento e CRUD | 2 |
| `lib/importbozze.js` | `tipo` conservato in `normalizzaRighe`, entita `macchina` | 3 |
| `server.js` | boot schema, conferma a doppia destinazione, rotte macchine | 3 |
| `public/importpdf.js` | revisione a due gruppi | 4 |
| `public/app.js` | sezione Macchinari, calcolatore | 5, 6 |
| `public/style.css` | stili sezione e calcolatore | 5, 6 |

---

### Task 1: Riconoscimento delle sezioni e tipo di riga

**Files:**
- Modify: `lib/pdfclassifica.js`
- Modify: `lib/pdfclassifica.test.js`
- Modify: `scripts/genera-fixture-pdf.js`
- Create: `lib/fixtures/listino-misto-macchine.pdf` (generata dallo script)

**Interfaces:**
- Consumes: `classificaRighe(input)` esistente, che oggi restituisce `{righe, totaliTabellari, classificate, alta, incerte, scartate, confidenzaComplessiva, nomiRipuliti}`. Ogni riga ha gia' `{pagina, testo, x, y, w, h, nome, prezzo, confidenza, tabellare, scartata, motivo, nImporti, indice}`.
- Produces: ogni riga guadagna `tipo: 'esame' | 'macchina'`. Il risultato guadagna `esami: number` e `macchine: number` (conteggi delle righe non scartate per tipo). Task 3 e 4 dipendono da questi nomi.

**Contesto:** un listino di analizzatori ha prezzi di migliaia di euro. La costante esistente `PREZZO_MAX = 2000` marca come «prezzo fuori scala» qualunque riga oltre quella soglia: senza un tetto distinto per le macchine, ogni riga del nuovo modulo nascerebbe segnalata «da rivedere», ripetendo il problema che abbiamo appena risolto sulla colonna dei tempi.

- [ ] **Step 1: Scrivere i test del riconoscimento**

In `lib/pdfclassifica.test.js`, aggiungere prima di `test('conserva coordinate e pagina, aggiunge indice progressivo'`:

```javascript
// Le macchine stanno in capitoli propri, introdotti da un titolo: e' il
// segnale piu' affidabile, perche' una parola come "noleggio" puo' comparire
// in un nome esame mentre una intestazione di sezione no.
test('intestazione di sezione: le righe sotto diventano macchine', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',
    'ANALIZZATORI',
    'Analizzatore biochimico da banco 8.500,00',
    'Ematologico veterinario 11.200,00'
  );
  assert.deepStrictEqual(res.righe.map(r => r.tipo), ['esame', 'macchina', 'macchina', 'macchina']);
  assert.strictEqual(res.esami, 1);
  assert.strictEqual(res.macchine, 2);
});

test('una intestazione esami chiude la sezione macchine', () => {
  const res = cls(
    'STRUMENTAZIONE',
    'Analizzatore biochimico 8.500,00',
    'ESAMI DI LABORATORIO',
    'EMOCROMO COMPLETO 18,50'
  );
  const perTipo = res.righe.filter(r => !r.scartata).map(r => [r.nome, r.tipo]);
  assert.deepStrictEqual(perTipo, [
    ['Analizzatore biochimico', 'macchina'],
    ['EMOCROMO COMPLETO', 'esame']
  ]);
});

// Garanzia di non regressione: i listini che oggi funzionano non cambiano.
test('senza intestazioni riconoscibili tutto resta esame', () => {
  const res = cls('EMOCROMO COMPLETO 18,50', 'T4 TOTALE 22,90', 'LEISHMANIA IFI 31,50');
  assert.ok(res.righe.every(r => r.tipo === 'esame'));
  assert.strictEqual(res.macchine, 0);
  assert.strictEqual(res.esami, 3);
});

// Una nota in prosa non e' un titolo: lunga e con il punto finale.
test('una nota lunga non viene scambiata per intestazione di sezione', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',
    'Gli analizzatori indicati in questo listino sono disponibili anche a noleggio previo accordo commerciale.',
    'T4 TOTALE 22,90'
  );
  assert.ok(res.righe.every(r => r.tipo === 'esame'), 'la nota non deve aprire una sezione macchine');
});

// Un analizzatore costa migliaia di euro: il tetto pensato per gli esami lo
// segnalerebbe sempre come fuori scala.
test('il prezzo di una macchina non e fuori scala', () => {
  const res = cls('ANALIZZATORI', 'Analizzatore biochimico da banco 8.500,00');
  const macchina = res.righe.find(r => r.tipo === 'macchina' && !r.scartata);
  assert.strictEqual(macchina.prezzo, 8500);
  assert.strictEqual(macchina.confidenza, 'alta');
  assert.strictEqual(macchina.motivo, null);
});

test('un esame da ottomila euro resta segnalato', () => {
  const r = unica('PROFILO STRANO 8.500,00');
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /fuori scala/i);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `npm test`
Expected: FAIL — i test nuovi falliscono perche' `r.tipo` e' `undefined` e `res.esami` / `res.macchine` non esistono.

- [ ] **Step 3: Aggiungere le costanti del riconoscimento**

In `lib/pdfclassifica.js`, dopo la costante `MIN_RIGHE_COLONNA` (riga 58 circa), inserire:

```javascript
// Intestazioni di sezione. Il riconoscimento delle macchine si basa su queste,
// non sulle parole dentro il nome della riga: "noleggio" puo' comparire in un
// nome esame, un capitolo intitolato "ANALIZZATORI" no.
const SEZIONE_MAX_CARATTERI = 60;
const SEZIONE_MACCHINE =
  /^(analizzator|strument|apparecchiatur|macchin|noleggi|comodato|diagnostica strumentale)/i;
const SEZIONE_ESAMI =
  /^(esam|analisi|profil|biochimic|ematolog|sierolog|microbiolog|citolog|istolog|listino prezzi)/i;

// Un analizzatore costa migliaia di euro: il tetto degli esami lo segnalerebbe
// sempre come fuori scala, rendendo inutile la segnalazione.
const PREZZO_MAX_MACCHINA = 200000;
```

- [ ] **Step 4: Rendere il tetto del prezzo dipendente dal tipo**

In `lib/pdfclassifica.js`, sostituire la funzione `motivoDubbio` (riga 124 circa):

```javascript
// Perche' una riga con prezzo resta dubbia. null = nessun dubbio.
function motivoDubbio(nome, prezzo, nImporti, tipo) {
  const tetto = tipo === 'macchina' ? PREZZO_MAX_MACCHINA : PREZZO_MAX;
  if (!(prezzo > 0)) return `prezzo non plausibile (${prezzo}): da verificare`;
  if (prezzo > tetto) return `prezzo fuori scala (${prezzo}): da verificare`;
  if (nImporti > MAX_IMPORTI) {
    return `${nImporti} importi sulla riga: scelto il primo, da verificare`;
  }
  if (TEMPI_NEL_NOME.test(nome)) {
    return 'nel nome sembra esserci una colonna del listino (tempi): da ripulire';
  }
  if (nome.length > NOME_MAX) return 'nome molto lungo: forse un paragrafo, non un esame';
  if (!nome.includes(' ') && nome.length <= SIGLA_MAX) return 'sigla isolata: nome dubbio';
  return null;
}
```

- [ ] **Step 5: Aggiungere assegnazione del tipo e rivalutazione delle macchine**

In `lib/pdfclassifica.js`, subito prima di `function classificaRighe(input)` (riga 232 circa), inserire:

```javascript
// Riconosce una intestazione di sezione. Solo righe senza importo, corte e
// senza punto finale: i due limiti escludono le note in prosa, che nei listini
// sono lunghe e terminano con un punto.
function tipoIntestazione(riga) {
  if (riga.tabellare) return null;
  const t = String(riga.testo || '').trim();
  if (!t || t.length > SEZIONE_MAX_CARATTERI || /\.$/.test(t)) return null;
  if (SEZIONE_MACCHINE.test(t)) return 'macchina';
  if (SEZIONE_ESAMI.test(t)) return 'esame';
  return null;
}

/**
 * Marca ogni riga col tipo della sezione aperta sopra di essa.
 * Il valore di partenza e' 'esame': un documento senza intestazioni
 * riconoscibili si comporta esattamente come prima di questa funzione.
 */
function assegnaTipo(righe) {
  let corrente = 'esame';
  return righe.map(r => {
    const sezione = tipoIntestazione(r);
    if (sezione) corrente = sezione;
    return { ...r, tipo: corrente };
  });
}

// Il dubbio sul prezzo era stato calcolato col tetto degli esami, prima di
// sapere in che sezione si trovasse la riga: per le macchine va rifatto.
function rivalutaMacchine(righe) {
  return righe.map(r => {
    if (r.scartata || r.tipo !== 'macchina' || !r.nome) return r;
    const dubbio = motivoDubbio(r.nome, r.prezzo, r.nImporti || 1, 'macchina');
    return { ...r, confidenza: dubbio ? 'incerta' : 'alta', motivo: dubbio };
  });
}
```

- [ ] **Step 6: Collegare le due funzioni e aggiungere i conteggi**

In `lib/pdfclassifica.js`, sostituire il corpo di `classificaRighe`:

```javascript
function classificaRighe(input) {
  const grezze = Array.isArray(input) ? input : (input && input.righe) || [];
  const primaPassata = grezze.map((g, i) => ({ ...classificaRiga(g), indice: i }));
  const { righe: senzaTempi, ripuliti } = togliColonnaTempi(primaPassata);
  const righe = rivalutaMacchine(assegnaTipo(senzaTempi));

  const totaliTabellari = righe.filter(r => r.tabellare).length;
  const alta = righe.filter(r => !r.scartata && r.confidenza === 'alta').length;
  const incerte = righe.filter(r => !r.scartata && r.confidenza === 'incerta').length;
  const classificate = alta + incerte;
  const scartate = righe.filter(r => r.scartata).length;
  const esami = righe.filter(r => !r.scartata && r.tipo === 'esame').length;
  const macchine = righe.filter(r => !r.scartata && r.tipo === 'macchina').length;
  const confidenzaComplessiva = totaliTabellari
    ? Math.round(((alta + 0.5 * incerte) / totaliTabellari) * 100) / 100
    : 0;

  return {
    righe, totaliTabellari, classificate, alta, incerte, scartate,
    esami, macchine,
    confidenzaComplessiva,
    nomiRipuliti: ripuliti // nomi a cui e' stata tolta la colonna dei tempi
  };
}
```

Nel modulo, aggiornare anche la chiamata dentro `classificaRiga` (riga 178 circa) e quella dentro `togliColonnaTempi` (riga 210 circa), che ora devono passare il tipo:

In `classificaRiga`, sostituire:
```javascript
  const dubbio = motivoDubbio(nome, primo.valore, importi.length);
```
con:
```javascript
  // Il tipo non e' ancora noto qui: si valuta come esame e, per le righe che
  // risulteranno macchine, si rivaluta dopo l'assegnazione della sezione.
  const dubbio = motivoDubbio(nome, primo.valore, importi.length, 'esame');
```

In `togliColonnaTempi`, sostituire:
```javascript
    const dubbio = motivoDubbio(nome, r.prezzo, r.nImporti || 1);
```
con:
```javascript
    const dubbio = motivoDubbio(nome, r.prezzo, r.nImporti || 1, r.tipo || 'esame');
```

- [ ] **Step 7: Eseguire i test**

Run: `npm test`
Expected: PASS, tutti i test verdi (i 160 esistenti piu' i 6 nuovi).

- [ ] **Step 8: Aggiungere la fixture con entrambe le sezioni**

In `scripts/genera-fixture-pdf.js`, prima della costante `SCANSIONE_HTML`, inserire:

```javascript
// Listino misto esami + analizzatori, con capitoli separati: e' il caso che il
// riconoscimento a sezioni deve saper suddividere.
const MISTO_MACCHINE_HTML = `
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #26262a; }
  h2 { font-size: 12pt; margin: 6mm 0 3mm; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.5mm 0; }
  td.n { text-align: right; }
  .salto { page-break-before: always; }
</style></head><body>
  <h2>ESAMI DI LABORATORIO</h2>
  <table>
    <tr><td>EMOCROMO COMPLETO</td><td class="n">18,50</td></tr>
    <tr><td>PROFILO BIOCHIMICO COMPLETO</td><td class="n">42,00</td></tr>
    <tr><td>LEISHMANIA IFI</td><td class="n">31,50</td></tr>
  </table>
  <div class="salto">
    <h2>ANALIZZATORI</h2>
    <table>
      <tr><td>Analizzatore biochimico da banco</td><td class="n">8.500,00</td></tr>
      <tr><td>Ematologico veterinario</td><td class="n">11.200,00</td></tr>
      <tr><td>Analizzatore urine con lettore</td><td class="n">4.300,00</td></tr>
    </table>
  </div>
</body></html>`;
```

E nella funzione principale, dopo la riga `await scrivi(browser, listinoLungoHtml(12), 'listino-lungo-tempi.pdf');`, aggiungere:

```javascript
    await scrivi(browser, MISTO_MACCHINE_HTML, 'listino-misto-macchine.pdf');
```

- [ ] **Step 9: Generare la fixture e ripristinare le altre**

Run:
```bash
node scripts/genera-fixture-pdf.js
git checkout -- lib/fixtures/listino-testo.pdf lib/fixtures/listino-scansionato.pdf lib/fixtures/righe-frammentate.pdf lib/fixtures/listino-misto.pdf lib/fixtures/listino-lungo-tempi.pdf
```
Expected: stampa `✓ listino-misto-macchine.pdf (...)`. Il `git checkout` ripristina le fixture rigenerate identiche nel contenuto ma diverse nei byte, per non sporcare il diff.

- [ ] **Step 10: Aggiungere il test di integrazione sulla fixture**

In `lib/pdfclassifica.test.js`, aggiungere in fondo:

```javascript
// Prova sul documento vero: due capitoli, un solo import, due gruppi distinti.
test('integrazione: listino con capitolo esami e capitolo analizzatori', async () => {
  const grezze = await estraiRigheGrezze(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'listino-misto-macchine.pdf'))
  );
  const res = classificaRighe(grezze);

  assert.strictEqual(res.esami, 3);
  assert.strictEqual(res.macchine, 3);

  const perTipo = t => res.righe.filter(r => !r.scartata && r.tipo === t).map(r => [r.nome, r.prezzo]);
  assert.deepStrictEqual(perTipo('esame'), [
    ['EMOCROMO COMPLETO', 18.5],
    ['PROFILO BIOCHIMICO COMPLETO', 42],
    ['LEISHMANIA IFI', 31.5]
  ]);
  assert.deepStrictEqual(perTipo('macchina'), [
    ['Analizzatore biochimico da banco', 8500],
    ['Ematologico veterinario', 11200],
    ['Analizzatore urine con lettore', 4300]
  ]);
  // Nessuna macchina deve risultare "fuori scala" per via del prezzo.
  assert.strictEqual(res.righe.filter(r => r.tipo === 'macchina' && r.confidenza === 'incerta').length, 0);
});
```

- [ ] **Step 11: Eseguire i test**

Run: `npm test`
Expected: PASS, tutti verdi.

- [ ] **Step 12: Commit**

```bash
git add lib/pdfclassifica.js lib/pdfclassifica.test.js scripts/genera-fixture-pdf.js lib/fixtures/listino-misto-macchine.pdf
git commit -m "feat: riconoscimento delle sezioni analizzatori nei listini PDF"
```

---

### Task 2: Schema e repository delle macchine

**Files:**
- Create: `lib/macchine.js`
- Create: `lib/macchine.test.js`

**Interfaces:**
- Consumes: la tabella `concorrenti` esistente (`id, nome, user_id, data_import`), creata da `lib/concorrenti.js`.
- Produces:
  - `ensureSchema(db)` — crea `macchine` e i suoi indici.
  - `upsertMacchine(db, { userId, concorrenteId, righe })` → `{ salvate: number }`. `righe` e' un array di `{nome, prezzo, note}`. `concorrenteId` null significa macchina propria.
  - `listaMacchine(db, userId)` → array di `{id, nome, prezzo, note, concorrenteId, concorrenteNome, dataImport}` ordinato per prezzo crescente.
  - `salvaMacchina(db, { id, userId, concorrenteId, nome, prezzo, note })` → `{id}`; con `id` assente inserisce, con `id` presente aggiorna solo se la riga appartiene all'account.
  - `eliminaMacchina(db, id, userId)` → `boolean`.
  Task 3, 5 e 6 dipendono da questi nomi.

- [ ] **Step 1: Scrivere i test**

Creare `lib/macchine.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const macchine = require('./macchine.js');
const concorrenti = require('./concorrenti.js');

function dbVuoto() {
  const db = new DatabaseSync(':memory:');
  concorrenti.ensureSchema(db);
  macchine.ensureSchema(db);
  return db;
}

const RIGHE = [
  { nome: 'Analizzatore biochimico', prezzo: 8500 },
  { nome: 'Ematologico veterinario', prezzo: 11200 }
];

test('ensureSchema crea la tabella ed e idempotente', () => {
  const db = dbVuoto();
  macchine.ensureSchema(db);
  const tabelle = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tabelle.includes('macchine'));
  db.close();
});

test('upsertMacchine salva le macchine proprie', () => {
  const db = dbVuoto();
  const r = macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  assert.equal(r.salvate, 2);
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].concorrenteId, null);
  db.close();
});

test('la lista e ordinata dal prezzo piu basso', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  const lista = macchine.listaMacchine(db, 1);
  assert.deepEqual(lista.map(m => m.prezzo), [8500, 11200]);
  db.close();
});

test('reimportare lo stesso nome aggiorna il prezzo invece di duplicare', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [{ nome: 'Analizzatore biochimico', prezzo: 7900 }] });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista.find(m => m.nome === 'Analizzatore biochimico').prezzo, 7900);
  db.close();
});

test('la stessa macchina puo esistere come propria e come di un concorrente', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [{ nome: 'Analizzatore biochimico', prezzo: 6900 }] });
  macchine.upsertMacchine(db, { userId: 1, concorrenteId, righe: [{ nome: 'Analizzatore biochimico', prezzo: 8500 }] });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(m => m.prezzo), [6900, 8500]);
  assert.equal(lista.find(m => m.prezzo === 8500).concorrenteNome, 'IDEXX');
  db.close();
});

test('le macchine di un account non sono visibili a un altro', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  assert.equal(macchine.listaMacchine(db, 2).length, 0);
  db.close();
});

test('salvaMacchina inserisce e aggiorna', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300, note: 'usato' });
  assert.ok(id);
  macchine.salvaMacchina(db, { id, userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4100, note: 'ricondizionato' });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].prezzo, 4100);
  assert.equal(lista[0].note, 'ricondizionato');
  db.close();
});

test('un altro account non puo modificare la macchina altrui', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300 });
  assert.throws(() => macchine.salvaMacchina(db, { id, userId: 2, concorrenteId: null, nome: 'Rubata', prezzo: 1 }), /non trovata/i);
  assert.equal(macchine.listaMacchine(db, 1)[0].nome, 'Analizzatore urine');
  db.close();
});

test('eliminaMacchina rimuove solo la propria', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300 });
  assert.equal(macchine.eliminaMacchina(db, id, 2), false, 'un altro account non deve poterla eliminare');
  assert.equal(macchine.listaMacchine(db, 1).length, 1);
  assert.equal(macchine.eliminaMacchina(db, id, 1), true);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('righe senza nome o con prezzo non valido sono ignorate', () => {
  const db = dbVuoto();
  const r = macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [
    { nome: 'Buona', prezzo: 100 }, { nome: '', prezzo: 50 }, { nome: 'Senza prezzo', prezzo: null }
  ] });
  assert.equal(r.salvate, 1);
  db.close();
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/macchine.test.js`
Expected: FAIL con `Cannot find module './macchine.js'`.

- [ ] **Step 3: Scrivere il modulo**

Creare `lib/macchine.js`:

```javascript
'use strict';
// Catalogo degli analizzatori.
//
// Una macchina appartiene sempre a un account (`user_id`). `concorrente_id`
// distingue le proprie da quelle di un concorrente: e' cio' che rende
// possibile il confronto a due lati, come per gli esami.

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS macchine (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      concorrente_id INTEGER REFERENCES concorrenti(id),
      nome           TEXT    NOT NULL,
      prezzo         REAL    NOT NULL,
      note           TEXT,
      data_import    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Indici parziali: in SQLite i NULL sono distinti fra loro dentro un
    -- UNIQUE, quindi un indice unico su (concorrente_id, nome) non
    -- impedirebbe i doppioni fra le macchine proprie.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_macchine_propria
      ON macchine(user_id, nome) WHERE concorrente_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_macchine_conc
      ON macchine(concorrente_id, nome) WHERE concorrente_id IS NOT NULL;
  `);
}

function normalizza(riga) {
  const nome = String((riga && riga.nome) || '').replace(/\s+/g, ' ').trim();
  const prezzo = Number(riga && riga.prezzo);
  if (!nome || !Number.isFinite(prezzo) || prezzo < 0) return null;
  const note = riga.note == null || riga.note === '' ? null : String(riga.note);
  return { nome, prezzo, note };
}

/**
 * Inserisce o aggiorna un elenco di macchine.
 * Reimportare lo stesso listino aggiorna i prezzi invece di duplicare le righe.
 */
function upsertMacchine(db, dati) {
  const { userId, concorrenteId, righe } = dati;
  if (userId == null) throw new Error('userId mancante');
  const owner = concorrenteId == null ? null : Number(concorrenteId);

  // Due comandi distinti: l'ON CONFLICT deve puntare all'indice parziale
  // giusto, e i due indici hanno colonne diverse.
  const upsertPropria = db.prepare(`
    INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note)
    VALUES (?, NULL, ?, ?, ?)
    ON CONFLICT(user_id, nome) WHERE concorrente_id IS NULL
    DO UPDATE SET prezzo = excluded.prezzo, note = excluded.note
  `);
  const upsertConc = db.prepare(`
    INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(concorrente_id, nome) WHERE concorrente_id IS NOT NULL
    DO UPDATE SET prezzo = excluded.prezzo, note = excluded.note
  `);

  db.exec('BEGIN');
  try {
    let salvate = 0;
    for (const grezza of (righe || [])) {
      const r = normalizza(grezza);
      if (!r) continue;
      if (owner == null) upsertPropria.run(Number(userId), r.nome, r.prezzo, r.note);
      else upsertConc.run(Number(userId), owner, r.nome, r.prezzo, r.note);
      salvate++;
    }
    db.exec('COMMIT');
    return { salvate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listaMacchine(db, userId) {
  return db.prepare(`
    SELECT m.id, m.nome, m.prezzo, m.note, m.concorrente_id, m.data_import, c.nome AS concorrente_nome
      FROM macchine m
      LEFT JOIN concorrenti c ON c.id = m.concorrente_id
     WHERE m.user_id = ?
     ORDER BY m.prezzo ASC, m.nome ASC
  `).all(Number(userId)).map(r => ({
    id: r.id,
    nome: r.nome,
    prezzo: r.prezzo,
    note: r.note,
    concorrenteId: r.concorrente_id,
    concorrenteNome: r.concorrente_nome,
    dataImport: r.data_import
  }));
}

function salvaMacchina(db, dati) {
  const { id, userId, concorrenteId, nome, prezzo, note } = dati;
  const r = normalizza({ nome, prezzo, note });
  if (!r) throw new Error('Nome o prezzo non validi');
  const owner = concorrenteId == null ? null : Number(concorrenteId);

  if (id == null) {
    const info = db.prepare(`
      INSERT INTO macchine (user_id, concorrente_id, nome, prezzo, note) VALUES (?, ?, ?, ?, ?)
    `).run(Number(userId), owner, r.nome, r.prezzo, r.note);
    return { id: Number(info.lastInsertRowid) };
  }

  // Il vincolo su user_id nella WHERE e' la difesa: senza, conoscere un id
  // basterebbe a modificare la macchina di un altro account.
  const info = db.prepare(`
    UPDATE macchine SET nome = ?, prezzo = ?, note = ?, concorrente_id = ?
     WHERE id = ? AND user_id = ?
  `).run(r.nome, r.prezzo, r.note, owner, Number(id), Number(userId));
  if (!info.changes) throw new Error('Macchina non trovata');
  return { id: Number(id) };
}

function eliminaMacchina(db, id, userId) {
  const info = db.prepare(`DELETE FROM macchine WHERE id = ? AND user_id = ?`)
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = { ensureSchema, upsertMacchine, listaMacchine, salvaMacchina, eliminaMacchina };
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test lib/macchine.test.js`
Expected: PASS, 10 test verdi.

- [ ] **Step 5: Eseguire l'intera suite**

Run: `npm test`
Expected: PASS, tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add lib/macchine.js lib/macchine.test.js
git commit -m "feat: catalogo macchine con isolamento per account"
```

---

### Task 3: Conferma dell'import a doppia destinazione

**Files:**
- Modify: `lib/importbozze.js`
- Modify: `lib/importbozze.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `macchine.upsertMacchine(db, {userId, concorrenteId, righe})`, `macchine.listaMacchine(db, userId)`, `macchine.salvaMacchina(db, {...})`, `macchine.eliminaMacchina(db, id, userId)` dal Task 2; il campo `tipo` per riga dal Task 1.
- Produces:
  - `normalizzaRighe(righe)` conserva `tipo` su ogni riga valida e deduplica per `tipo + nome`.
  - `ENTITA` include `'macchina'`.
  - La risposta di `POST /api/import-pdf/:id/conferma` guadagna `esamiImportati` e `macchineImportate`.
  - Rotte nuove: `GET /api/macchine`, `POST /api/macchine`, `PUT /api/macchine/:id`, `DELETE /api/macchine/:id`.
  Task 4, 5 e 6 dipendono da questi nomi.

- [ ] **Step 1: Scrivere i test di normalizzaRighe**

In `lib/importbozze.test.js`, aggiungere dopo il test `normalizzaRighe accorpa i nomi ripetuti e li conta a parte`:

```javascript
// Un import puo' contenere esami e macchine insieme: il tipo deve arrivare
// intatto alla conferma, che smista i due gruppi in destinazioni diverse.
test('normalizzaRighe conserva il tipo di ogni riga', () => {
  const r = bozze.normalizzaRighe([
    { nome: 'EMOCROMO COMPLETO', prezzo: 18.5, tipo: 'esame' },
    { nome: 'Analizzatore biochimico', prezzo: 8500, tipo: 'macchina' }
  ]);
  assert.equal(r.valide.length, 2);
  assert.equal(r.valide[0].tipo, 'esame');
  assert.equal(r.valide[1].tipo, 'macchina');
});

test('senza tipo la riga vale come esame', () => {
  const r = bozze.normalizzaRighe([{ nome: 'EMOCROMO', prezzo: 18.5 }]);
  assert.equal(r.valide[0].tipo, 'esame');
});

// Lo stesso nome puo' esistere come esame e come macchina: sono due cose
// diverse in due destinazioni diverse, accorparle perderebbe un dato.
test('nomi uguali di tipo diverso non vengono accorpati', () => {
  const r = bozze.normalizzaRighe([
    { nome: 'PROFILO COMPLETO', prezzo: 42, tipo: 'esame' },
    { nome: 'PROFILO COMPLETO', prezzo: 4200, tipo: 'macchina' }
  ]);
  assert.equal(r.valide.length, 2);
  assert.equal(r.duplicate, 0);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/importbozze.test.js`
Expected: FAIL — `r.valide[0].tipo` e' `undefined`.

- [ ] **Step 3: Conservare il tipo in normalizzaRighe**

In `lib/importbozze.js`, sostituire la funzione `normalizzaRighe`:

```javascript
function normalizzaRighe(righe) {
  const perNome = new Map();
  let ignorate = 0;
  let duplicate = 0;
  for (const r of Array.isArray(righe) ? righe : []) {
    const nome = String((r && r.nome) || '').replace(/\s+/g, ' ').trim();
    // Il prezzo arriva come numero dall'analisi o come testo digitato in
    // revisione: "1.234,56" deve valere 1234.56, non 1.234.
    const prezzo = parsePrezzo(r && r.prezzo);
    if (!nome || !Number.isFinite(prezzo) || prezzo < 0) { ignorate++; continue; }
    const tipo = (r && r.tipo) === 'macchina' ? 'macchina' : 'esame';

    // Il catalogo e' indicizzato per nome normalizzato: due righe con lo stesso
    // nome diventano una sola scrittura, quindi contarle entrambe come
    // "importate" sarebbe un resoconto falso. Vince l'ultima, come l'upsert.
    // Il tipo fa parte della chiave: lo stesso nome come esame e come macchina
    // sono due cose distinte, in due destinazioni distinte.
    const chiave = `${tipo}|${nome.toLowerCase()}`;
    if (perNome.has(chiave)) duplicate++;
    perNome.set(chiave, { nome, prezzo, tipo });
  }
  return { valide: [...perNome.values()], ignorate, duplicate };
}
```

- [ ] **Step 4: Aggiungere l'entita macchina**

In `lib/importbozze.js`, sostituire:

```javascript
const ENTITA = ['piano', 'concorrente'];
```

con:

```javascript
const ENTITA = ['piano', 'concorrente', 'macchina'];
```

- [ ] **Step 5: Eseguire i test**

Run: `node --test lib/importbozze.test.js`
Expected: PASS.

- [ ] **Step 6: Registrare lo schema macchine all'avvio**

In `server.js`, dopo la riga `const importbozze = require('./lib/importbozze');`, aggiungere:

```javascript
const macchineLib = require('./lib/macchine');
```

E dopo il blocco `importbozze.ensureSchema(db);`, aggiungere:

```javascript
// ── Catalogo analizzatori ───────────────────────────
macchineLib.ensureSchema(db);
```

- [ ] **Step 7: Smistare i due gruppi nella conferma**

In `server.js`, dentro `app.post('/api/import-pdf/:id/conferma', ...)`, sostituire il blocco che va da `// La destinazione e' quella fissata all'analisi` fino alla riga `res.json({ success: true, entita: bozza.entita, importate: valide.length, ignorate, duplicate, ...risultato });` con:

```javascript
    // La destinazione e' quella fissata all'analisi, non quella che arriva ora:
    // il client non puo' dirottare l'import su un'altra entita dopo la revisione.
    // Un solo import puo' scrivere in due posti: gli esami nel catalogo scelto,
    // le macchine nella sezione Macchinari.
    const perTipo = { esame: [], macchina: [] };
    for (const r of valide) perTipo[r.tipo].push(r);

    // Importando dalla sezione Macchinari l'operatore ha gia' dichiarato che
    // il documento e' un listino di analizzatori: tutto e' macchina.
    if (bozza.entita === 'macchina') {
      perTipo.macchina.push(...perTipo.esame.splice(0));
    }

    let risultato = {};
    let concorrenteId = null;

    if (bozza.entita === 'concorrente' || (bozza.entita === 'macchina' && nome)) {
      const nomeConc = String(nome || '').trim();
      if (bozza.entita === 'concorrente' && !nomeConc) {
        return res.status(400).json({ error: 'Manca il nome del concorrente' });
      }
      if (nomeConc) {
        const esito = concorrenti.upsertConcorrente(
          db, nomeConc,
          perTipo.esame.map(r => ({ nome_originale: r.nome, prezzo: r.prezzo, sconto: null })),
          req.user.id
        );
        concorrenteId = esito.concorrenteId;
        risultato = esito;
      }
    } else if (perTipo.esame.length) {
      // Aggiorna i prezzi base della PROPRIA copia del catalogo: upsert per nome,
      // nessuna cancellazione degli esami assenti dal PDF e nessun piano toccato.
      risultato = piani.upsertFromJson(db, {
        exams_base_price: Object.fromEntries(perTipo.esame.map(r => [r.nome, r.prezzo])),
        plans: {}
      }, req.user.id);
    }

    if (perTipo.macchina.length) {
      macchineLib.upsertMacchine(db, {
        userId: req.user.id,
        concorrenteId,
        righe: perTipo.macchina.map(r => ({ nome: r.nome, prezzo: r.prezzo, note: null }))
      });
    }

    // Scrittura prima della conferma: gli upsert sono idempotenti per nome,
    // quindi una doppia richiesta non duplica nulla, mentre l'ordine inverso
    // rischierebbe una bozza segnata confermata con il catalogo non aggiornato.
    const confermata = importbozze.confermaBozza(db, bozza.id, req.user.id, valide);
    if (!confermata) return res.status(409).json({ error: 'Questa bozza e stata gia confermata' });

    annota('confermato',
      `${perTipo.esame.length} esami, ${perTipo.macchina.length} macchine, ${ignorate} ignorate${duplicate ? `, ${duplicate} duplicate accorpate` : ''}`,
      { nRighe: valide.length });
    res.json({
      success: true, entita: bozza.entita,
      importate: valide.length,
      esamiImportati: perTipo.esame.length,
      macchineImportate: perTipo.macchina.length,
      ignorate, duplicate, ...risultato
    });
```

- [ ] **Step 8: Aggiungere le rotte delle macchine**

In `server.js`, subito prima di `app.post('/api/calcolo/salva', ...)`, inserire:

```javascript
// ── Macchinari (analizzatori) ──────────────────────
app.get('/api/macchine', requireAuth, (req, res) => {
  try { res.json(macchineLib.listaMacchine(db, req.user.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/macchine', requireAuth, express.json(), (req, res) => {
  try {
    const { nome, prezzo, note, concorrenteId } = req.body || {};
    const esito = macchineLib.salvaMacchina(db, {
      userId: req.user.id, concorrenteId: concorrenteId || null, nome, prezzo, note
    });
    res.json({ success: true, ...esito });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/macchine/:id', requireAuth, express.json(), (req, res) => {
  try {
    const { nome, prezzo, note, concorrenteId } = req.body || {};
    const esito = macchineLib.salvaMacchina(db, {
      id: req.params.id, userId: req.user.id,
      concorrenteId: concorrenteId || null, nome, prezzo, note
    });
    res.json({ success: true, ...esito });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/macchine/:id', requireAuth, (req, res) => {
  try {
    const ok = macchineLib.eliminaMacchina(db, req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Macchina non trovata' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 9: Verificare l'avvio e le rotte**

Run:
```bash
node --check server.js && npm test
```
Expected: `npm test` verde.

Poi avviare il server e provare il flusso completo (sostituire `TOKEN` con quello di un account di prova creato via `POST /api/auth/register`):

```bash
curl -s -X POST "localhost:3000/api/import-pdf/analizza?entita=piano" -H "Authorization: Bearer TOKEN" -F "file=@lib/fixtures/listino-misto-macchine.pdf"
```
Expected: JSON con `"esami":3` e `"macchine":3`.

Confermare la bozza (usare l'`importId` della risposta e le righe che riporta):
Expected: la risposta contiene `"esamiImportati":3` e `"macchineImportate":3`.

```bash
curl -s localhost:3000/api/macchine -H "Authorization: Bearer TOKEN"
```
Expected: tre macchine, ordinate per prezzo crescente (4300, 8500, 11200), tutte con `"concorrenteId":null`.

- [ ] **Step 10: Commit**

```bash
git add lib/importbozze.js lib/importbozze.test.js server.js
git commit -m "feat: la conferma dell'import smista esami e macchine in due destinazioni"
```

---

### Task 4: Revisione a due gruppi

**Files:**
- Modify: `public/importpdf.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `tipo` per riga e i conteggi `esami` / `macchine` dalla risposta di `/api/import-pdf/analizza` (Task 1 e 3); `esamiImportati` / `macchineImportate` dalla risposta di conferma (Task 3).
- Produces: nessuna interfaccia per altri task. La tabella di revisione mostra due blocchi e permette di spostare una riga da un gruppo all'altro.

- [ ] **Step 1: Conservare il tipo nel modello editabile**

In `public/importpdf.js`, dentro `costruisciModello()`, sostituire l'oggetto costruito per ogni riga con:

```javascript
    S.righe = S.analisi.righe.filter(r => !r.scartata).map(r => ({
      id: ++contatoreRighe,
      indice: r.indice,
      nome: r.nome,
      prezzo: r.prezzo,
      confidenza: r.confidenza,
      motivo: r.motivo,
      tipo: r.tipo === 'macchina' ? 'macchina' : 'esame',
      origine: 'estratta',
      modificata: false
    }));
```

E dentro `aggiungiRiga()`, sostituire l'oggetto con:

```javascript
    S.righe.push({
      id: ++contatoreRighe, indice: null, nome: '', prezzo: '',
      confidenza: 'alta', motivo: null, tipo: 'esame',
      origine: 'manuale', modificata: false
    });
```

E dentro `recuperaRiga(indice)`, aggiungere `tipo` all'oggetto inserito, subito dopo la riga `prezzo: orig.prezzo != null ? orig.prezzo : '',`:

```javascript
      tipo: orig.tipo === 'macchina' ? 'macchina' : 'esame',
```

- [ ] **Step 2: Disegnare i due gruppi**

In `public/importpdf.js`, sostituire la funzione `renderTabella` con:

```javascript
  function renderTabella() {
    const cont = document.getElementById('imp-tab');
    if (!cont) return;
    const scartate = scartateTabellari();
    const esami = S.righe.filter(r => r.tipo !== 'macchina');
    const macchine = S.righe.filter(r => r.tipo === 'macchina');

    // Due blocchi separati: un import puo' scrivere in due destinazioni, e chi
    // conferma deve vedere cosa va dove prima di farlo.
    const blocchi = [];
    if (esami.length || !macchine.length) blocchi.push(gruppoHtml('esame', 'Esami', esami));
    if (macchine.length) blocchi.push(gruppoHtml('macchina', 'Macchine', macchine));

    cont.innerHTML = blocchi.join('') + (S.mostraScartate ? bloccoScartateHtml(scartate) : '');

    cont.querySelectorAll('[data-campo]').forEach(inp => {
      inp.addEventListener('input', () => modificaCampo(Number(inp.dataset.id), inp.dataset.campo, inp.value));
    });
    cont.querySelectorAll('[data-elimina]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); eliminaRiga(Number(b.dataset.elimina)); });
    });
    cont.querySelectorAll('[data-sposta]').forEach(b => {
      b.addEventListener('click', e => { e.stopPropagation(); spostaRiga(Number(b.dataset.sposta)); });
    });
    cont.querySelectorAll('[data-recupera]').forEach(b => {
      b.addEventListener('click', () => recuperaRiga(Number(b.dataset.recupera)));
    });
    cont.querySelectorAll('[data-riga]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('input,button')) return;
        // Una riga aggiunta a mano non viene dal PDF e ha data-riga vuoto:
        // Number('') vale 0 e selezionerebbe il riquadro di un'altra riga.
        const idx = tr.dataset.riga === '' ? null : Number(tr.dataset.riga);
        selezionaRiga(idx, 'tabella', Number(tr.dataset.id));
      });
    });
    aggiornaConteggio();
  }

  function gruppoHtml(tipo, titolo, righe) {
    const destinazione = tipo === 'macchina'
      ? 'andranno nella sezione Macchinari'
      : (S.entita === 'concorrente' ? 'andranno nel catalogo del concorrente' : 'andranno nel tuo catalogo esami');
    return `
      <div class="imp-gruppo" data-gruppo="${tipo}">
        <div class="imp-gruppo-tit">
          <span>${titolo} <b>${righe.length}</b></span>
          <span class="imp-gruppo-dove">${destinazione}</span>
        </div>
        <table class="imp-tabella imp-tabella-edit">
          <thead><tr>
            <th style="width:30px">#</th><th>Nome</th>
            <th style="width:96px">Prezzo</th><th style="width:104px">Stato</th><th style="width:62px"></th>
          </tr></thead>
          <tbody>
            ${righe.length ? righe.map((r, i) => rigaHtml(r, i)).join('')
              : `<tr><td colspan="5" class="imp-vuoto">Nessuna riga. Usa «+ Riga» per aggiungerne a mano.</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }
```

- [ ] **Step 3: Aggiungere il pulsante di spostamento nella riga**

In `public/importpdf.js`, sostituire l'ultima cella di `rigaHtml`, cioe':

```javascript
        <td><button type="button" class="imp-x-riga" data-elimina="${r.id}" title="Togli questa riga">✕</button></td>
```

con:

```javascript
        <td class="imp-azioni-riga">
          <button type="button" class="imp-x-riga" data-sposta="${r.id}"
                  title="${r.tipo === 'macchina' ? 'Sposta fra gli esami' : 'Sposta fra le macchine'}">⇄</button>
          <button type="button" class="imp-x-riga" data-elimina="${r.id}" title="Togli questa riga">✕</button>
        </td>
```

- [ ] **Step 4: Implementare lo spostamento**

In `public/importpdf.js`, dopo la funzione `eliminaRiga`, inserire:

```javascript
  // Il riconoscimento a sezioni puo' sbagliare su un documento con capitoli
  // insoliti: spostare una riga evita di rifare tutto l'import.
  function spostaRiga(id) {
    const r = trova(id);
    if (!r) return;
    r.tipo = r.tipo === 'macchina' ? 'esame' : 'macchina';
    r.modificata = true;
    renderTabella();
    renderBanner();
  }
```

- [ ] **Step 5: Dichiarare le destinazioni nel banner**

In `public/importpdf.js`, dentro `renderBanner()`, subito dopo la riga `const conf = Math.round((a.confidenzaComplessiva || 0) * 100);`, inserire:

```javascript
    const nMacchine = S.righe.filter(r => r.tipo === 'macchina').length;
    const nEsami = S.righe.length - nMacchine;
```

E sostituire il ramo `else` (il caso senza problemi) con:

```javascript
    } else {
      titolo = `Estratti ${a.classificate} esami su ${a.totaliTabellari} righe con prezzo rilevate`;
      messaggio = 'Nessuna riga con prezzo è rimasta fuori e nessuna è dubbia.';
    }

    // Quando il documento contiene entrambe le cose, dirlo prima della conferma:
    // scrivere in due sezioni senza dichiararlo sarebbe uno spostamento
    // silenzioso di dati.
    if (nMacchine > 0) {
      messaggio += `<div class="imp-banner-dest">Riconosciuti <b>${nEsami}</b> esami e <b>${nMacchine}</b> analizzatori: gli analizzatori andranno nella sezione Macchinari.</div>`;
    }
```

- [ ] **Step 6: Aggiungere gli stili**

In `public/style.css`, in fondo al file, aggiungere:

```css
/* Revisione a due gruppi: esami e analizzatori nello stesso import */
.imp-gruppo + .imp-gruppo { border-top: 8px solid var(--bg); }
.imp-gruppo-tit {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  padding: 8px 12px; background: var(--bg-subtle); border-bottom: 1px solid var(--line);
  font-size: 12px; font-weight: 650; color: var(--ink);
  position: sticky; top: 0; z-index: 2;
}
.imp-gruppo-dove { font-weight: 400; font-size: 11.5px; color: var(--muted); }
.imp-banner-dest { margin-top: 6px; font-size: 12.5px; color: var(--ink-soft); }
.imp-azioni-riga { display: flex; gap: 2px; }
```

- [ ] **Step 7: Verificare nel browser**

Avviare il server, accedere con un account di prova, copiare la fixture in `public/` per poterla caricare:

```bash
cp lib/fixtures/listino-misto-macchine.pdf public/_fx-macchine.pdf
```

Aprire Gestione piani, avviare l'import con quel file e verificare:
- compaiono due blocchi, `Esami 3` e `Macchine 3`;
- il blocco Macchine dichiara «andranno nella sezione Macchinari»;
- il banner riporta «Riconosciuti 3 esami e 3 analizzatori»;
- il pulsante `⇄` su una riga la sposta nell'altro gruppo e i conteggi si aggiornano;
- confermando, la risposta riporta `esamiImportati` e `macchineImportate` coerenti.

Al termine rimuovere la copia:

```bash
rm public/_fx-macchine.pdf
```

- [ ] **Step 8: Commit**

```bash
git add public/importpdf.js public/style.css
git commit -m "feat: revisione dell'import a due gruppi, esami e analizzatori"
```

---

### Task 5: Sezione Macchinari

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/macchine`, `POST /api/macchine`, `PUT /api/macchine/:id`, `DELETE /api/macchine/:id` (Task 3); `ImportPdf.avvia({entita, alFine})` esistente.
- Produces: `renderMacchinari()` come funzione globale, raggiungibile da `navigate('macchinari')`. Task 6 vi aggiunge il calcolatore.

- [ ] **Step 1: Aggiungere la voce di menu**

In `public/app.js`, subito dopo il blocco della voce `concorrenti` (riga 161 circa), aggiungere:

```javascript
    <div class="nav-item ${isActive('macchinari')}" onclick="navigate('macchinari')">
      <span class="nav-icon">🔬</span> Macchinari
    </div>
```

- [ ] **Step 2: Registrare la rotta di pagina**

In `public/app.js`, nello `switch` di `navigate` (riga 293 circa), dopo `case 'concorrenti': renderConcorrentiAdmin(); break;`, aggiungere:

```javascript
    case 'macchinari': renderMacchinari();                             break;
```

- [ ] **Step 3: Scrivere la pagina**

In `public/app.js`, subito prima di `async function renderConcorrentiAdmin()`, inserire:

```javascript
// ── Macchinari (analizzatori) ──
async function renderMacchinari() {
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

  setMain(`
    <div class="page-header">
      <div><div class="page-title">Macchinari</div>
        <div class="page-subtitle">${elenco.length} analizzatori in catalogo</div>
      </div>
      <div class="page-actions">
        ${loggato ? `<button class="btn-outline" onclick="importaPdfMacchine()">📄 Importa listino PDF</button>
        <button class="btn-primary" onclick="nuovaMacchina()">+ Aggiungi macchina</button>` : ''}
      </div>
    </div>
    <div class="page-body">
      <div class="macc-avviso">
        <span class="macc-avviso-ico">🔬</span>
        <div>Carica qui solo listini di analizzatori. I listini di esami vanno in Gestione piani o Gestione concorrenti.</div>
      </div>
      ${loggato ? '' : `<div class="empty-state" style="padding:12px 16px;margin-bottom:14px;text-align:left">
        <div class="empty-sub">🔒 Accedi per gestire i tuoi macchinari.</div>
      </div>`}
      <div class="table-card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Macchina</th><th>Provenienza</th><th style="width:120px">Prezzo</th><th style="width:150px"></th></tr></thead>
            <tbody>
              ${elenco.length ? elenco.map(m => `<tr>
                <td>${escHtml(m.nome)}</td>
                <td class="td-muted">${m.concorrenteNome ? escHtml(m.concorrenteNome) : 'Mylav (mia)'}</td>
                <td class="td-num">${fmtEuro(m.prezzo)}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="modificaMacchina(${m.id})">Modifica</button>
                  <button class="btn-outline" onclick="eliminaMacchinaUI(${m.id})" style="color:var(--red);border-color:var(--red)">Elimina</button>
                </td>
              </tr>`).join('')
                : `<tr><td colspan="4" class="td-muted" style="text-align:center;padding:26px">
                     Nessun analizzatore in catalogo. Importa un listino PDF o aggiungine uno a mano.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div id="macchinari-calcolatore"></div>
    </div>
  `);
}

function importaPdfMacchine() {
  if (S.auth.guest || !S.auth.token) { alert('Accedi per importare un listino'); return; }
  ImportPdf.avvia({
    entita: 'macchina',
    alFine: () => renderMacchinari()
  });
}

async function nuovaMacchina() {
  const nome = prompt('Nome della macchina (es. "Analizzatore biochimico da banco")');
  if (!nome || !nome.trim()) return;
  const prezzo = prompt('Prezzo in euro (es. 8500 oppure 8.500,00)');
  if (prezzo == null) return;
  try {
    await api('/api/macchine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nome.trim(), prezzo: parseFloat(String(prezzo).replace(/\./g, '').replace(',', '.')) })
    });
    renderMacchinari();
  } catch (e) { alert('Errore: ' + e.message); }
}

async function modificaMacchina(id) {
  const m = (S.macchine || []).find(x => x.id === id);
  if (!m) return;
  const nome = prompt('Nome della macchina', m.nome);
  if (!nome || !nome.trim()) return;
  const prezzo = prompt('Prezzo in euro', String(m.prezzo));
  if (prezzo == null) return;
  try {
    await api(`/api/macchine/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: nome.trim(),
        prezzo: parseFloat(String(prezzo).replace(/\./g, '').replace(',', '.')),
        concorrenteId: m.concorrenteId
      })
    });
    renderMacchinari();
  } catch (e) { alert('Errore: ' + e.message); }
}

async function eliminaMacchinaUI(id) {
  const m = (S.macchine || []).find(x => x.id === id);
  if (!confirm(`Eliminare "${m ? m.nome : 'questa macchina'}" dal catalogo?`)) return;
  try {
    await api(`/api/macchine/${id}`, { method: 'DELETE' });
    renderMacchinari();
  } catch (e) { alert('Errore: ' + e.message); }
}
```

- [ ] **Step 4: Aggiungere fmtEuro**

`fmtEuro` non esiste ancora nel progetto (verificato: zero occorrenze in `public/app.js`). Aggiungerla accanto a `fmtDate`:

```javascript
function fmtEuro(n) {
  return Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
```

- [ ] **Step 5: Aggiungere gli stili del disclaimer**

In `public/style.css`, in fondo al file, aggiungere:

```css
/* Sezione Macchinari: l'avviso dice a cosa serve la pagina, prima che
   qualcuno ci carichi il listino sbagliato. */
.macc-avviso {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 16px; margin-bottom: 14px;
  background: var(--blue-tint); border: 1px solid var(--blue-line);
  border-radius: 10px; font-size: 13px; color: var(--ink-soft); line-height: 1.45;
}
.macc-avviso-ico { font-size: 18px; line-height: 1.2; }

/* Le colonne di importi si leggono incolonnate a destra. La classe non
   esisteva: qui viene definita una volta e riusata dal calcolatore. */
.td-num { text-align: right; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 6: Verificare nel browser**

Avviare il server, accedere, aprire la voce di menu **Macchinari** e verificare:
- l'avviso e' visibile e riporta il testo esatto del vincolo;
- la tabella e' vuota con il messaggio di stato vuoto;
- «+ Aggiungi macchina» inserisce una riga che compare in tabella;
- «Modifica» ne cambia il prezzo, «Elimina» la rimuove dopo conferma;
- «Importa listino PDF» apre la finestra di import con destinazione macchina.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: sezione Macchinari con catalogo, avviso e import dedicato"
```

---

### Task 6: Calcolatore di confronto macchine

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `S.macchine` popolato da `renderMacchinari()` (Task 5), con campi `{id, nome, prezzo, concorrenteId, concorrenteNome}`.
- Produces: nessuna interfaccia per altri task.

- [ ] **Step 1: Disegnare il calcolatore**

In `public/app.js`, subito dopo la funzione `renderMacchinari()`, inserire:

```javascript
// Confronto fra le proprie macchine e quelle di un concorrente.
// L'accoppiamento e' scelto dall'operatore riga per riga: nessuna mappatura
// persistente e nessun algoritmo di somiglianza, perche' non e' stato chiesto.
function renderCalcolatoreMacchine() {
  const wrap = el('macchinari-calcolatore');
  if (!wrap) return;
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);

  if (!mie.length || !loro.length) {
    wrap.innerHTML = `
      <div class="section-card">
        <div class="section-card-title">Confronto macchine</div>
        <div class="td-muted" style="padding:6px 0">
          Servono almeno una macchina tua e una di un concorrente. Importa un listino in
          Gestione concorrenti per avere il termine di paragone.
        </div>
      </div>`;
    return;
  }

  S.confrontoMacchine = S.confrontoMacchine && S.confrontoMacchine.length
    ? S.confrontoMacchine
    : [{ mia: mie[0].id, sua: loro[0].id }];

  const opzioni = (lista, sel) => lista
    .map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${escHtml(m.nome)}</option>`).join('');

  let totMia = 0, totSua = 0;
  const righe = S.confrontoMacchine.map((r, i) => {
    const a = mie.find(m => m.id === r.mia) || mie[0];
    const b = loro.find(m => m.id === r.sua) || loro[0];
    totMia += a.prezzo; totSua += b.prezzo;
    const diff = a.prezzo - b.prezzo;
    return `<tr>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'mia',this.value)">${opzioni(mie, a.id)}</select></td>
      <td><select class="roi-input" onchange="cambiaConfrontoMacchina(${i},'sua',this.value)">${opzioni(loro, b.id)}</select></td>
      <td class="td-num">${fmtEuro(a.prezzo)}</td>
      <td class="td-num">${fmtEuro(b.prezzo)}</td>
      <td class="td-num ${diff <= 0 ? 'macc-meglio' : 'macc-peggio'}">${diff <= 0 ? '−' : '+'}${fmtEuro(Math.abs(diff))}</td>
      <td><button class="imp-x-riga" onclick="togliConfrontoMacchina(${i})" title="Togli riga">✕</button></td>
    </tr>`;
  }).join('');

  const diffTot = totMia - totSua;
  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Confronto macchine</div>
      <div class="table-scroll">
        <table class="macc-confronto">
          <thead><tr>
            <th>La mia macchina</th><th>Del concorrente</th>
            <th style="width:110px">Mylav</th><th style="width:110px">Concorrente</th>
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
      <button class="btn-outline" style="margin-top:12px" onclick="aggiungiConfrontoMacchina()">+ Aggiungi riga</button>
    </div>`;
}

function cambiaConfrontoMacchina(i, lato, valore) {
  if (!S.confrontoMacchine || !S.confrontoMacchine[i]) return;
  S.confrontoMacchine[i][lato] = Number(valore);
  renderCalcolatoreMacchine();
}

function aggiungiConfrontoMacchina() {
  const mie = (S.macchine || []).filter(m => !m.concorrenteId);
  const loro = (S.macchine || []).filter(m => m.concorrenteId);
  if (!mie.length || !loro.length) return;
  S.confrontoMacchine.push({ mia: mie[0].id, sua: loro[0].id });
  renderCalcolatoreMacchine();
}

function togliConfrontoMacchina(i) {
  S.confrontoMacchine.splice(i, 1);
  if (!S.confrontoMacchine.length) {
    const mie = (S.macchine || []).filter(m => !m.concorrenteId);
    const loro = (S.macchine || []).filter(m => m.concorrenteId);
    if (mie.length && loro.length) S.confrontoMacchine.push({ mia: mie[0].id, sua: loro[0].id });
  }
  renderCalcolatoreMacchine();
}
```

- [ ] **Step 2: Richiamare il calcolatore dalla pagina**

In `public/app.js`, dentro `renderMacchinari()`, sostituire la riga finale della funzione (subito dopo la chiamata a `setMain(...)`) aggiungendo in fondo alla funzione:

```javascript
  renderCalcolatoreMacchine();
}
```

cioe' la chiusura di `renderMacchinari` diventa: la chiamata `setMain(\`...\`);` seguita da `renderCalcolatoreMacchine();` e poi `}`.

- [ ] **Step 3: Aggiungere gli stili**

In `public/style.css`, in fondo al file, aggiungere:

```css
/* Confronto macchine: stessa lettura del risparmio del calcolatore esami —
   blu quando conviene Mylav, rosso quando conviene il concorrente. */
.macc-confronto { width: 100%; border-collapse: collapse; font-size: 13px; }
.macc-confronto th {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line);
  font-size: 11px; font-weight: 650; text-transform: uppercase;
  letter-spacing: .04em; color: var(--ink-soft);
}
.macc-confronto td { padding: 6px 10px; border-bottom: 1px solid var(--line); }
.macc-confronto tfoot td { border-bottom: none; border-top: 2px solid var(--line); }
.macc-meglio { color: var(--blue); }
.macc-peggio { color: var(--red); }
```

- [ ] **Step 4: Verificare nel browser**

Con un account che ha almeno una macchina propria e una di un concorrente (importare la fixture una volta in Gestione piani e una in Gestione concorrenti), aprire Macchinari e verificare:
- il calcolatore compare sotto la tabella;
- cambiando la macchina in un elenco, prezzi, differenza e totali si aggiornano;
- la differenza e' blu quando la macchina propria costa meno, rossa quando costa di piu';
- «+ Aggiungi riga» e «✕» aggiungono e tolgono righe;
- con un solo lato presente, compare il messaggio che spiega cosa manca.

- [ ] **Step 5: Verifica end-to-end del flusso completo**

1. Importare `lib/fixtures/listino-misto-macchine.pdf` in **Gestione piani**: 3 esami nel catalogo, 3 macchine come proprie.
2. Importare lo stesso file in **Gestione concorrenti** con nome «IDEXX»: 3 esami al concorrente, 3 macchine come sue.
3. Aprire **Macchinari**: 6 macchine in elenco, 3 «Mylav (mia)» e 3 «IDEXX».
4. Il calcolatore confronta i due lati.
5. Verificare nel database che nulla sia finito nella destinazione sbagliata:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const m of db.prepare('SELECT nome, prezzo, concorrente_id FROM macchine').all()) console.log(m);
console.log('esami che sembrano macchine:', db.prepare(\"SELECT COUNT(*) c FROM esami_riferimento WHERE nome LIKE '%analizzator%'\").get().c);
db.close();"
```
Expected: sei macchine, e `esami che sembrano macchine: 0`.

6. Rimuovere gli account di prova creati.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: calcolatore di confronto fra macchine proprie e del concorrente"
```

---

## Self-review

**Copertura dello spec:**

| Requisito dello spec | Task |
|---|---|
| Riconoscimento per intestazioni di sezione | 1 |
| Campo `tipo` per riga, conteggi `esami`/`macchine` | 1 |
| Default sicuro: senza intestazioni tutto resta esame | 1, test dedicato |
| Tabella `macchine` con indici parziali | 2 |
| Isolamento per account | 2, test dedicati |
| Import a doppia destinazione | 3 |
| Destinazione `macchina`: tutto e' macchina | 3 |
| Revisione a due gruppi, spostamento riga | 4 |
| Banner che dichiara le destinazioni | 4 |
| Sezione Macchinari con disclaimer verbatim | 5 |
| Aggiunta e modifica manuale | 5 |
| Calcolatore mie contro concorrente, totali e differenza | 6 |
| Nessuna mappatura persistente | 6, accoppiamento in memoria |

**Assunzioni tecniche verificate prima di consegnare il piano:**

- `ON CONFLICT (...) WHERE ...` su indice parziale funziona con `node:sqlite`: provato con due upsert consecutivi sullo stesso nome (prezzo aggiornato, nessun duplicato) e con la stessa macchina presente sia come propria sia come di un concorrente (due righe distinte, come voluto).
- `fmtEuro` non esiste nel progetto: il Task 5 la aggiunge.
- La classe CSS `.td-num` non esiste: il Task 5 la definisce.
- `setMain`, `el`, `api`, `escHtml`, `fmtDate`, `.section-card`, `.td-muted`, `.empty-state` esistono gia' e vengono riusati.

**Punti aperti annotati durante la stesura:**

- Il tetto `PREZZO_MAX = 2000` avrebbe segnalato ogni macchina come «fuori scala»: risolto nel Task 1 con un tetto distinto per tipo. Lo spec non lo prevedeva.
- Nella destinazione `macchina` la scelta propria/concorrente passa dal campo nome gia' esistente nella finestra di import (`imp-nome-conc`): se valorizzato le macchine vanno a quel concorrente, se vuoto restano proprie. Non serve un controllo nuovo.
- L'avviso della sezione Macchinari sul documento in prevalenza esami, previsto dallo spec, non e' un task a se': il banner del Task 4 dichiara sempre quanti esami e quante macchine sono stati riconosciuti, il che copre lo stesso bisogno senza aggiungere una schermata.
