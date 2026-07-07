# Design — Confronto intelligente con listini concorrenza

Data: 2026-07-07
Contesto: nel Calcolatore ROI, le colonne "Listino conc." e "Sconto%" sono oggi compilate manualmente esame per esame, sempre facendo riferimento al nome Mylav dell'esame. Ogni concorrente può chiamare lo stesso esame in modo diverso (es. "istologico" vs "esame istopatologico"), rendendo il confronto lento e soggetto a errori.

## Obiettivo

1. Importare il listino di un concorrente da un file Excel ben strutturato (nome esame, prezzo, sconto opzionale), riutilizzabile nel tempo (non un import una tantum per calcolo).
2. Nel Calcolatore ROI, selezionare un concorrente con una pillola ("Concorrente: ... ▾") parallela a "Piano: ... ▾".
3. Quando si sceglie/digita un esame Mylav in una riga, trovare automaticamente l'esame corrispondente nel listino del concorrente selezionato anche se il nome non è identico, e compilare da solo "Listino conc."/"Sconto%".
4. Nessuna dipendenza esterna (no AI/LLM, nessun costo di API): matching basato su confronto testuale (token overlap).

Non tocca: la logica dei piani di scontistica Mylav (`piani_sconto`, `pianoMigliorePerEsame`), che resta indipendente e convive nella stessa riga della tabella ROI.

## Decisioni prese in fase di brainstorming

