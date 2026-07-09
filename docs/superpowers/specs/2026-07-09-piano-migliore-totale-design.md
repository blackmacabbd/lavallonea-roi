# Design — Piano MYLAV più conveniente sul totale degli esami

Data: 2026-07-09
Contesto: nel Calcolatore ROI esiste `pianoMigliorePerEsame(db, esame)` (`lib/piani.js`) + rotta `GET /api/piani/consiglio` + banner `mostraConsiglioPiano(esame)` (`public/app.js`), che suggerisce il piano più conveniente per **un solo** esame (l'ultimo digitato). Con più esami in tabella (fino a ~10) il consiglio è fuorviante: non dice quale piano conviene sul totale.

## Obiettivo

Suggerire, dal vivo, quale **singolo piano MYLAV attivo** minimizza il **totale** del prezzo Mylav su **tutti** gli esami correntemente in tabella, tenendo conto della quantità (colonna "N.") di ogni riga.

## Decisioni prese in fase di brainstorming

- **Trigger/UI**: banner automatico live, in basso a destra, che si aggiorna a ogni aggiunta/modifica esame (riusa il pattern del banner consiglio esistente). **Sostituisce** il consiglio per-singolo-esame (niente due banner verdi).
- **Prezzo mancante**: se un piano non prezza un esame, si usa il prezzo base (`base_fallback`) — stessa logica di `resolvePrezzo`/`pianoMigliorePerEsame`. Così ogni piano ha un totale completo e confrontabile.
- **Quantità**: il totale usa `prezzo × n_esami` per riga (il consiglio attuale ignora la quantità).
- **Esami sconosciuti** (`fonte: 'assente'`, mai visti né come base né come custom): esclusi dal totale, conteggiati come "saltati".

## Sezione 1 — Backend (`lib/piani.js` + `server.js`)

Nuova funzione in `lib/piani.js`:

```
pianoMiglioreTotale(db, esami) -> { pianoId, pianoNome, totale, nEsami, nSaltati } | null
```
dove `esami = [{ nome, n }]` (`n` = quantità, default 1).

Algoritmo:
- Per ogni piano attivo (`piani_sconto WHERE attivo = 1`):
  - Per ogni esame: `r = resolvePrezzo(db, pianoId, nome)`. Se `r.fonte` è `piano`/`custom`/`base_fallback` → somma `r.prezzo × (n||1)`. Se `assente` → non sommare (conteggia come saltato).
  - Il piano ha un `totale`.
- Restituisce il piano col `totale` minimo, con `nEsami` (esami validi considerati) e `nSaltati` (sconosciuti). Se nessun esame valido → `null`.
- A parità di totale vince il primo per `ordine` (stessa query ordinata già usata altrove).

Riuso di `resolvePrezzo` (già esistente e testato). Nessuna query nuova complessa: itera piani attivi × esami (piccoli numeri: ~60 piani × ~10 esami).

Nuova rotta in `server.js`:
```
POST /api/piani/consiglio-totale   body { esami: [{ nome, n }] }  -> pianoMiglioreTotale(...) | null
```
`express.json()`. Valida che `esami` sia un array; filtra righe senza nome.

## Sezione 2 — Frontend (`public/app.js`)

- Nuova `mostraConsiglioTotale()`:
  - Raccoglie da `S.roi.righe` (via `getRoiRigheValide()` / lettura DOM) le righe con nome esame non vuoto → `[{ nome, n }]`.
  - Se 0 esami validi → nasconde il banner (`roi-consiglio-banner`) e ritorna.
  - `POST /api/piani/consiglio-totale`. Se `null` → nasconde.
  - Mostra nel banner `roi-consiglio-banner`:
    - se il piano consigliato è **già** `S.roi.pianoId`: `✓ Stai già usando il piano più conveniente per questi N esami: <nome> (€ totale)`.
    - altrimenti: `💡 Per questi N esami conviene <nome> — € totale` + (se un piano è selezionato) una riga `Risparmi € Z rispetto a <piano attuale>` calcolata confrontando i due totali; sotto, `Clicca per selezionare questo piano`.
    - se `nSaltati > 0`, aggiungi in piccolo: `(N esami non a listino esclusi)`.
  - Click sul banner (quando il piano consigliato ≠ attuale) → `selezionaPiano(pianoId)` (comportamento già esistente). Pulsante `×` per chiudere.
- Sostituzione: le chiamate a `mostraConsiglioPiano(esame)` in `aggiornaPrezziAutomatici` vengono rimpiazzate da `mostraConsiglioTotale()`. La funzione `mostraConsiglioPiano` e la rotta `GET /api/piani/consiglio`/`pianoMigliorePerEsame` restano nel codice ma non più usate dal calcolatore (rimozione non necessaria per questa feature; si può ripulire separatamente).
- Per calcolare "Risparmi € Z rispetto al piano attuale" serve anche il totale del piano attualmente selezionato: la rotta restituisce solo il migliore. Soluzione: la risposta include anche `totaleAttuale` se il client passa `pianoIdAttuale` nel body (opzionale). → estendo il body a `{ esami, pianoIdAttuale }` e la risposta a `{ ...migliore, totaleAttuale }` (null se nessun piano attuale). Così un solo round-trip.

## Sezione 3 — Test

In `lib/piani.test.js` (node:test), per `pianoMiglioreTotale`:
- sceglie il piano col totale minimo su 2+ esami (non solo sul primo);
- rispetta la quantità (`n`): un esame con `n=3` pesa il triplo;
- usa `base_fallback` per esami non prezzati da un piano;
- salta gli esami sconosciuti e li conta in `nSaltati`;
- ritorna `null` se nessun esame valido;
- ignora i piani disattivati.

Il frontend (`mostraConsiglioTotale`) si verifica end-to-end in browser (nessun harness JS lato client).

## Compatibilità e vincoli

- Nessuna modifica a schema DB. Riuso `resolvePrezzo`.
- Nessuna nuova dipendenza. Testo UI in italiano. Niente AI.
- Il banner riusa `roi-consiglio-banner` (posizione/stile esistenti); nessun nuovo elemento DOM.
- `pianoMigliorePerEsame` e `GET /api/piani/consiglio` restano invariati (non rimossi).
