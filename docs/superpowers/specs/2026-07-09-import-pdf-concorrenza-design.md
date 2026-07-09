# Design — Import listino concorrente da PDF

Data: 2026-07-09
Contesto: la Gestione concorrenti importa oggi solo Excel (`POST /api/concorrenti/import` + `/conferma`, `lib/concorrenti.js`). L'utente vuole caricare anche un PDF listino concorrente (es. `2026_LISTINO PREZZI_Italy.pdf` — IDEXX, ~90 pagine) ed estrarne automaticamente esami + prezzi per il confronto ROI.

## Fattibilità (accertata sul PDF reale con pdf-parse 1.1.1)

Il PDF è IDEXX 2026 Italia, 100 pagine. Estratto con `pdf-parse` (senza layout), il testo NON tiene nome e prezzo sulla stessa riga. La struttura reale di un blocco-esame è:

```
Check-up completo (cane, gatto) Il nostro profilo più   ← riga NOME (con eventuale coda descrittiva)
Quadro ematico completo, urea-N (BUN), ...              ← righe DESCRIZIONE (senza prezzo)
1 ml siero + 1 – 2 ml                                    ← righe MATERIALE
in giornata53,5091,38GCUPI                               ← riga PREZZI: <tempi><prezzoVet><prezzoPropr><CODE>, tutto incollato
```

Cioè: il **nome è la prima riga del blocco**, la **riga-prezzo lo chiude** e contiene i due importi in formato italiano *incollati senza spazio* (`53,50`+`91,38`), a volte preceduti dai "tempi" (`in giornata`, `1 ml siero…`) e seguiti da un codice maiuscolo (`GCUPI`). L'estrazione è quindi **a blocchi** (associazione nome↔prezzo), best-effort, con revisione umana obbligatoria prima del salvataggio. Il nome spesso include una coda descrittiva → l'utente lo rifinisce in revisione.

## Decisioni prese in fase di brainstorming

- **Modello import**: best-effort + revisione (estrazione automatica → tabella editabile dove l'utente corregge/esclude righe → salva). Non 1-click.
- **Prezzo usato**: "Prezzo Vet. (IVA escl.)" come listino concorrente. Nessun cambio schema (campo `prezzo` esistente; `sconto` resta null/manuale — IDEXX non ha colonna sconto).
- **Approccio tecnico**: A — parser JS in-app con `pdf-parse` (pura-JS, deploy-safe su Railway) + euristica a regole. Niente `pdftotext` di sistema (assente su Railway), niente AI/LLM (scartato dall'utente per costi/dipendenza).
- **"Piani"**: IDEXX non ha piani-sconto; ha profili/test già prezzati. L'import produce esami/profili + prezzo, non tariffe a livelli.

## Sezione 1 — Estrazione (`lib/pdfimport.js`, nuovo modulo)

Due funzioni separate, la seconda pura e testabile senza PDF:

- `estraiTestoPdf(buffer)` → `Promise<string>`: usa `pdf-parse` per ottenere il testo grezzo del PDF.
- `parseRigheDaTesto(testo)` → `{ righe: [{ nome_originale, prezzo, code }], scartate: number }`: logica pura, parsing a blocchi, testabile senza PDF.

Costanti:
- Regex prezzo IT: `\d{1,3}(?:\.\d{3})*,\d{2}` (es. `53,50`, `115,29`, `1.234,50`).
- Regex riga-prezzo (i due importi incollati + codice, in coda alla riga): `/(\d{1,3}(?:\.\d{3})*,\d{2})(\d{1,3}(?:\.\d{3})*,\d{2})([A-Z][A-Z0-9]*)\s*$/`. Il codice maiuscolo finale è richiesto (riduce i falsi positivi da numeri nelle descrizioni).
- Prefissi di intestazione/rumore da NON considerare mai come nome (case-insensitive, `startsWith` dopo trim): `Profili`, `Test o Profili`, `Esame`, `Materiale`, `Tutti i prezzi`, `Listino prezzi`, `Indice`, `IDEXX Laboratorio`, `IDEXX Gli analizzatori`.

Algoritmo a blocchi in `parseRigheDaTesto`:
- Dividi il testo in righe, `trim` ciascuna, scarta le vuote.
- Mantieni `bloccoInizioNome = null` (il candidato nome corrente).
- Per ogni riga:
  - Se la riga matcha la regex riga-prezzo → chiudi il blocco: `nome_originale` = `bloccoInizioNome` (se presente e valido), `prezzo` = primo importo convertito (rimuovi `.` migliaia, `,`→`.`), `code` = terzo gruppo. Se `bloccoInizioNome` manca o è troppo corto (< 3 char) o è un prefisso-intestazione → incrementa `scartate` (riga-prezzo orfana), altrimenti aggiungi la riga a `righe`. Poi azzera `bloccoInizioNome = null`.
  - Altrimenti (riga senza prezzo): se `bloccoInizioNome === null` e la riga NON è un prefisso-intestazione → è la prima riga del blocco, imposta `bloccoInizioNome = riga`. Se è un prefisso-intestazione → ignorala (non diventa nome). Se `bloccoInizioNome` è già impostato → è descrizione/materiale, ignorala.
- `code` è informativo (anteprima/debug), non salvato nello schema.
- `scartate` conta le righe-prezzo che non hanno prodotto un esame valido (nome mancante/corto/intestazione).

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

- `lib/pdfimport.test.js` (node:test): testa `parseRigheDaTesto` su un testo-campione multi-riga che imita l'output pdf-parse reale (nome su una riga, descrizione/materiale in mezzo, riga-prezzo coi due importi incollati + codice) — verifica che (a) associ il nome corretto (prima riga del blocco) al prezzo, (b) scarti descrizioni/materiali, (c) NON usi le intestazioni di sezione come nome, (d) parsi i decimali IT incollati e prenda il prezzo Vet (primo), (e) conteggi le righe-prezzo orfane in `scartate`, (f) scarti nomi troppo corti (< 3 char).
- `estraiTestoPdf` non è unit-testata (dipende da pdf-parse + I/O); verificata a mano/end-to-end col PDF reale in browser durante l'implementazione.
- Verifica end-to-end: caricare il PDF reale, controllare che l'anteprima estragga righe plausibili, correggerne una, escluderne una, salvare, e vedere il concorrente in lista + un match nel Calcolatore ROI.

## Compatibilità e vincoli

- **Nuova dipendenza npm**: `pdf-parse@1.1.1` (versione stabile, API `pdf(buffer).then(d => d.text)`; la 2.x ha API diversa — non usarla). Unica eccezione al "no nuove dipendenze", giustificata dalla richiesta esplicita di supporto PDF. Nota: richiedere `require('pdf-parse')` normalmente (mai come modulo `main`), altrimenti la 1.1.1 tenta di leggere un PDF di test interno.
- Schema `concorrenti`/`esami_concorrente` invariato (riuso `upsertConcorrente`).
- Import Excel, matching, calcolo ROI, tema: invariati.
- Nessuna AI/servizio esterno. Testo UI in italiano.
- `estraiTestoPdf` gira in-process: un PDF da ~90 pagine è gestibile; nessun requisito di streaming.
