# Blocco A — Fix calcolatore riga + PDF unico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La riga del calcolatore si azzera/aggiorna correttamente al cambio del nome esame; la vista file ha un solo pulsante "Resoconto struttura".

**Architecture:** Modifiche mirate al frontend `public/app.js` (cascata prezzi + sync stato riga) e rimozione della vista PDF "completo" da frontend e backend.

**Tech Stack:** Node/Express, `node:sqlite`, frontend vanilla JS, puppeteer (PDF). Verifica live con i preview tools su http://localhost:3000.

## Global Constraints

- Nessuna nuova dipendenza npm.
- Testo UI in italiano.
- Non fare push finché l'utente non lo autorizza.
- Server carica `lib/*` al boot: modifiche a `server.js`/`lib` richiedono `preview_stop` + `preview_start`. Modifiche solo a `public/*` richiedono solo reload.
- Palette brand MYLAV (grafite `#26262a`, blu `#0f76bc`, rosso `#ce181e`).

---

### Task A1: Azzeramento/aggiornamento riga al cambio del nome esame

**Files:**
- Modify: `public/app.js` — funzione `aggiornaPrezziAutomatici` (inizia a riga ~2268) e `initRoiEvents` (riga ~2446+).

**Interfaces:**
- Consumes: `S.roi.righe`, `campoFillabile(inp)`, `aggiornaRigaDOM(tr)`, `mostraConsiglioTotale()`, `mostraClassificaPiani()`, `aggiornaMatchConcorrente(tr)`, `el(id)`.
- Produces: nessuna nuova firma pubblica; comportamento corretto della cascata.

**Contesto del bug:** `aggiornaPrezziAutomatici` fa `const esame = esameInp.value.trim(); if (!esame) return;` — quindi con nome svuotato non azzera nulla, e cambiando nome i valori (specie quelli manuali) restano per via dei guard `campoFillabile`. Serve azzerare i 4 campi prezzo quando l'identità dell'esame cambia, prima della cascata.

- [ ] **Step 1: Snapshot del nome esame a ogni (re)build della tabella**

In `initRoiEvents`, subito dopo `const wrap = el('roi-table-wrap'); if (!wrap) return;` (riga ~2447-2448), aggiungere la sincronizzazione di `dataset.lastEsame` per ogni input esame presente (copre dashboard build, reRender, empty-state):

```javascript
  // Snapshot del nome esame renderizzato: serve a capire quando l'identità cambia.
  wrap.querySelectorAll('[data-col="esame"]').forEach(inp => {
    inp.dataset.lastEsame = (inp.value || '').trim();
  });
```

- [ ] **Step 2: Reset dei prezzi quando il nome esame cambia; gestione nome vuoto**

In `aggiornaPrezziAutomatici`, sostituire il blocco:

```javascript
  if (!esameInp || !llInp || !plInp) return;
  const esame = esameInp.value.trim();
  if (!esame) return;
```

con:

```javascript
  if (!esameInp || !llInp || !plInp) return;
  const esame = esameInp.value.trim();

  // Se l'identità dell'esame è cambiata (nome diverso o svuotato), azzera i prezzi
  // della riga — concorrenza E Mylav, anche i valori inseriti a mano — così la
  // cascata riparte pulita e riflette il nuovo esame.
  const prevEsame = esameInp.dataset.lastEsame || '';
  if (esame !== prevEsame) {
    ['listino_concorrenza', 'sconto_concorrenza', 'listino_lav', 'prezzo_scontato_lav'].forEach(col => {
      const inp = tr.querySelector(`[data-col="${col}"]`);
      if (inp) { inp.value = ''; inp.dataset.auto = '0'; inp.classList.remove('roi-prezzo-nuovo'); inp.title = ''; }
    });
    esameInp.dataset.lastEsame = esame;
    aggiornaRigaDOM(tr);
  }

  if (!esame) {
    // Riga svuotata: nessuna cascata, ma aggiorna totali/consiglio/classifica e nascondi banner match.
    const mb = el('roi-match-banner'); if (mb) mb.style.display = 'none';
    aggiornaRigaDOM(tr);
    mostraConsiglioTotale();
    mostraClassificaPiani();
    return;
  }
```

Il resto della funzione (fetch prezzo base, ramo piano, tail con `aggiornaRigaDOM`/`mostraConsiglioTotale`/`mostraClassificaPiani`/`aggiornaMatchConcorrente`) resta invariato: parte da campi puliti e riempie per il nuovo esame.

- [ ] **Step 3: Controllo sintassi**

Run: `node -c public/app.js`
Expected: nessun output (exit 0).

- [ ] **Step 4: Verifica live nel browser**

Assicurarsi che un server preview sia attivo (`preview_start` name `mylav-roi`, porta 3000). Reload pagina. Nel Calcolatore ROI (dashboard), con il concorrente auto-selezionato:

1. Riga 1: scrivere `esame istologico - 1 organo o 1 nodulo cutaneo`, blur → compaiono i prezzi MYL (listino/piano); se mappato, anche i prezzi concorrenza.
2. Cancellare il nome (svuotare), blur → tutti i campi prezzo della riga tornano vuoti; totale e classifica si aggiornano.
3. Scrivere un esame diverso (es. `profilo leishmaniosi con elisa leishmania (ex profilo 15/b)`), blur → la riga mostra i prezzi del NUOVO esame, senza residui del precedente.
4. Ripetere inserendo a mano un `listino_concorrenza` sul primo esame, poi cambiare esame → il valore manuale sparisce e viene ricalcolato per il nuovo.

Verifica con `preview_eval` leggendo i `value` dei `[data-col]` della riga dopo ogni passo; `preview_console_logs level error` deve essere vuoto.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "fix(roi): la riga si azzera/aggiorna al cambio del nome esame

Cambiando o cancellando il nome esame, i prezzi (concorrenza + Mylav, anche
manuali) vengono azzerati prima della cascata, così la riga riflette sempre
l'esame corrente. lastEsame tracciato per riga."
```

---

### Task A2: Un solo pulsante "Resoconto struttura" (rimozione vista completa)

**Files:**
- Modify: `public/app.js` — `renderFoglio` (bottoni PDF, righe ~400-407) e `downloadPdf` (nome file, riga ~1187).
- Modify: `server.js` — rimuovere rotta `POST /api/pdf/completo/:fileId/:foglio` (righe ~881-897) e funzione `buildHtmlCompleto` (da riga ~800 fino alla sua chiusura, subito prima di `// ── Calcolatore endpoints ──`).

**Interfaces:**
- Consumes: `downloadPdf(fileId, foglio, tipo)` (resta, usata solo con `tipo='dottore'`).
- Produces: nessun riferimento residuo a `completo`.

- [ ] **Step 1: Frontend — un solo pulsante, nuovo nome**

In `renderFoglio` sostituire il blocco dei due bottoni:

```javascript
      <div class="page-actions export-bar">
        <button class="btn-outline" onclick="downloadPdf(${fileId},'${foglio}','dottore')">
          📄 PDF dottore
        </button>
        <button class="btn-outline" onclick="downloadPdf(${fileId},'${foglio}','completo')">
          📄 PDF completo
        </button>
      </div>
```

con:

```javascript
      <div class="page-actions export-bar">
        <button class="btn-outline" onclick="downloadPdf(${fileId},'${foglio}','dottore')">
          📄 Resoconto struttura
        </button>
      </div>
```

- [ ] **Step 2: Backend — rimuovere rotta e builder "completo"**

In `server.js` eliminare per intero la rotta `app.post('/api/pdf/completo/:fileId/:foglio', ...)` (righe ~881-897) e la funzione `function buildHtmlCompleto(...) { ... }` (da riga ~800 fino alla `}` di chiusura che precede il commento `// ── Calcolatore endpoints ──` o la successiva definizione). Non toccare `buildHtmlDottore`, `renderPDF`, la rotta `/api/pdf/dottore`, `chartsSection`, `pdfLegend`, `brandHeader`, `mylavLogo`, `PDF_BRAND_STYLE`.

- [ ] **Step 3: Nessun riferimento residuo**

Run: `grep -rn "completo\|buildHtmlCompleto" server.js public/app.js`
Expected: nessuna riga (o solo occorrenze non correlate al PDF; se compaiono, rimuoverle).

Run: `node -c server.js && node -c public/app.js`
Expected: exit 0.

- [ ] **Step 4: Verifica live**

`preview_stop` + `preview_start` (server.js modificato). Reload. Aprire un file struttura (sidebar → Dr Laterza):
- La barra in alto a destra mostra **un solo** pulsante "Resoconto struttura".
- Click → scarica il PDF dottore brandizzato (verifica via `fetch` POST a `/api/pdf/dottore/<fileId>/<foglio>` con `{}`: status 200, content-type `application/pdf`, magic `%PDF-`).
- `fetch` POST a `/api/pdf/completo/...` → 404 (rotta rimossa).
- `preview_console_logs level error` vuoto.

- [ ] **Step 5: Commit**

```bash
git add public/app.js server.js
git commit -m "feat(pdf): un solo pulsante 'Resoconto struttura', rimossa vista completa

Rimosso il PDF completo (bottone + rotta /api/pdf/completo + buildHtmlCompleto);
'PDF dottore' rinominato in 'Resoconto struttura'."
```

---

## Self-Review

- **Spec coverage:** A1 copre il bug riga (svuota + cambia esame); A2 copre PDF unico + rinomina + rimozione completa. Entrambi i punti del Blocco A dello spec sono coperti.
- **Placeholder scan:** nessun TBD/TODO; tutto il codice è mostrato.
- **Type consistency:** `dataset.lastEsame` usato coerentemente in initRoiEvents e aggiornaPrezziAutomatici; `downloadPdf(fileId,foglio,tipo)` invariata.
