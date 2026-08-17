# Ricerca, Macchinari in due sezioni, multilingua — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere una ricerca tollerante alle sezioni macchine, dividere Macchinari in due blocchi (proprie / concorrenza) con un import ciascuno, e rendere l'interfaccia disponibile in italiano, inglese, francese e spagnolo.

**Architecture:** La ricerca e' una funzione pura in `public/ricerca.js`, esposta come `window.Ricerca` e testata caricando il file vero in una sandbox `vm`. Il multilingua e' un dizionario per lingua in `public/i18n.js` con una funzione `t(chiave, sostituzioni)`, senza librerie; la lingua vive in `localStorage` e un selettore fissato in alto a destra ridisegna la pagina corrente.

**Tech Stack:** Node/Express, `node:sqlite`, JS vanilla senza build, test con `node:test` (`npm test` = `node --test lib/*.test.js`).

## Global Constraints

- **Nessuna dipendenza nuova**, nessuna libreria di internazionalizzazione.
- `npm test` verde alla fine di ogni task. La suite impiega alcuni minuti: per i cicli rapidi eseguire il singolo file.
- **In italiano l'applicazione deve restare identica a oggi**: il multilingua non e' un'occasione per riscrivere i testi esistenti.
- I dati dell'operatore non si traducono **mai**: nomi di esami, macchine, concorrenti, strutture, piani e importi restano come sono stati importati o digitati.
- Palette del marchio: `--blue` = Mylav, `--red` = concorrenza, `--ink` grafite.
- Testi dell'interfaccia in italiano con accenti corretti; commenti nel codice senza accenti (il progetto scrive `e'` al posto di «è»).
- Terminologia delle traduzioni, da rispettare in tutto il dizionario:

| Italiano | Inglese | Francese | Spagnolo |
|---|---|---|---|
| esame | test | analyse | análisis |
| listino | price list | tarif | tarifa |
| analizzatore | analyzer | analyseur | analizador |
| macchinari | equipment | équipements | equipos |
| concorrente | competitor | concurrent | competidor |
| concorrenza | competition | concurrence | competencia |
| piano di scontistica | discount plan | plan de remises | plan de descuentos |
| struttura | practice | clinique | clínica |
| risparmio | saving | économie | ahorro |
| revisione | review | révision | revisión |
| bozza | draft | brouillon | borrador |
| prezzo base | list price | prix de base | precio base |

- Nessun push.
- Gli account di prova creati nelle verifiche vanno rimossi. Stato di partenza: 11 utenti, **1 concorrente legittimo** (id 9, dell'account reale `mikialbanese06@gmail.com`, **da non toccare**), 0 listini, 0 macchine.

---

## File Structure

| File | Responsabilita' | Task |
|---|---|---|
| `public/ricerca.js` | funzione di ricerca tollerante | 1 |
| `lib/ricerca.test.js` | test della ricerca, caricando il file vero | 1 |
| `public/i18n.js` | dizionario delle quattro lingue e `t()` | 3, 4, 5 |
| `public/index.html` | caricamento dei due script nuovi | 1, 3 |
| `public/app.js` | ricerca nelle sezioni, due blocchi, testi tradotti | 1, 2, 3, 4 |
| `public/importpdf.js` | lato di provenienza, testi tradotti | 2, 5 |
| `public/style.css` | blocchi colorati, selettore lingua, barre di ricerca | 2, 3 |
| `server.js` | codici sui messaggi d'errore comuni | 5 |

---

### Task 1: Ricerca tollerante

**Files:**
- Create: `public/ricerca.js`
- Create: `lib/ricerca.test.js`
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Produces `window.Ricerca` con due funzioni:
  - `normalizza(testo)` → minuscolo, senza accenti, spazi compattati
  - `corrisponde(testo, query)` → `boolean`
- I task 2 e 4 usano `Ricerca.corrisponde`.

- [ ] **Step 1: Scrivere i test**

Creare `lib/ricerca.test.js`:

```javascript
'use strict';
// La funzione di ricerca vive in public/ricerca.js perche' gira nel browser.
// Qui si carica quel file vero in una sandbox, invece di riscriverne una copia:
// un test su un duplicato non direbbe niente sul codice che gli utenti usano.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sorgente = fs.readFileSync(path.join(__dirname, '..', 'public', 'ricerca.js'), 'utf8');
const contesto = { window: {} };
vm.createContext(contesto);
vm.runInContext(sorgente, contesto);
const { corrisponde, normalizza } = contesto.window.Ricerca;

test('normalizza toglie accenti, maiuscole e spazi in eccesso', () => {
  assert.equal(normalizza('  Esame  Citològico  '), 'esame citologico');
  assert.equal(normalizza('PU/CU'), 'pu/cu');
  assert.equal(normalizza(null), '');
});

test('query vuota: corrisponde sempre', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', ''), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', '   '), true);
});

test('sottostringa semplice', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'emocromo'), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'crom'), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'leishmania'), false);
});

