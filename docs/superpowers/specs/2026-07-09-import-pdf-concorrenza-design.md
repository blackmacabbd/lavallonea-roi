# Design — Import listino concorrente da PDF

Data: 2026-07-09
Contesto: la Gestione concorrenti importa oggi solo Excel (`POST /api/concorrenti/import` + `/conferma`, `lib/concorrenti.js`). L'utente vuole caricare anche un PDF listino concorrente (es. `2026_LISTINO PREZZI_Italy.pdf` — IDEXX, ~90 pagine) ed estrarne automaticamente esami + prezzi per il confronto ROI.

## Fattibilità (accertata sul PDF reale)

Il PDF è semi-strutturato. Ogni riga esame ha colonne: `Esame | Materiale | Tempi | Prezzo Vet. (IVA escl.) | Prezzo Propr. (IVA incl.) | Code`. Le righe-prezzo sono riconoscibili perché terminano con due importi in formato italiano (`53,50  91,38`) seguiti da un codice maiuscolo (`GCUPI`). Le righe di descrizione, intestazione di sezione e materiale non hanno questo pattern e vanno scartate. Il nome esame spesso sbrodola nella descrizione sulla stessa riga: l'estrazione è quindi **best-effort**, con revisione umana obbligatoria prima del salvataggio.

## Decisioni prese in fase di brainstorming

