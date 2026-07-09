# Import listino concorrente da PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere l'import di un listino concorrente da PDF nella Gestione concorrenti: estrazione automatica best-effort di esami + prezzo, revisione/correzione, salvataggio nel catalogo concorrenti esistente.

**Architecture:** Nuovo modulo `lib/pdfimport.js` (estrazione testo con `pdf-parse` + parser a blocchi puro e testabile). Due rotte in `server.js` (anteprima + conferma) che riusano `concorrenti.upsertConcorrente`. UI nel pannello Gestione concorrenti che riusa il pattern preview/conferma dell'import Excel. Nessun cambio schema; matching ROI invariato.

**Tech Stack:** Node.js, Express, `pdf-parse@1.1.1`, `multer` (già presente), `node:sqlite`, vanilla JS/CSS, `node:test`/`node:assert`.

## Global Constraints

- Nuova dipendenza: **`pdf-parse@1.1.1`** (NON la 2.x — API diversa). API: `const pdf = require('pdf-parse'); const data = await pdf(buffer); data.text`. Richiederla normalmente (mai come `main`).
- Prezzo estratto = "Prezzo Vet. (IVA escl.)" = **primo** dei due importi incollati. `sconto` sempre `null` (inserito a mano nel ROI come oggi).
- Nessun cambio allo schema `concorrenti`/`esami_concorrente`: si riusa `concorrenti.upsertConcorrente(db, nomeConcorrente, righe)` con `righe = [{ nome_originale, prezzo, sconto }]`.
- Import Excel, matching (`trovaMatch`), calcolo ROI, tema: **invariati**.
- Niente AI/servizi esterni. Testo UI in italiano.
- Test backend con `node:test`/`node:assert` in `lib/*.test.js`, via `npm test` (`node --test lib/*.test.js`).
- Regex prezzo IT: `\d{1,3}(?:\.\d{3})*,\d{2}`. Riga-prezzo: due importi incollati + codice maiuscolo in coda: `/(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})([A-Z][A-Z0-9]*)\s*$/`.

---

### Task 1: `lib/pdfimport.js` — estrazione + parser a blocchi

**Files:**
- Modify: `package.json` (dipendenza `pdf-parse`)
- Create: `lib/pdfimport.js`
- Create: `lib/pdfimport.test.js`

**Interfaces:**
- Consumes: `pdf-parse` (nuova dip).
- Produces: `parseRigheDaTesto(testo)` → `{ righe: [{ nome_originale, prezzo, code }], scartate: number }`; `estraiTestoPdf(buffer)` → `Promise<string>`. Task 2 chiama entrambe.

- [ ] **Step 1: Installa la dipendenza**

Run: `npm install pdf-parse@1.1.1 --no-audit --no-fund`
Expected: `package.json` mostra `"pdf-parse": "1.1.1"` in dependencies; nessun errore.

- [ ] **Step 2: Scrivi i test (RED)**

Crea `lib/pdfimport.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRigheDaTesto } = require('./pdfimport.js');

// Testo che imita l'output reale di pdf-parse sul listino IDEXX:
// nome su una riga, descrizione/materiale in mezzo, riga-prezzo coi due importi incollati + codice.
const TESTO = [
  'Profili di Routine Cane e Gatto (possono essere integrati con Add-on)',
  'Check-up completo (cane, gatto) Il nostro profilo più',
  'Quadro ematico completo, urea-N (BUN), creatinina, IDEXX',
  '1 ml siero + 1 – 2 ml',
  'sangue EDTA',
  'in giornata53,5091,38GCUPI',
  'Check-up (cane, gatto)',
  'Check-up completo (comprensivo di IDEXX SDMA), senza',
  'quadro ematico',
  '1 ml sieroin giornata47,7081,47CUPI',
  'Esame  Materiale  Tempi',
  'in giornata12,5021,35GALLS'
].join('\n');

test('parseRigheDaTesto associa nome->prezzo e prende il prezzo Vet (primo)', () => {
  const { righe } = parseRigheDaTesto(TESTO);
  assert.equal(righe.length, 2);
  assert.deepEqual(righe[0], { nome_originale: 'Check-up completo (cane, gatto) Il nostro profilo più', prezzo: 53.50, code: 'GCUPI' });
  assert.deepEqual(righe[1], { nome_originale: 'Check-up (cane, gatto)', prezzo: 47.70, code: 'CUPI' });
});

test('parseRigheDaTesto non usa le intestazioni come nome e conta le righe-prezzo orfane', () => {
  const { righe, scartate } = parseRigheDaTesto(TESTO);
  // la riga "in giornata12,5021,35GALLS" e' preceduta solo dall'intestazione "Esame Materiale Tempi"
  assert.ok(!righe.some(r => /GALLS/.test(r.code)));
  assert.equal(scartate, 1);
});

test('parseRigheDaTesto parsa i migliaia IT e i prezzi a 3 cifre incollati', () => {
  const testo = ['Esame istologico complesso', 'in giornata1.234,50115,29ISTX'].join('\n');
  const { righe } = parseRigheDaTesto(testo);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 1234.50);
  assert.equal(righe[0].code, 'ISTX');
});

test('parseRigheDaTesto scarta nomi troppo corti (< 3 char)', () => {
  const testo = ['AB', 'in giornata10,0012,00XYZ'].join('\n');
  const { righe, scartate } = parseRigheDaTesto(testo);
  assert.equal(righe.length, 0);
  assert.equal(scartate, 1);
});

test('parseRigheDaTesto: testo vuoto -> nessuna riga', () => {
  assert.deepEqual(parseRigheDaTesto(''), { righe: [], scartate: 0 });
});
```