test('accenti e maiuscole ignorati', () => {
  assert.equal(corrisponde('Esame Citològico del sedimento', 'CITOLOGICO'), true);
  assert.equal(corrisponde('ESAME CITOLOGICO', 'citològico'), true);
});

// I nomi dei listini reali hanno le parole in ordine imprevedibile: cercare
// "urine completo" deve trovare "ESAME URINE, PU/CU, COMPLETO".
test('parole in qualsiasi ordine, tutte devono comparire', () => {
  const nome = 'ESAME URINE, PU/CU, COMPLETO';
  assert.equal(corrisponde(nome, 'urine completo'), true);
  assert.equal(corrisponde(nome, 'completo urine'), true);
  assert.equal(corrisponde(nome, 'urine feci'), false, 'feci non c e: non deve corrispondere');
});

test('tollera un errore di battitura su parole da 4 a 6 caratteri', () => {
  assert.equal(corrisponde('Analizzatore biochimico', 'analizatore'), true);
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'emocormo'), true);
  assert.equal(corrisponde('LEISHMANIA IFI', 'leishmani'), true);
});

test('tollera due errori su parole da 7 caratteri in su', () => {
  assert.equal(corrisponde('Coprologico completo', 'coprolgico'), true);
  assert.equal(corrisponde('Ematologico veterinario', 'veterinrio'), true);
});

// Sotto i 4 caratteri la tolleranza produrrebbe piu' rumore che aiuto: con
// "TSH" a distanza 1 si troverebbe mezzo listino.
test('nessuna tolleranza sotto i 4 caratteri', () => {
  assert.equal(corrisponde('TSH CANINO', 'tsh'), true, 'esatto deve funzionare');
  assert.equal(corrisponde('TSH CANINO', 'tsx'), false, 'un errore su 3 lettere non si tollera');
  assert.equal(corrisponde('T4 TOTALE', 'tz'), false);
});

// La corrispondenza per sottostringa resta, ed e' voluta: "crom" deve trovare
// "EMOCROMO". Vale anche per query corte, quindi "ta" trova "toTAle": non e'
// tolleranza agli errori, e' una ricerca parziale.
test('sottostringa vale anche per query corte', () => {
  assert.equal(corrisponde('T4 TOTALE', 'ta'), true);
});

test('una parola sbagliata oltre la tolleranza non corrisponde', () => {
  assert.equal(corrisponde('EMOCROMO COMPLETO', 'xyzabcde'), false);
  assert.equal(corrisponde('Analizzatore', 'frigorifero'), false);
});

test('la tolleranza vale su ogni parola del testo, non solo sulla prima', () => {
  assert.equal(corrisponde('PROFILO BIOCHIMICO COMPLETO', 'biochmico'), true);
});

test('piu parole con un errore ciascuna', () => {
  assert.equal(corrisponde('Analizzatore biochimico da banco', 'analizatore biochmico'), true);
});

