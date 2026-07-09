# Design — Tabella classifica piani più convenienti

Data: 2026-07-09
Contesto: nel Calcolatore ROI esiste già `pianoMiglioreTotale` + banner consiglio (`mostraConsiglioTotale`) che indica il singolo piano più conveniente sul totale. L'utente vuole vedere l'elenco completo dei piani ordinati per convenienza, con click per selezionarli.

## Obiettivo

Sotto il Calcolatore ROI mostrare una tabella che, in base agli esami inseriti, elenca i piani MYLAV **ordinati dal più conveniente (spesa minore) al meno**, mostrando solo quelli che costano **meno della concorrenza**. Cliccando una riga il piano viene impostato nel calcolatore.

## Decisioni prese in fase di brainstorming

- **Quali piani**: solo quelli il cui totale Mylav è **inferiore al totale scontato concorrenza** (i "convenienti"), ordinati crescente. Se non c'è un totale concorrenza (nessun prezzo concorrenza inserito), mostra **tutti** i piani attivi ordinati.
- **Aggiornamento**: live, innescato dalla stessa cascata degli altri autofill (aggiunta/modifica esame, cambio piano/concorrente).
- **Interazione**: click su una riga → `selezionaPiano(pianoId)` → il calcolatore ricalcola e la riga corrispondente resta evidenziata.
- **Colori**: brand Mylav (accento blu, testo grafite), coerente col resto.

## Sezione 1 — Backend (`lib/piani.js` + `server.js`)

Nuova funzione in `lib/piani.js`:
```
pianiClassifica(db, esami) -> [{ pianoId, pianoNome, totale, nEsami, nSaltati }]
```
- Per ogni piano attivo (`piani_sconto WHERE attivo = 1`), calcola il totale con `totalePiano(db, pianoId, esami)` (già esistente: prezzo di piano, `base_fallback` per esami non prezzati, salta gli sconosciuti).
- Include solo i piani con `nEsami > 0` (che prezzano almeno un esame valido).
- Ordina per `totale` crescente; a parità, per `pianoNome`.
- Se `esami` vuoto → `[]`.

Riuso di `totalePiano`. Costo: ~60 piani × ~N esami (piccolo).

Nuova rotta in `server.js`:
```
POST /api/piani/classifica   body { esami: [{ nome, n }] }  -> pianiClassifica(...)
```
`express.json()`. Valida `esami` array; filtra righe senza nome.

## Sezione 2 — Frontend (`public/app.js`)

- Contenitore `<div id="roi-classifica">` inserito nella dashboard subito dopo la barra azioni (`buildRoiActionsHtml`), sia nel ramo con dati sia nel ramo vuoto (dove è già presente il calcolatore).
- Nuova `mostraClassificaPiani()`:
  - Raccoglie da `getRoiRigheValide()` `[{nome, n}]`. Se 0 esami → svuota `#roi-classifica` e ritorna.
  - `POST /api/piani/classifica`. Ottiene i piani ordinati.
  - Calcola `totaleConcorrenza = calcolaRoiTotali().tot_prezzo_conc`.
  - Se `totaleConcorrenza > 0`: filtra i piani con `totale < totaleConcorrenza`; ogni riga mostra anche `Risparmio = totaleConcorrenza - totale`.
  - Se `totaleConcorrenza === 0` (nessun prezzo concorrenza): mostra tutti i piani ordinati, senza colonna risparmio.
  - Rende una tabella (`roi-editable-table` riuso, o classe dedicata) con colonne: **Piano · Totale MYLAV · [Risparmio vs concorrenza]**. Riga cliccabile `onclick="selezionaPiano(<id>)"`. La riga del piano attualmente selezionato (`S.roi.pianoId`) è evidenziata (classe `.riga-attiva`, accento blu).
  - Se ci sono esami e `totaleConcorrenza > 0` ma **nessun** piano è sotto la concorrenza → mostra una riga/messaggio "Nessun piano batte la concorrenza per questi esami".
  - Titolo sezione: "Piani più convenienti per questi esami" (stile `section-card-title` brand).
- Chiamata: aggiungere `mostraClassificaPiani()` in coda a `aggiornaPrezziAutomatici` (dove già si chiamano `mostraConsiglioTotale()` e `aggiornaMatchConcorrente(tr)`), così si aggiorna alla stessa cascata. `selezionaPiano` già ri-processa le righe → la classifica si riaggiorna e ri-evidenzia.
- Convivenza col banner consiglio: restano entrambi (il banner = suggerimento rapido in basso a destra; la tabella = elenco completo cliccabile). Nessuna rimozione.

## Sezione 3 — Stile (`public/style.css`)

- `.roi-classifica-card` (section-card con ombra e titolo brand) e `.riga-attiva` (riga evidenziata: sfondo `var(--blue-tint)`, testo `var(--blue)`), coerenti col tema. Righe cliccabili con `cursor:pointer` e hover `var(--blue-tint)`. Nessun colore nuovo fuori dai token esistenti.

## Sezione 4 — Test

- `lib/piani.test.js` per `pianiClassifica`:
  - ordina i piani per totale crescente su più esami;
  - esclude i piani che non prezzano alcun esame (`nEsami===0`) — in pratica tutti prezzano via base_fallback se l'esame è noto, quindi verifica con esame noto che l'ordine sia corretto e con esame sconosciuto che `nSaltati` sia contato;
  - `[]` se nessun esame.
- Il filtro "sotto la concorrenza" e l'evidenziazione sono lato client → verifica end-to-end in browser.

## Compatibilità e vincoli

- Nessun cambio schema. Riuso `totalePiano`. Nessuna nuova dipendenza. Testo UI in italiano. Niente AI.
- Banner consiglio, calcolatore, mappature: invariati.