- **Formato import**: solo Excel per ora (non PDF) — i listini concorrenza arrivano già in questo formato.
- **Matching**: testuale con conferma manuale e memoria permanente della conferma, non AI (nessun abbonamento/API key esistente per questo; costo e complessità aggiuntivi non giustificati per l'uso).
- **Entità concorrente**: catalogo riutilizzabile salvato in DB, non un import legato a un singolo calcolo ROI.
- **Rilevamento colonne**: automatico con conferma/correzione manuale (stesso pattern già usato per `parseFoglio1`/`parsePlatinumGold`), non un formato Excel rigido imposto al concorrente.
- **Momento della conferma mapping**: lazy, solo quando un esame del concorrente serve davvero durante un calcolo ROI — non una revisione forzata riga-per-riga subito dopo l'import.
- **UI nel calcolatore**: nuova pillola "Concorrente: ... ▾" con autofill diretto delle colonne, non una schermata di consultazione separata.

## Schema DB (nuove tabelle)

```sql
CREATE TABLE concorrenti (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT UNIQUE NOT NULL,   -- es. "IDEXX 2026", scelto dall'utente all'import
  data_import  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE esami_concorrente (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  concorrente_id    INTEGER NOT NULL REFERENCES concorrenti(id),
  nome_originale    TEXT NOT NULL,     -- nome esatto come scritto nel loro Excel
  prezzo            REAL NOT NULL,
  sconto            REAL,              -- NULL se il file del concorrente non ha la colonna sconto
  esame_mylav_id    INTEGER REFERENCES esami_riferimento(id),  -- NULL finche' non mappato
  confermato        INTEGER NOT NULL DEFAULT 0,  -- 0 = match automatico non confermato, 1 = confermato dall'utente
  UNIQUE(concorrente_id, nome_originale)
);
```

Motivazione: nessuna tabella di mapping separata — la corrispondenza vive direttamente sulla riga importata (`esame_mylav_id` + `confermato`). Un re-import dello stesso concorrente (listino aggiornato) fa upsert per `nome_originale` normalizzato: aggiorna `prezzo`/`sconto`, non tocca `esame_mylav_id`/`confermato` se già presenti — il lavoro di mappatura già confermato non si perde.

`sconto` nullable copre il caso in cui il file del concorrente non riporti sconti: resta vuoto, l'utente lo inserisce a mano nel Calcolatore ROI come già fa oggi.

## Flusso di import

```
POST /api/concorrenti/import          multipart: file + nome concorrente
  -> parse Excel (stessa libreria già in uso per l'import Excel Mylav)
  -> auto-detect colonne per keyword (stesso approccio di findCol):
       nome esame: "esame"/"test"/"nome"/"descrizione"
       prezzo:     "prezzo"/"listino"/"price"/"€"
       sconto:     "sconto"/"discount"/"%"
  -> risposta: preview righe + colonne rilevate (pattern "Debug Excel" già esistente)

[schermata conferma frontend]
  3 dropdown (Nome esame / Prezzo / Sconto — quest'ultimo con opzione "nessuna colonna sconto"),
  precompilati dalla detection, correggibili dall'utente

POST /api/concorrenti/import/conferma  { nomeConcorrente, mappingColonne, righe }
  -> upsert concorrente (per nome) + upsert esami_concorrente (per nome_originale normalizzato)
```

Nessuna revisione forzata riga-per-riga in questa fase — il matching verso Mylav è lazy (vedi sotto).

## Algoritmo di matching (testuale, no AI)

Per un esame Mylav digitato/selezionato, confronto contro le righe `esami_concorrente` del concorrente selezionato con `esame_mylav_id IS NULL`:

1. **Normalizza** entrambi i nomi: lowercase, rimuovi accenti/punteggiatura, collassa spazi (riuso `norm()` già presente in `lib/piani.js`).
2. **Tokenizza** in parole, rimuovi stopword italiane minime hardcoded ("di", "del", "test", "esame", "e", ecc.).
3. **Score = Jaccard** sui token rimanenti: `|intersezione| / |unione|`.
4. Prendo il candidato con score più alto:
   - **score ≥ 0.6**: match sicuro, autofill silenzioso (nessun banner). `confermato` resta `0` ma la riga è comunque riusata ai giri successivi senza richiedere conferma.
   - **0.3 ≤ score < 0.6**: banner cliccabile di conferma (stesso pattern del "piano più conveniente").
   - **< 0.3**: nessun match, campi vuoti — comportamento identico a oggi.

Soglie tarabili dopo uso reale, non bloccanti per l'implementazione iniziale.

## API nuove

```
POST /api/concorrenti/import                 upload Excel, ritorna preview + colonne rilevate
POST /api/concorrenti/import/conferma        salva/aggiorna catalogo concorrente
GET  /api/concorrenti                        lista concorrenti (id, nome, data_import)
GET  /api/concorrenti/:id                    dettaglio + tutti gli esami importati con stato mapping
GET  /api/concorrenti/:id/match?esame=NOME   { trovato, sicuro, esameConcorrenteId, nomeOriginale, prezzo, sconto }
POST /api/concorrenti/:id/conferma-match     { esameConcorrenteId, esameMylavId } -> imposta esame_mylav_id + confermato=1
```

## Frontend

**Pillola "Concorrente: ... ▾"**: stessa meccanica di "Piano: ... ▾" (ricerca, click per selezionare, stato in `S.roi.concorrenteId`).

**Cascata autofill per riga**, quando concorrente selezionato + esame Mylav scelto/digitato:
1. Chiama `GET /api/concorrenti/:id/match?esame=...`.
2. `trovato && sicuro` → autofill `Listino conc.`/`Sconto%` (`dataset.auto`, non sovrascrive editing manuale già presente — stesso pattern dei prezzi piano).
3. `trovato && !sicuro` → banner cliccabile ("forse corrisponde a 'X' — confermi?"); click chiama `conferma-match` e autofill immediato.
4. `!trovato` → nessuna azione, campi restano editabili a mano come oggi.

**Pannello admin "Gestione concorrenti"** (parallelo a "Gestione piani"): lista concorrenti importati, upload nuovo/aggiorna esistente, tabella esami con stato (mappato/da confermare/non mappato) e correzione manuale di una mappatura errata.

## Compatibilità

- Righe ROI senza concorrente selezionato: comportamento identico a oggi, nessuna regressione.
- Non tocca `piani_sconto`/`pianoMigliorePerEsame` né il flusso di upload Excel Mylav esistente.
- Import ripetuto dello stesso concorrente: upsert non distruttivo (dettagliato sopra).