- **Modello import**: best-effort + revisione (estrazione automatica → tabella editabile dove l'utente corregge/esclude righe → salva). Non 1-click.
- **Prezzo usato**: "Prezzo Vet. (IVA escl.)" come listino concorrente. Nessun cambio schema (campo `prezzo` esistente; `sconto` resta null/manuale — IDEXX non ha colonna sconto).
- **Approccio tecnico**: A — parser JS in-app con `pdf-parse` (pura-JS, deploy-safe su Railway) + euristica a regole. Niente `pdftotext` di sistema (assente su Railway), niente AI/LLM (scartato dall'utente per costi/dipendenza).
- **"Piani"**: IDEXX non ha piani-sconto; ha profili/test già prezzati. L'import produce esami/profili + prezzo, non tariffe a livelli.

## Sezione 1 — Estrazione (`lib/pdfimport.js`, nuovo modulo)

Due funzioni separate, la seconda pura e testabile senza PDF:

- `estraiTestoPdf(buffer)` → `Promise<string>`: usa `pdf-parse` per ottenere il testo grezzo del PDF.
- `parseRigheDaTesto(testo)` → `{ righe: [{ nome_originale, prezzo, code }], scartate: number }`: logica pura di parsing riga per riga.

Euristica in `parseRigheDaTesto`:
- Regex prezzo IT: `\d{1,3}(?:\.\d{3})*,\d{2}` (es. `53,50`, `1.234,50`).
- Una riga è un esame se contiene, verso la fine, **due** importi consecutivi seguiti (opzionalmente) da un token codice maiuscolo: `(.+?)\s+(PREZZO)\s+(PREZZO)(?:\s+([A-Z0-9]+))?\s*$`.
- `nome_originale` = gruppo 1 (testo prima del primo prezzo), ripulito da spazi multipli.
- `prezzo` = primo importo (Vet. escl.), convertito in numero (`53,50` → `53.50`: rimuovi separatore migliaia `.`, sostituisci `,`→`.`).
- `code` = eventuale token finale (informativo, non salvato nello schema — utile solo in anteprima/debug).
- Righe senza il pattern → conteggiate in `scartate`, non incluse.
- Nomi vuoti o troppo corti (< 3 caratteri) dopo il trim → scartati.

Esporta: `estraiTestoPdf`, `parseRigheDaTesto`.

## Sezione 2 — Backend (`server.js`)

- Multer: nuova istanza `uploadPdf` (o filtro esteso) che accetta `.pdf`. L'`upload` esistente (solo `.xlsx?`) resta invariato per gli altri endpoint.
- `POST /api/concorrenti/import-pdf` (`uploadPdf.single('file')`): legge il file, `estraiTestoPdf` → `parseRigheDaTesto`, cancella il file temporaneo (come `/api/debug`), risponde `{ righe, scartate }`. Nessuna scrittura DB.
- `POST /api/concorrenti/import-pdf/conferma` (`express.json`, limit alto): body `{ nomeConcorrente, righe: [{ nome_originale, prezzo, sconto }] }`. Valida i campi minimi, chiama `concorrenti.upsertConcorrente(db, nomeConcorrente, righe)` (già esistente, accetta esattamente questa forma). Risponde `{ success, concorrenteId, righeSalvate }`.
- Pulizia file temporaneo sia su successo che su errore (`fs.unlinkSync` in try/catch), come il pattern `/api/debug` e `/api/concorrenti/import`.

## Sezione 3 — Frontend (`public/app.js`, pannello Gestione concorrenti)

- In `renderConcorrentiAdmin`, accanto a "📥 Importa listino Excel", aggiungere "📄 Importa listino PDF" (`<input type="file" accept=".pdf">` → `avviaImportPdf(this)`).
- `avviaImportPdf(inputEl)`: `FormData` con il file → `POST /api/concorrenti/import-pdf`. Se `righe` vuoto → alert "Nessuna riga con prezzo riconosciuta nel PDF". Altrimenti salva `window._importPdfRows` e chiama `renderImportPdfForm(parsed)`.
- `renderImportPdfForm(parsed)`: nel `concorrente-import-wrap`, mostra:
  - campo "Nome concorrente" (default suggerito, es. dal nome file senza estensione);
  - nota "`righe.length` esami rilevati · `scartate` righe scartate (senza prezzo)";
  - tabella editabile: per riga una checkbox "includi" (default on), input nome (`nome_originale`), input prezzo, e il `code` come testo grigio di riferimento;
  - bottone "Conferma import".
- `confermaImportPdf()`: raccoglie le righe con checkbox attiva, legge nome/prezzo editati, filtra prezzi non validi, `POST /api/concorrenti/import-pdf/conferma` via `api()` (che lancia su non-ok, coerente col resto del file), poi `loadConcorrenti()` + `renderConcorrentiAdmin()` + alert esito.
- Dopo il salvataggio il concorrente compare in lista e il matching nel Calcolatore ROI funziona identico all'Excel (fuzzy match `trovaMatch` invariato, nessuna modifica).

## Sezione 4 — Test e qualità

- `lib/pdfimport.test.js` (node:test): testa `parseRigheDaTesto` su un testo-campione multi-riga che imita il PDF reale — verifica che (a) rilevi le righe con due prezzi + codice, (b) scarti descrizioni/intestazioni/materiali, (c) parsi correttamente i decimali IT e prenda il prezzo Vet, (d) conteggi le righe scartate, (e) scarti nomi troppo corti.
- `estraiTestoPdf` non è unit-testata (dipende da pdf-parse + I/O); verificata a mano/end-to-end col PDF reale in browser durante l'implementazione.
- Verifica end-to-end: caricare il PDF reale, controllare che l'anteprima estragga righe plausibili, correggerne una, escluderne una, salvare, e vedere il concorrente in lista + un match nel Calcolatore ROI.

## Compatibilità e vincoli

- **Nuova dipendenza npm**: `pdf-parse` (unica eccezione al "no nuove dipendenze"; giustificata dalla richiesta esplicita di supporto PDF).
- Schema `concorrenti`/`esami_concorrente` invariato (riuso `upsertConcorrente`).
- Import Excel, matching, calcolo ROI, tema: invariati.
- Nessuna AI/servizio esterno. Testo UI in italiano.
- `estraiTestoPdf` gira in-process: un PDF da ~90 pagine è gestibile; nessun requisito di streaming.