test('testo vuoto non corrisponde a una query non vuota', () => {
  assert.equal(corrisponde('', 'emocromo'), false);
  assert.equal(corrisponde(null, 'emocromo'), false);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `node --test lib/ricerca.test.js`
Expected: FAIL, il file `public/ricerca.js` non esiste.

- [ ] **Step 3: Scrivere la funzione**

Creare `public/ricerca.js`:

```javascript
/* Ricerca tollerante per gli elenchi dell'applicazione.
 *
 * Sta qui e non in lib/ perche' gira nel browser, ma e' logica pura e i suoi
 * test (lib/ricerca.test.js) caricano questo stesso file in una sandbox.
 *
 * Regole, decise sui nomi dei listini reali:
 * - accenti e maiuscole ignorati;
 * - le parole cercate possono comparire in qualsiasi ordine, ma devono
 *   comparire tutte;
 * - si tollera un errore di battitura, e la tolleranza cresce con la lunghezza
 *   della parola. Sotto i 4 caratteri non si tollera nulla: su "TSH" a distanza
 *   1 si troverebbe mezzo listino.
 */
(function () {
  'use strict';

  const SOGLIA_TOLLERANZA = 4;   // sotto questa lunghezza, solo corrispondenza esatta
  const LUNGHEZZA_DUE_ERRORI = 7; // da qui in su si tollerano due errori

  function normalizza(testo) {
    return String(testo == null ? '' : testo)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // via i segni diacritici
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function erroriTollerati(lunghezza) {
    if (lunghezza < SOGLIA_TOLLERANZA) return 0;
    return lunghezza >= LUNGHEZZA_DUE_ERRORI ? 2 : 1;
  }

  // Distanza di modifica con uscita anticipata: non serve il valore esatto, solo
  // sapere se sta entro il massimo. Due righe invece della matrice intera.
  function entroDistanza(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    if (a === b) return true;
    let precedente = new Array(b.length + 1);
    let corrente = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) precedente[j] = j;
    for (let i = 1; i <= a.length; i++) {
      corrente[0] = i;
      let minimoRiga = corrente[0];
      for (let j = 1; j <= b.length; j++) {
        const costo = a[i - 1] === b[j - 1] ? 0 : 1;
        corrente[j] = Math.min(
          precedente[j] + 1,        // cancellazione
          corrente[j - 1] + 1,      // inserimento
          precedente[j - 1] + costo // sostituzione
        );
        if (corrente[j] < minimoRiga) minimoRiga = corrente[j];
      }
      // Se l'intera riga ha superato il massimo, nessun percorso puo' rientrare.
      if (minimoRiga > max) return false;
      const scambio = precedente; precedente = corrente; corrente = scambio;
    }
    return precedente[b.length] <= max;
  }

  function parolaCorrisponde(paroleTesto, testoIntero, parola) {
    if (testoIntero.includes(parola)) return true;
    const max = erroriTollerati(parola.length);
    if (!max) return false;
    return paroleTesto.some(p => entroDistanza(p, parola, max));
  }

  function corrisponde(testo, query) {
    const q = normalizza(query);
    if (!q) return true;
    const t = normalizza(testo);
    if (!t) return false;
    const paroleTesto = t.split(/[^a-z0-9]+/).filter(Boolean);
    return q.split(' ').every(parola => parolaCorrisponde(paroleTesto, t, parola));
  }

  window.Ricerca = { normalizza, corrisponde };
})();
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test lib/ricerca.test.js`
Expected: PASS, 12 test verdi.

- [ ] **Step 5: Caricare lo script nella pagina**

In `public/index.html`, prima di `app.js`:

```html
<script src="ricerca.js"></script>
```

- [ ] **Step 6: Barra di ricerca nel dettaglio di un listino**

In `public/app.js`, in `renderListinoMacchine`, aggiungere una barra sopra la tabella e filtrare le righe. Segui il pattern gia' in uso nel progetto (`dett-search` piu' una funzione `filtra…` che aggiorna lo stato e ridisegna): cerca `dett-search` in quel file per vederne uno.

La barra va posta nella riga dei comandi accanto a «+ Aggiungi macchina», con `placeholder="🔍 Cerca macchina…"`, e deve conservare il valore digitato fra i ridisegni (tienilo in `S.filtroMacchine`). Le righe si filtrano con `Ricerca.corrisponde(m.nome, S.filtroMacchine)`.

Quando il filtro non trova nulla, al posto della tabella vuota mostra una riga che lo dice, distinguendola dal caso «listino senza macchine»: sono due situazioni diverse e confonderle fa pensare a un listino vuoto.

- [ ] **Step 7: Verificare**

Run: `node --check public/app.js && node --test lib/ricerca.test.js`

Avviare il server, accedere con un account di prova, importare `lib/fixtures/listino-misto-macchine.pdf` in Macchinari, aprire il listino e provare la ricerca: `analizatore` (con l'errore) deve trovare le righe «Analizzatore…», `urine lettore` deve trovare «Analizzatore urine con lettore», una parola inesistente deve mostrare il messaggio di nessun risultato.

**Al termine rimuovere l'account di prova e le sue righe.**

- [ ] **Step 8: Commit**

```bash
git add public/ricerca.js lib/ricerca.test.js public/index.html public/app.js
git commit -m "feat: ricerca tollerante a errori di battitura e ordine delle parole"
```

---

### Task 2: Macchinari in due sezioni

**Files:**
- Modify: `public/app.js`
- Modify: `public/importpdf.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `Ricerca.corrisponde` (Task 1); `GET /api/listini-macchine`.
- Produces: `ImportPdf.avvia` accetta `lato: 'mie' | 'concorrente'` quando `entita === 'macchina'`. Con `'mie'` la finestra non chiede nulla; con `'concorrente'` chiede quale concorrente, elencando solo quelli esistenti.

- [ ] **Step 1: Dividere la pagina in due blocchi**

In `public/app.js`, in `renderMacchinari`, separare i listini in due gruppi e disegnare due blocchi. Struttura di ciascuno:

```javascript
// Due blocchi distinti dai colori che nel progetto hanno gia' un significato:
// blu Mylav, rosso concorrenza. Ogni blocco ha il suo import e la sua ricerca,
// cosi' il comando dichiara da se' dove finiranno le macchine.
function bloccoListiniHtml(lato, titolo, sottotitolo, listini, loggato) {
  const filtro = lato === 'mie' ? (S.filtroListiniMie || '') : (S.filtroListiniLoro || '');
  const visibili = listini.filter(l => Ricerca.corrisponde(l.nome, filtro));
  const funzioneFiltro = lato === 'mie' ? 'filtraListiniMie' : 'filtraListiniLoro';
  const funzioneImport = lato === 'mie' ? 'importaPdfMacchineMie' : 'importaPdfMacchineConcorrente';
  const etichettaImport = lato === 'mie' ? '📄 Importa listino PDF' : '📄 Importa listino concorrente';

  return `
    <div class="macc-blocco macc-blocco-${lato}">
      <div class="macc-blocco-testa">
        <div>
          <div class="macc-blocco-tit">${escHtml(titolo)}</div>
          <div class="macc-blocco-sub">${escHtml(sottotitolo)}</div>
        </div>
        ${loggato ? `<button class="btn-outline" onclick="${funzioneImport}()">${etichettaImport}</button>` : ''}
      </div>
      <div class="macc-blocco-corpo">
        <input class="roi-input dett-search" placeholder="🔍 Cerca listino…" value="${escHtml(filtro)}"
               oninput="${funzioneFiltro}(this.value)" autocomplete="off" style="margin-bottom:10px">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Listino</th>${lato === 'loro' ? '<th>Concorrente</th>' : ''}<th style="width:100px">Macchine</th><th style="width:110px">Importato</th><th style="width:190px"></th></tr></thead>
            <tbody>
              ${visibili.map(l => `<tr>
                <td>${escHtml(l.nome)}</td>
                ${lato === 'loro' ? `<td class="td-muted">${escHtml(l.concorrenteNome || '')}</td>` : ''}
                <td class="td-muted">${l.nMacchine}</td>
                <td class="td-muted">${fmtDate(l.dataImport)}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn-outline" onclick="renderListinoMacchine(${l.id})">Vedi macchine</button>
                  <button class="btn-outline" onclick="eliminaListinoUI(${l.id})" style="color:var(--red);border-color:var(--red)">Elimina</button>
                </td>
              </tr>`).join('')}
              ${!visibili.length ? `<tr><td colspan="${lato === 'loro' ? 5 : 4}" class="td-muted" style="text-align:center;padding:22px">
                ${listini.length
                  ? 'Nessun listino corrisponde alla ricerca.'
                  : (loggato ? 'Nessun listino importato. Usa il pulsante qui sopra per aggiungerne uno.' : 'Accedi per importare i tuoi listini.')}
              </td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function filtraListiniMie(v) { S.filtroListiniMie = v; renderMacchinari(); }
function filtraListiniLoro(v) { S.filtroListiniLoro = v; renderMacchinari(); }
```

Nel corpo di `renderMacchinari`, sostituire la tabella unica con i due blocchi:

```javascript
  const mie = listini.filter(l => !l.concorrenteId);
  const loro = listini.filter(l => l.concorrenteId);
```

e nel markup, al posto della `table-card` attuale:

```javascript
      ${bloccoListiniHtml('mie', 'Le mie macchine', 'Analizzatori del listino Mylav', mie, loggato)}
      ${bloccoListiniHtml('loro', 'Macchine della concorrenza', 'Analizzatori dei listini dei concorrenti', loro, loggato)}
```

Il sottotitolo della pagina diventa il totale dei due gruppi: `${mie.length} tuoi · ${loro.length} della concorrenza`.

Attenzione: `renderMacchinari` e' `async` e ricarica dal server a ogni chiamata. Le due funzioni di filtro la richiamano, quindi ogni carattere digitato fa una chiamata di rete. Evitalo: estrai il disegno in una funzione sincrona che usa `S.listiniMacchine` gia' in memoria, e fai in modo che le funzioni di filtro chiamino quella, non `renderMacchinari`.

- [ ] **Step 2: Due comandi di import distinti**

Sostituire `importaPdfMacchine` con due funzioni:

```javascript
function importaPdfMacchineMie() {
  if (S.auth.guest || !S.auth.token) { alert('Accedi per importare un listino'); return; }
  ImportPdf.avvia({ entita: 'macchina', lato: 'mie', alFine: () => renderMacchinari() });
}

function importaPdfMacchineConcorrente() {
  if (S.auth.guest || !S.auth.token) { alert('Accedi per importare un listino'); return; }
  if (!S.concorrenti || !S.concorrenti.length) {
    alert('Nessun concorrente in archivio: importa prima un listino esami in Gestione concorrenti.');
    return;
  }
  ImportPdf.avvia({ entita: 'macchina', lato: 'concorrente', alFine: () => renderMacchinari() });
}
```

Verificare che `S.concorrenti` sia popolato quando si apre Macchinari: se non lo e', caricarlo in `renderMacchinari` con `api('/api/concorrenti')`. Cerca dove viene popolato oggi (`loadConcorrenti`) e riusa quella funzione invece di duplicare la chiamata.

- [ ] **Step 3: Adeguare la finestra di import**

In `public/importpdf.js`:

1. `avvia` accetta `opts.lato` e lo conserva in `S.lato` (valori `'mie'` o `'concorrente'`; qualunque altro valore vale `'mie'`).
2. Il campo di provenienza compare **solo** se `S.entita === 'macchina' && S.lato === 'concorrente'`, e il suo elenco contiene **solo i concorrenti esistenti**, senza la voce «Le mie macchine»: la scelta fra proprie e concorrenza e' gia' stata fatta col pulsante. L'etichetta diventa «Concorrente».
3. Se `S.lato === 'mie'`, `conferma()` invia `concorrenteId: null`.
4. Se `S.lato === 'concorrente'` e nessun concorrente e' selezionato, la conferma si blocca con un avviso, come fa gia' per il nome del concorrente negli import di tipo `concorrente`.

- [ ] **Step 4: Stili dei due blocchi**

In `public/style.css`, in fondo:

```css
/* Macchinari: due blocchi distinti dal colore. Blu = Mylav, rosso =
   concorrenza, la stessa convenzione usata nei calcolatori. */
.macc-blocco {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 18px;
}
.macc-blocco-testa {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px;
  border-left: 4px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.macc-blocco-mie  .macc-blocco-testa { border-left-color: var(--blue); background: var(--blue-tint); }
.macc-blocco-loro .macc-blocco-testa { border-left-color: var(--red);  background: var(--red-tint); }
.macc-blocco-tit { font-size: 14px; font-weight: 650; color: var(--ink); }
.macc-blocco-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.macc-blocco-corpo { padding: 12px 16px 4px; }
.macc-blocco-corpo .dett-search { width: 100%; max-width: 340px; }
```

- [ ] **Step 5: Verificare**

Run: `node --check public/app.js && node --check public/importpdf.js`

Avviare il server, accedere, e verificare: i due blocchi con i colori giusti; il pulsante del blocco blu importa senza chiedere la provenienza; quello rosso chiede quale concorrente ed elenca solo quelli esistenti; senza concorrenti in archivio il secondo pulsante lo dice invece di aprire una finestra inutile; le due barre di ricerca filtrano il proprio blocco e non fanno chiamate di rete a ogni carattere (guarda la scheda di rete o i log del server).

**Al termine rimuovere l'account di prova e le sue righe.**

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/importpdf.js public/style.css
git commit -m "feat: Macchinari in due sezioni, un import e una ricerca per ciascuna"
```

---

### Task 3: Impianto multilingua

**Files:**
- Create: `public/i18n.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Produces `window.I18n` con:
  - `LINGUE` → `['it','en','fr','es']`
  - `t(chiave, sostituzioni)` → stringa tradotta nella lingua corrente
  - `lingua()` → codice corrente
  - `impostaLingua(codice)` → salva e ridisegna
  - `selettoreHtml()` → markup del selettore
- E la scorciatoia globale `t` (alias di `I18n.t`), usata da `app.js` e `importpdf.js`.
- I task 4 e 5 aggiungono chiavi al dizionario e sostituiscono i testi.

- [ ] **Step 1: Scrivere l'impianto**

Creare `public/i18n.js`. Struttura richiesta:

```javascript
/* Traduzioni dell'interfaccia: italiano, inglese, francese, spagnolo.
 *
 * Nessuna libreria: un dizionario per lingua e una funzione che risolve una
 * chiave. Le frasi restano intere e i valori variabili entrano per
 * sostituzione ({n}, {nome}): concatenare pezzi produrrebbe frasi
 * sgrammaticate, perche' l'ordine delle parole cambia da lingua a lingua.
 *
 * I dati dell'operatore non compaiono qui: nomi di esami, macchine,
 * concorrenti e importi restano come li ha inseriti lui.
 */
(function () {
  'use strict';

  const LINGUE = ['it', 'en', 'fr', 'es'];
  const NOMI = { it: 'Italiano', en: 'English', fr: 'Français', es: 'Español' };
  const CHIAVE_MEMORIA = 'lingua';

  const DIZIONARIO = {
    it: { /* chiavi in italiano */ },
    en: { /* ... */ },
    fr: { /* ... */ },
    es: { /* ... */ }
  };

  let corrente = LINGUE.includes(localStorage.getItem(CHIAVE_MEMORIA))
    ? localStorage.getItem(CHIAVE_MEMORIA)
    : 'it';

  // Chiave mancante in una lingua: si ricade sull'italiano, non sulla chiave
  // grezza. Un testo nella lingua sbagliata e' un difetto; una chiave a schermo
  // e' una rottura.
  function t(chiave, sostituzioni) {
    const testo = (DIZIONARIO[corrente] && DIZIONARIO[corrente][chiave])
      || DIZIONARIO.it[chiave];
    if (testo == null) {
      console.warn('i18n: chiave mancante', chiave);
      return chiave;
    }
    if (!sostituzioni) return testo;
    return testo.replace(/\{(\w+)\}/g, (intero, nome) =>
      sostituzioni[nome] == null ? intero : String(sostituzioni[nome]));
  }

  function impostaLingua(codice) {
    if (!LINGUE.includes(codice) || codice === corrente) return;
    corrente = codice;
    localStorage.setItem(CHIAVE_MEMORIA, codice);
    document.documentElement.lang = codice;
    if (typeof window.ridisegnaTutto === 'function') window.ridisegnaTutto();
  }

  window.I18n = { LINGUE, NOMI, t, lingua: () => corrente, impostaLingua, selettoreHtml };
  window.t = t;
})();
```

Il selettore: un comando compatto che mostra la lingua attiva e apre l'elenco delle quattro. Implementalo dentro `i18n.js` con `selettoreHtml()` piu' le funzioni di apertura e scelta, esposte su `window` come fa il resto del progetto (che usa `onclick="funzione()"` nel markup). Mostra il codice della lingua in maiuscolo (`IT`, `EN`, `FR`, `ES`) e i nomi completi nell'elenco aperto.

Le chiavi da inserire in questo task sono quelle di menu e stati comuni, in tutte e quattro le lingue. Elenco esatto da coprire, ricavato da `public/app.js`:

- le otto voci del menu (Dashboard, Gestione piani, Gestione concorrenti, Macchinari, Confronto macchine, Confronto strutture, Cronologia, e la voce di caricamento file);
- i titoli e sottotitoli di quelle pagine;
- gli stati comuni: «Caricamento...», «Nessun dato ancora», «Errore», «Errore caricamento», il messaggio dell'ospite «Accedi per…»;
- le etichette dei comandi ricorrenti: Salva, Annulla, Elimina, Modifica, Chiudi, Conferma, Accedi, Esci.

Per ciascuna scegli una chiave descrittiva a punti (`menu.dashboard`, `comune.salva`, `stato.caricamento`) e traducila rispettando la tabella di terminologia nei vincoli globali.

- [ ] **Step 2: Caricare lo script e sostituire i testi del menu**

In `public/index.html`, prima di `app.js`:

```html
<script src="i18n.js"></script>
```

E aggiungere, dentro `.app-layout`, il contenitore del selettore:

```html
  <div id="selettore-lingua"></div>
```

In `public/app.js`:
1. Sostituire i testi delle voci di menu e dei titoli di pagina coperti dallo Step 1 con `t('chiave')`.
2. Definire `window.ridisegnaTutto`, che ridisegna il menu e la pagina corrente. Riusa il meccanismo di navigazione esistente: cerca `function navigate` e come tiene la pagina attiva, e richiama quella con gli stessi parametri invece di inventare un secondo percorso.
3. All'avvio, disegnare il selettore dentro `#selettore-lingua` e impostare `document.documentElement.lang`.

- [ ] **Step 3: Stili del selettore**

In `public/style.css`:

```css
/* Selettore della lingua: fissato in alto a destra, fuori dal disegno delle
   pagine, che si ridisegnano continuamente. */
#selettore-lingua { position: fixed; top: 12px; right: 16px; z-index: 900; }
.lang-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface);
  font-size: 12px; font-weight: 600; color: var(--ink-soft);
  box-shadow: 0 1px 4px rgba(38,38,42,.08);
}
.lang-btn:hover { border-color: var(--blue-line); color: var(--blue); }
.lang-menu {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 150px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 4px 16px rgba(38,38,42,.12); overflow: hidden;
}
.lang-menu > div { padding: 8px 12px; font-size: 13px; color: var(--ink-soft); cursor: pointer; }
.lang-menu > div:hover { background: var(--blue-tint); color: var(--blue); }
.lang-menu > div.attiva { font-weight: 650; color: var(--blue); }
.lang-menu > div + div { border-top: 1px solid var(--line); }

/* I comandi di pagina stanno in alto a destra come il selettore: senza questo
   spazio finirebbero sotto di esso. */
.page-header { padding-right: 92px; }
```

- [ ] **Step 4: Verificare**

Run: `node --check public/app.js && node --check public/i18n.js`

Avviare il server e verificare: il selettore compare in alto a destra e non copre i pulsanti di pagina; cambiando lingua il menu e i titoli cambiano subito, senza ricaricare; la scelta sopravvive a un ricarico della pagina; in italiano i testi sono identici a prima. Controllare la console: nessun avviso «chiave mancante» sulle parti tradotte in questo task.

- [ ] **Step 5: Commit**

```bash
git add public/i18n.js public/index.html public/app.js public/style.css
git commit -m "feat: impianto multilingua e selettore lingua in alto a destra"
```

---

### Task 4: Traduzione delle sezioni

**Files:**
- Modify: `public/i18n.js`
- Modify: `public/app.js`

**Interfaces:** consuma `t()` dal Task 3; nessuna interfaccia nuova.

- [ ] **Step 1: Censire le stringhe**

Prima di tradurre, elencare tutte le stringhe visibili delle quattro sezioni: Gestione piani, Gestione concorrenti, Macchinari, Confronto macchine.

**Piu' la schermata di accesso** (`#auth-overlay` in `public/index.html`), che il piano originale non prevedeva: la fetta 3 ha portato il selettore della lingua sopra quell'overlay, perche' chi non legge l'italiano deve poter scegliere la lingua prima di entrare. Un selettore raggiungibile su una schermata che resta in italiano non ha senso. Sono otto stringhe: «Accedi» (la linguetta e il pulsante), «Registrati», «Email», «Password», «Entra come ospite», «Password dimenticata?», «Ho dimenticato email e password». Il logo (`MYL`, `V`, `®`) non si traduce. Comprendono titoli, sottotitoli, intestazioni di tabella, etichette dei pulsanti, testi dei segnaposto (`placeholder`), stati vuoti, avvisi, e i testi delle finestre di conferma.

Comando utile per non dimenticarne:

```bash
grep -nE ">[A-ZÀ-Ú][^<>{}]{3,70}<|placeholder=\"[^\"]+\"|alert\('[^']+'|confirm\(\`[^\`]+" public/app.js
```

Scrivere l'elenco nel report: serve a chi rivede per controllare che non ne manchi nessuna.

- [ ] **Step 2: Aggiungere le chiavi al dizionario**

Per ciascuna stringa una chiave a punti che dica dove vive (`piani.titolo`, `concorrenti.tabella.mappati`, `macchinari.avviso`, `confronto.manca.mie`), tradotta nelle quattro lingue secondo la tabella di terminologia nei vincoli globali.

Regole:
- I numeri e i nomi entrano per sostituzione: `t('macchinari.sottotitolo', { mie: 3, loro: 2 })`, mai per concatenazione.
- Le frasi con singolare e plurale diversi hanno due chiavi (`…uno` e `…molti`), scelte in base al numero. In inglese, francese e spagnolo la regola del plurale coincide con l'italiano per questi casi (uno / diverso da uno), quindi una condizione sul numero basta.
- L'avviso di Macchinari e' vincolato in italiano al testo attuale: tradurlo nelle altre lingue conservandone il senso completo, compresa la conseguenza («comprese quelle che sembrano esami»).

- [ ] **Step 3: Sostituire i testi**

Nelle quattro funzioni di pagina e nelle loro funzioni collegate, sostituire ogni stringa con la chiamata a `t()`. Non toccare i dati dell'operatore: `escHtml(l.nome)`, `fmtEuro(m.prezzo)`, `escHtml(c.nome)` restano come sono.

- [ ] **Step 4: Verificare**

Run: `node --check public/app.js && node --check public/i18n.js`

Avviare il server, accedere, e passare per le quattro sezioni nelle quattro lingue. Verificare che non resti testo italiano quando la lingua e' diversa, che i numeri nelle frasi siano al posto giusto, e che i nomi dei dati non siano stati tradotti. Controllare la console per avvisi di chiavi mancanti.

**Al termine rimuovere l'account di prova e le sue righe.**

- [ ] **Step 5: Commit**

```bash
git add public/i18n.js public/app.js
git commit -m "feat: traduzione delle sezioni piani, concorrenti, macchinari e confronto"
```

---

### Task 5: Finestra di import e messaggi del server

**Files:**
- Modify: `public/i18n.js`
- Modify: `public/importpdf.js`
- Modify: `server.js`

**Interfaces:** i messaggi d'errore comuni del server guadagnano un campo `codice`; il client traduce quel codice e ricade sul testo del server se non lo conosce.

- [ ] **Step 1: Tradurre la finestra di import**

In `public/importpdf.js`, sostituire con `t()` tutte le stringhe visibili: le quattro fasi, i titoli e i messaggi del banner, le intestazioni della tabella di revisione, le etichette di stato delle righe (`alta`, `da rivedere`, `modificata`, `aggiunta`, `recuperata`), i motivi mostrati nei suggerimenti, la legenda, il testo della spunta di conferma, i pulsanti e i messaggi finali.

`importpdf.js` e' caricato dopo `i18n.js`, quindi `t` e' disponibile. Aggiungere una difesa: se `window.t` non esistesse, usare una funzione che restituisce la chiave, cosi' un errore di caricamento non rompe la finestra.

Attenzione ai motivi di scarto prodotti dal server (`lib/pdfclassifica.js`), che oggi arrivano come frasi italiane dentro `motivo`: sono spiegazioni tecniche mostrate nei suggerimenti. Tradurli richiederebbe un codice per ciascuno; in questo task restano in italiano, e va scritto nel report come limite noto.

- [ ] **Step 2: Aggiungere il codice ai messaggi comuni del server**

In `server.js` e nelle librerie, aggiungere un `codice` ai messaggi che l'operatore incontra nell'uso normale. Elenco da coprire:

- `PDF_SENZA_TESTO`, `PDF_PROTETTO`, `PDF_NON_VALIDO` (gia' esistono come codici in `lib/pdfestrazione.js`: verificare che arrivino al client)
- `CONFERMA_MANCANTE` (esiste gia')
- `FILE_TROPPO_GRANDE`, `SOLO_PDF` (dal middleware degli errori)
- `LISTINO_NON_TROVATO`, `MACCHINA_NON_TROVATA`, `CONCORRENTE_NON_TROVATO`, `BOZZA_NON_TROVATA`, `PIANO_NON_TROVATO`
- `NOME_PREZZO_NON_VALIDI`, `MACCHINA_DUPLICATA`, `NOME_CONCORRENTE_MANCANTE`, `NESSUNA_RIGA_IMPORTABILE`, `BOZZA_GIA_CONFERMATA`, `DESTINAZIONE_NON_VALIDA`

Il campo `error` con il testo italiano **resta**: e' la ricaduta se il client non conosce il codice, ed evita di rompere qualcosa che oggi legge quel testo.

- [ ] **Step 3: Tradurre i codici lato client**

Nel dizionario, una chiave per codice (`errore.PDF_SENZA_TESTO`, …). Dove il client mostra un errore di rete, usare la traduzione del codice quando c'e', altrimenti il testo ricevuto:

```javascript
// Il server manda un codice piu' il testo italiano: si mostra la traduzione del
// codice quando la conosciamo, altrimenti il testo cosi' come arriva.
function messaggioErrore(dati, fallback) {
  const codice = dati && dati.codice;
  if (codice && I18n.esiste('errore.' + codice)) return t('errore.' + codice);
  return (dati && dati.error) || fallback;
}
```

Aggiungere a `i18n.js` la funzione `esiste(chiave)`, che dice se la chiave e' nel dizionario della lingua corrente o in quello italiano, senza produrre l'avviso di chiave mancante.

- [ ] **Step 4: Verificare**

Run: `node --check server.js && node --check public/importpdf.js && node --check public/i18n.js && npm test`

Avviare il server e provocare gli errori piu' comuni in una lingua diversa dall'italiano: caricare un file non PDF, caricare il PDF scansionato (`lib/fixtures/listino-scansionato.pdf`), confermare senza spuntare la casella, salvare una macchina con nome duplicato. Ognuno deve comparire tradotto.

**Al termine rimuovere l'account di prova e le sue righe.**

- [ ] **Step 5: Commit**

```bash
git add public/i18n.js public/importpdf.js server.js
git commit -m "feat: finestra di import tradotta e codici sui messaggi d'errore comuni"
```

---

### Task 6: Verifica end-to-end

**Files:** nessuna modifica prevista; eventuali correzioni nei file dei task precedenti.

- [ ] **Step 1: Suite completa**

Run: `npm test` (timeout generoso, impiega alcuni minuti)

- [ ] **Step 2: Giro completo in ogni lingua**

Con un account di prova, per ciascuna delle quattro lingue: passare da Dashboard, Gestione piani, Gestione concorrenti, Macchinari e Confronto macchine, aprire la finestra di import e arrivare fino alla revisione. Verificare che non compaia testo italiano quando la lingua e' diversa e che la console non segnali chiavi mancanti.

- [ ] **Step 3: Ricerca e due sezioni**

Importare `lib/fixtures/listino-misto-macchine.pdf` una volta come proprio e una volta per un concorrente. Verificare: i due blocchi coi colori giusti; le ricerche filtrano ciascuna il proprio blocco; la ricerca nel dettaglio di un listino trova con un errore di battitura; nessuna chiamata di rete a ogni carattere digitato.

- [ ] **Step 4: Stato del database**

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('db/database.sqlite',{readOnly:true});
for (const t of ['users','concorrenti','listini_macchine','macchine']) console.log(t, db.prepare('SELECT COUNT(*) c FROM '+t).get().c);
db.close();"
```
Expected: 11 utenti, 1 concorrente, 0 listini, 0 macchine.

- [ ] **Step 5: Commit di eventuali correzioni**

Se la verifica ha richiesto correzioni, un commit unico che le descriva.

---

## Self-review

**Copertura dello spec:**

| Requisito | Task |
|---|---|
| Ricerca: parole in qualsiasi ordine, accenti ignorati | 1 |
| Ricerca: tolleranza crescente, nulla sotto 4 caratteri | 1, test dedicato |
| Barra in ogni sezione delle macchine | 1 (dettaglio), 2 (due blocchi) |
| Due blocchi coi colori del marchio | 2 |
| Un import per blocco, provenienza implicita | 2 |
| Impianto multilingua senza librerie | 3 |
| Selettore in alto a destra, scelta ricordata | 3 |
| Ricaduta sull'italiano per chiave mancante | 3 |
| Traduzione delle sezioni | 4 |
| Traduzione della finestra di import | 5 |
| Messaggi comuni del server tradotti via codice | 5 |
| Dati dell'operatore non tradotti | 4, 5 (verifica esplicita) |

**Punti annotati durante la stesura:**

- La funzione di ricerca sta in `public/` ma e' testata caricando il file vero in una sandbox: e' l'unico modo di avere test veri su codice che gira nel browser, dato che la suite del progetto copre solo `lib/*.test.js`.
- `renderMacchinari` e' asincrona e ricarica dal server: le funzioni di filtro non devono richiamarla, altrimenti ogni carattere digitato diventa una chiamata di rete. Il Task 2 lo dice esplicitamente perche' e' l'errore piu' facile da commettere qui.
- I motivi di scarto prodotti dal classificatore restano in italiano anche a lingua cambiata: tradurli richiederebbe un codice per ciascuno. E' un limite noto, dichiarato nel Task 5.
- Il selettore fissato in alto a destra puo' sovrapporsi ai comandi di pagina: il Task 3 riserva spazio con `padding-right` su `.page-header`, e la verifica lo controlla.