- [ ] **Step 3: Esegui i test (verifica RED)**

Run: `node --test lib/pdfimport.test.js`
Expected: FAIL — `Cannot find module './pdfimport.js'`

- [ ] **Step 4: Implementa `lib/pdfimport.js` (GREEN)**

```javascript
'use strict';
const pdf = require('pdf-parse');

const PREZZO = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`;
const RIGA_PREZZO = new RegExp(`(${PREZZO})(${PREZZO})([A-Z][A-Z0-9]*)\\s*$`);

// Prefissi di intestazione/rumore: mai usati come nome esame.
const INTESTAZIONI = [
  'profili', 'test o profili', 'esame', 'materiale', 'tutti i prezzi',
  'listino prezzi', 'indice', 'idexx laboratorio', 'idexx gli analizzatori'
];

function isIntestazione(riga) {
  const r = riga.toLowerCase();
  return INTESTAZIONI.some(p => r.startsWith(p));
}

function toNum(s) {
  return parseFloat(s.replace(/\./g, '').replace(',', '.'));
}

// Parser a blocchi: il nome e' la prima riga del blocco, la riga-prezzo lo chiude.
function parseRigheDaTesto(testo) {
  const lines = String(testo || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const righe = [];
  let scartate = 0;
  let nome = null;

  for (const line of lines) {
    const m = line.match(RIGA_PREZZO);
    if (m) {
      if (nome && nome.length >= 3 && !isIntestazione(nome)) {
        righe.push({ nome_originale: nome.replace(/\s+/g, ' ').trim(), prezzo: toNum(m[1]), code: m[3] });
      } else {
        scartate++;
      }
      nome = null;
    } else if (nome === null && !isIntestazione(line)) {
      nome = line; // prima riga del blocco = nome candidato
    }
    // altrimenti: descrizione/materiale/intestazione -> ignora
  }

  return { righe, scartate };
}

async function estraiTestoPdf(buffer) {
  const data = await pdf(buffer);
  return data.text;
}

module.exports = { parseRigheDaTesto, estraiTestoPdf };
```

- [ ] **Step 5: Esegui i test (verifica GREEN) + suite intera**

Run: `node --test lib/pdfimport.test.js` → Expected: PASS (5 test)
Run: `npm test` → Expected: PASS su tutta la suite (39 test piani/concorrenti esistenti + 5 nuovi = 44), nessuna regressione, output pulito (a parte il warning atteso `ExperimentalWarning: SQLite`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/pdfimport.js lib/pdfimport.test.js
git commit -m "feat(pdf): estrazione testo + parser a blocchi listino concorrente PDF"
```

---

### Task 2: `server.js` — rotte import PDF (anteprima + conferma)

**Files:**
- Modify: `server.js` (require, istanza multer PDF, due rotte dopo le rotte `/api/concorrenti/*` esistenti)

**Interfaces:**
- Consumes: `pdfimport.estraiTestoPdf`, `pdfimport.parseRigheDaTesto` (Task 1); `concorrenti.upsertConcorrente` (già esistente, firma `(db, nomeConcorrente, righe)` con `righe=[{nome_originale,prezzo,sconto}]`); `multer`, `fs`, `express` già presenti.
- Produces: `POST /api/concorrenti/import-pdf` → `{ righe, scartate }`; `POST /api/concorrenti/import-pdf/conferma` → `{ success, concorrenteId, righeSalvate }`. Consumate dal Task 3.

- [ ] **Step 1: Aggiungi il require del nuovo modulo**

Vicino agli altri require in cima a `server.js` (dopo `const concorrenti = require('./lib/concorrenti');`):

```javascript
const pdfimport = require('./lib/pdfimport');
```

- [ ] **Step 2: Aggiungi l'istanza multer per i PDF**

Subito dopo la definizione dell'`upload` multer esistente (quella con `fileFilter` per `.xlsx?`):

```javascript
const uploadPdf = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Solo file PDF'));
  }
});
```

- [ ] **Step 3: Aggiungi le due rotte**

Dopo le rotte `/api/concorrenti/...` già presenti (es. dopo `POST /api/concorrenti/:id/rimuovi-match`):

```javascript
app.post('/api/concorrenti/import-pdf', uploadPdf.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const testo = await pdfimport.estraiTestoPdf(buf);
    const parsed = pdfimport.parseRigheDaTesto(testo);
    fs.unlinkSync(req.file.path);
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/concorrenti/import-pdf/conferma', express.json({ limit: '5mb' }), (req, res) => {
  try {
    const { nomeConcorrente, righe } = req.body || {};
    if (!nomeConcorrente || !Array.isArray(righe)) {
      return res.status(400).json({ error: 'Dati mancanti (nomeConcorrente, righe)' });
    }
    const pulite = righe
      .map(r => ({ nome_originale: r.nome_originale, prezzo: Number(r.prezzo) || 0, sconto: null }))
      .filter(r => r.nome_originale && String(r.nome_originale).trim() && r.prezzo > 0);
    const result = concorrenti.upsertConcorrente(db, nomeConcorrente, pulite);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 4: Verifica sintassi + suite**

Run: `node --check server.js` → Expected: nessun output (OK)
Run: `npm test` → Expected: PASS (44 test, nessuna regressione)

- [ ] **Step 5: Verifica manuale con curl (conferma diretta, senza file)**

Avvia `PORT=3099 npm run dev` in un terminale, poi:
```bash
curl -s -X POST http://localhost:3099/api/concorrenti/import-pdf/conferma \
  -H "Content-Type: application/json" \
  -d '{"nomeConcorrente":"IDEXX Test PDF","righe":[{"nome_originale":"Check-up completo","prezzo":53.5},{"nome_originale":"","prezzo":10},{"nome_originale":"Zero prezzo","prezzo":0}]}'
```
Expected: `{"success":true,"concorrenteId":<n>,"righeSalvate":1}` — solo la riga valida salvata (nome vuoto e prezzo 0 scartati).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(pdf): rotte anteprima e conferma import PDF concorrente"
```

---

### Task 3: `public/app.js` — UI import PDF nel pannello Gestione concorrenti

**Files:**
- Modify: `public/app.js` (`renderConcorrentiAdmin` page-actions + 3 nuove funzioni)

**Interfaces:**
- Consumes: `POST /api/concorrenti/import-pdf`, `POST /api/concorrenti/import-pdf/conferma` (Task 2); `api`, `el`, `escHtml`, `loadConcorrenti`, `renderConcorrentiAdmin` già esistenti; contenitore `#concorrente-import-wrap` già presente.
- Produces: `avviaImportPdf(inputEl)`, `renderImportPdfForm(parsed)`, `confermaImportPdf()`.

- [ ] **Step 1: Aggiungi il bottone PDF nelle page-actions**

In `renderConcorrentiAdmin`, sostituisci il blocco `page-actions` (che contiene solo il bottone Excel) con:

```javascript
      <div class="page-actions">
        <label class="btn-outline" for="concorrenti-import-input">📥 Importa listino Excel</label>
        <input type="file" id="concorrenti-import-input" accept=".xlsx,.xls" style="display:none" onchange="avviaImportConcorrente(this)">
        <label class="btn-outline" for="concorrenti-import-pdf">📄 Importa listino PDF</label>
        <input type="file" id="concorrenti-import-pdf" accept=".pdf" style="display:none" onchange="avviaImportPdf(this)">
      </div>
```

- [ ] **Step 2: Aggiungi le tre funzioni**

Dopo `confermaImportConcorrente()` (fine della sezione import Excel), aggiungi:

```javascript
async function avviaImportPdf(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const nomeDefault = file.name.replace(/\.pdf$/i, '');
  const formData = new FormData();
  formData.append('file', file);

  let parsed;
  try {
    const resp = await fetch('/api/concorrenti/import-pdf', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error((await resp.json()).error);
    parsed = await resp.json();
  } catch (e) {
    alert('Errore lettura PDF: ' + e.message);
    inputEl.value = '';
    return;
  }
  inputEl.value = '';

  if (!parsed.righe.length) {
    alert('Nessuna riga con prezzo riconosciuta in questo PDF.');
    return;
  }
  window._importPdfRows = parsed.righe;
  renderImportPdfForm(parsed, nomeDefault);
}

function renderImportPdfForm(parsed, nomeDefault) {
  const wrap = el('concorrente-import-wrap');
  if (!wrap) return;
  const righe = parsed.righe.map((r, i) => `
    <tr>
      <td style="text-align:center"><input type="checkbox" data-pdf-incl="${i}" checked></td>
      <td><input class="roi-input" data-pdf-nome="${i}" value="${escHtml(r.nome_originale)}" style="width:320px"></td>
      <td><input class="roi-input roi-num" data-pdf-prezzo="${i}" value="${r.prezzo}" style="width:90px"></td>
      <td class="td-muted">${escHtml(r.code || '')}</td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="section-card">
      <div class="section-card-title">Revisione import PDF — ${parsed.righe.length} esami rilevati · ${parsed.scartate} righe scartate</div>
      <div style="margin-bottom:12px">
        <label>Nome concorrente<br>
          <input class="roi-input" id="import-pdf-nome" value="${escHtml(nomeDefault || '')}" placeholder="Es. IDEXX 2026" style="width:260px">
        </label>
      </div>
      <div class="table-scroll" style="max-height:420px;overflow-y:auto;margin-bottom:12px">
        <table class="roi-editable-table">
          <thead><tr><th style="width:40px">Incl.</th><th>Nome esame</th><th>Prezzo</th><th>Code</th></tr></thead>
          <tbody>${righe}</tbody>
        </table>
      </div>
      <button class="btn-primary" onclick="confermaImportPdf()">Conferma import</button>
    </div>
  `;
}

async function confermaImportPdf() {
  const nomeConcorrente = el('import-pdf-nome')?.value.trim();
  if (!nomeConcorrente) return alert('Inserisci il nome del concorrente');
  const rows = window._importPdfRows || [];
  const righe = rows
    .map((r, i) => ({
      incl: el('concorrente-import-wrap').querySelector(`[data-pdf-incl="${i}"]`)?.checked,
      nome_originale: el('concorrente-import-wrap').querySelector(`[data-pdf-nome="${i}"]`)?.value.trim(),
      prezzo: parseFloat(el('concorrente-import-wrap').querySelector(`[data-pdf-prezzo="${i}"]`)?.value)
    }))
    .filter(r => r.incl && r.nome_originale && !isNaN(r.prezzo) && r.prezzo > 0)
    .map(r => ({ nome_originale: r.nome_originale, prezzo: r.prezzo, sconto: null }));

  if (!righe.length) return alert('Nessuna riga selezionata valida');

  try {
    await api('/api/concorrenti/import-pdf/conferma', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeConcorrente, righe })
    });
    await loadConcorrenti();
    renderConcorrentiAdmin();
    alert('Import PDF completato.');
  } catch (e) {
    alert('Errore import: ' + e.message);
  }
}
```

- [ ] **Step 3: Verifica sintassi**

Run: `node --check public/app.js` → Expected: nessun output (OK)

- [ ] **Step 4: Verifica manuale nel browser**

Avvia il server, vai su "Gestione concorrenti". Verifica: compare il bottone "📄 Importa listino PDF" accanto a quello Excel. (La verifica end-to-end col PDF reale è il Task 4.)

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(pdf): UI import listino PDF con revisione righe in Gestione concorrenti"
```

---

### Task 4: Verifica end-to-end col PDF reale

**Files:** nessuno (solo verifica manuale nel browser)

**Interfaces:** nessuna nuova — esercita tutto ciò che i Task 1-3 hanno costruito col PDF reale `C:\Users\miche\Downloads\2026_LISTINO PREZZI_Italy.pdf`.

- [ ] **Step 1: Import del PDF reale**

Con il server avviato e il browser su "Gestione concorrenti": clicca "📄 Importa listino PDF", scegli `2026_LISTINO PREZZI_Italy.pdf`. Verifica che compaia la schermata di revisione con molte righe (esami) e un conteggio "righe scartate" plausibile, e che i primi esami noti (es. "Check-up completo…") abbiano un prezzo sensato (Vet. escl.).

- [ ] **Step 2: Correzione + esclusione**

Modifica il nome di una riga (accorcia una coda descrittiva), togli la spunta a una riga palesemente non-esame (se presente), imposta il nome concorrente (es. "IDEXX 2026"), clicca "Conferma import". Verifica l'alert di successo e che il concorrente compaia in lista col numero di esami salvati.

- [ ] **Step 3: Matching nel Calcolatore ROI**

Vai al Calcolatore ROI, seleziona il concorrente "IDEXX 2026" dalla pillola, digita un esame Mylav con nome simile a uno importato e verifica che il match popoli "Listino conc." (match sicuro) o proponga il banner (match incerto) — cioè che i dati PDF si integrino nel confronto esattamente come quelli Excel.

- [ ] **Step 4: Pulizia dati di test (se necessario)**

Se durante la verifica hai creato concorrenti di prova sul DB reale, valuta se rimuoverli. Non esiste endpoint di cancellazione concorrente in questo piano: se serve, concordalo prima di intervenire sul DB.

- [ ] **Step 5: Commit finale (solo se sono stati necessari fix)**

```bash
git add -A
git commit -m "fix(pdf): sistemazioni emerse dalla verifica end-to-end"
```
Se non sono stati necessari fix, salta questo step.
