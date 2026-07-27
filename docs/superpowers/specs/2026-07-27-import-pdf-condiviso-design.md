# Design — Import PDF condiviso, guidato e verificabile

Data: 2026-07-27
Moduli coinvolti: **Gestione Piani** (piani personali MyLav) e **Gestione Concorrenti**.

## Contesto e stato di partenza

| | Gestione Piani | Gestione Concorrenti |
|---|---|---|
| Isolamento per account | ✅ fatto (commit `51f70e8`): template `user_id IS NULL` + copia privata per account | ✅ già presente (`concorrenti.user_id`) |
| Import PDF | ❌ assente (solo import JSON) | ⚠️ presente ma minimale |
| Aggiornamento dati | editing prezzi riga per riga sulla propria copia | re-import (Excel/PDF) + mappatura manuale |

L'import PDF esistente (`lib/pdfimport.js`) fa due cose: `estraiTestoPdf` (pdf-parse → testo piatto) e
`parseRigheDaTesto` (euristica riga→{nome, prezzo}). **Limite bloccante:** `pdf-parse` restituisce testo
**senza coordinate**, quindi è impossibile evidenziare sul PDF ciò che è stato riconosciuto.

## Decisioni prese (da confermare solo se si vuole cambiarle)

1. **Nessun OCR.** Si supportano i PDF con testo incorporato (come i listini IDEXX già importati). Un PDF
   solo-immagine viene rifiutato dal banner con motivo esplicito. Motivo: `tesseract.js` peserebbe
   ~50-100MB e alzerebbe CPU/RAM su Railway, che è a consumo.
2. **Una sola dipendenza nuova: `pdfjs-dist`.** Serve comunque per il viewer PDF nel browser, e la stessa
   libreria fornisce l'estrazione **con coordinate** (`page.getTextContent()` → items con `transform`),
   sostituendo `pdf-parse` per il nuovo flusso.
3. **Un unico servizio/componente condiviso**, parametrizzato per entità di destinazione
   (`piano` | `concorrente`) e account proprietario.

## Architettura

### Estrazione in due stadi (separati, per riflettere le fasi nella barra e isolare gli errori)

**Stadio 1 — estrazione grezza posizionale** (`lib/pdfestrazione.js`, nuovo)
```
estraiRigheGrezze(buffer) -> {
  pagine: n,
  righe: [{ pagina, testo, x, y, w, h }]   // y normalizzata top-down
}
```
Raggruppa gli item di testo per riga (tolleranza verticale) e conserva il bounding box: è ciò che permette
l'evidenziazione. Nessuna interpretazione del contenuto in questo stadio.

**Stadio 2 — classificazione** (`lib/pdfclassifica.js`, nuovo)
```
classificaRighe(righeGrezze) -> {
  righe: [{ ...rigaGrezza, nome, prezzo, confidenza: 'alta'|'incerta', scartata: bool, motivo }],
  totaliTabellari: n,      // righe che sembrano tabellari (contengono un importo)
  classificate: n          // righe accettate come esame valido
}
```
Scarta intestazioni, loghi, note legali, numeri di pagina (euristiche già presenti in `isIntestazione`,
da estendere). `confidenza: 'incerta'` quando trova un importo ma il nome è dubbio (troppo corto,
tutto maiuscolo isolato, prezzo anomalo).

### Backend (`server.js`)

Rotte condivise, parametrizzate per entità:
```
POST /api/import-pdf/analizza            (requireAuth, multipart)
     -> { importId, pagine, righe[], totaliTabellari, classificate, confidenzaComplessiva }
POST /api/import-pdf/:importId/conferma  (requireAuth, json)
     body { entita: 'piano'|'concorrente', nome, righe[], confermaCompletezza: true }
     -> salva SOLO se confermaCompletezza === true
```
- L'analisi **non scrive** nulla nel catalogo: il risultato vive in una bozza.
- Nuova tabella `import_bozze` (id, user_id, entita, nome_file, stato `bozza|confermato`, json_righe,
  pagine, totali_tabellari, classificate, created_at) — finché `stato = 'bozza'` il piano **non è pubblicato**.
- Nuova tabella `import_audit` (id, user_id, entita, nome_file, esito, n_righe, data) → log di audit.
- Il salvataggio scrive nella **copia dell'account** (`user_id`), mai nel template.

### Frontend (`public/importpdf.js`, nuovo + `public/app.js` per l'aggancio)

Componente unico riusato dai due moduli.

**Barra di avanzamento a fasi distinte** (non generica):
1. Caricamento del file → 2. Estrazione testo → 3. Riconoscimento esami e pacchetti → 4. Pronto per la revisione.
Con PDF multipagina mostra anche `pagina 3 di 7` durante la fase 2.

**Banner a tre stati** (non binario):
- successo: «Estratti N esami su M righe rilevate»
- da rivedere: «N righe rilevate ma non classificate con sicurezza» + link diretto a quelle righe
- errore: motivo esplicito (es. «PDF senza testo incorporato: serve un PDF non scansionato»)
Più un **indicatore sintetico di confidenza** dell'estrazione.

**Vista affiancata:** PDF a sinistra (scorribile/ingrandibile, reso con `pdfjs-dist`), tabella estratta a
destra. Click su una riga della tabella → il viewer salta alla pagina/posizione corrispondente.

**Evidenziazione sul PDF:** overlay assoluto sopra il canvas, riquadro **verde** per righe riconosciute con
confidenza alta, **giallo** per incerte, **nessuna** evidenziazione per il testo scartato come rumore.

**Tabella di revisione editabile:** nome esame, prezzo/pacchetto, stato di confidenza; l'operatore può
modificare, eliminare, aggiungere righe a mano. Nessun salvataggio automatico.

**Conferma umana obbligatoria:** checkbox/pulsante «Confermo che l'elenco è corretto e completo»,
abilitato solo dopo che la tabella di revisione è stata mostrata. Senza conferma il piano resta in bozza.

### Garanzia di completezza (due livelli, entrambi richiesti)

(a) **Misurazione automatica:** confronto `totaliTabellari` (righe con importo trovate nel PDF grezzo) vs
`classificate` (accettate come esame valido), mostrato nel banner e in testa alla tabella di revisione,
con link alle righe da rivedere nella vista affiancata.

(b) **Conferma umana esplicita:** vedi sopra. Il backend rifiuta il salvataggio senza
`confermaCompletezza === true`.

## Piano di attacco incrementale (fette verticali, ognuna verificabile)

1. `lib/pdfestrazione.js` + test: estrazione posizionale su un PDF reale (usare il listino IDEXX in `uploads/`).
2. `lib/pdfclassifica.js` + test: classificazione a due stadi, conteggi di completezza.
3. Rotte `analizza`/`conferma` + tabelle bozza e audit + test.
4. Frontend: viewer + vista affiancata + evidenziazione.
5. Frontend: barra a fasi, banner a tre stati, tabella di revisione, conferma obbligatoria.
6. Aggancio ai due moduli (piano / concorrente) e verifica E2E su PDF reale.

## Vincoli

- Una sola dipendenza nuova: `pdfjs-dist`. Nessun OCR.
- Il salvataggio va sempre nella copia dell'account; template e altri account intatti.
- UI in italiano, palette brand MYLAV (grafite `#26262a`, blu `#0f76bc`, rosso `#ce181e`).
- `npm test` deve restare verde.
- Nessun push senza autorizzazione esplicita.
