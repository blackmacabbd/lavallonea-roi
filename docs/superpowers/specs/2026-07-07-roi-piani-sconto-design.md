# Design — Piani di scontistica nel Creatore di ROI

Data: 2026-07-07
Contesto: `ROI_REQUISITI_PIANI_SCONTO.md`, `piani_sconto_esami_2026.json` (già presenti nella root del progetto).

## Obiettivo

Nel Calcolatore ROI (sezione manuale in fondo alla Dashboard, `S.roi` in `public/app.js`), aggiungere:
1. Un selettore "Piano di scontistica" (60 opzioni) che applica automaticamente il prezzo scontato Mylav per esame noto.
2. Autocomplete esami esteso (già esiste, va potenziato con lookup prezzo).
3. Gestione esami non noti: inserimento manuale prezzo per la combinazione esame+piano, con memoria persistente.
4. Un pannello di amministrazione per editare/importare i piani (i listini sono annuali).

Non tocca: il flusso di upload Excel (`parseFoglio1`/`parsePlatinumGold`), che resta come oggi. Il piano si applica solo al Calcolatore ROI manuale.

## Decisioni prese in fase di brainstorming

- **Persistenza**: nuove tabelle nello stesso `database.sqlite` già usato dal progetto (non un file JSON separato scrivibile).
- **UI selettore**: opzione C — pillola compatta ("Piano: Nessuno ▾") che al click apre un pannello con campo ricerca + raggruppamento per categoria. Non un `<select>` nativo (il resto della UI del gestionale è già custom).
- **Ambito selettore**: un piano unico per l'intero Calcolatore ROI (non per singolo tab Platinum/Gold/Foglio 1). Cambiare tab non richiede riselezionare il piano.
- **Pannello editing piani**: incluso in questa fase (non rimandato), per gestire il cambio listino annuale senza toccare codice.

## Schema DB (nuove tabelle)

```sql
CREATE TABLE piani_sconto (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT UNIQUE NOT NULL,      -- nome completo incl. anno, es. "GOLD PACK 2026"
  categoria TEXT NOT NULL,             -- esplicita, da mapping statico (sezione 5 del file requisiti), non inferita a runtime dal nome
  anno      INTEGER,                   -- estratto una volta in fase di import, non ri-parsato a runtime
  ordine    INTEGER NOT NULL,          -- posizione in plan_order originale, per ordinamento UI
  attivo    INTEGER NOT NULL DEFAULT 1 -- 0 = nascosto dal selettore (rollover annuale), ma non cancellato
);

CREATE TABLE esami_riferimento (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT UNIQUE NOT NULL,    -- nome canonico, normalizzato con norm() esistente in server.js
  prezzo_base REAL NOT NULL
);

CREATE TABLE prezzi_piano_esame (
  piano_id INTEGER NOT NULL REFERENCES piani_sconto(id),
  esame_id INTEGER NOT NULL REFERENCES esami_riferimento(id),
  prezzo   REAL NOT NULL,
  PRIMARY KEY (piano_id, esame_id)
);

CREATE TABLE prezzi_esami_custom (
  esame_nome       TEXT NOT NULL,      -- normalizzato; puo' non esistere (ancora) in esami_riferimento
  piano_id         INTEGER NOT NULL REFERENCES piani_sconto(id),
  prezzo           REAL NOT NULL,
  data_inserimento DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (esame_nome, piano_id)
);

-- Modifica a tabella esistente (compatibile, nullable):
ALTER TABLE dati_foglio ADD COLUMN piano_id INTEGER REFERENCES piani_sconto(id);
-- Righe esistenti restano NULL = comportamento attuale (nessun piano). Popolata solo per
-- calcoli manuali salvati (/api/calcolo/salva) quando un piano e' selezionato.
```

Motivazione `anno` + `attivo` esplicti (non inferiti dal nome): quando arriva il listino 2027, i nuovi piani si importano come righe nuove; i piani 2026 si disattivano (non si cancellano) così le righe storiche in `dati_foglio.piano_id` restano risolvibili per PDF/export futuri, e il selettore mostra solo i piani attivi.

## Seed

Al boot del server, se `piani_sconto` è vuota: leggo `piani_sconto_esami_2026.json`, popolo le 3 tabelle in una transazione. Idempotente — riavvii successivi non duplicano (check `COUNT(*) = 0` prima di inserire, stesso pattern già usato per la migrazione di `dati_foglio` in `server.js`).

## API nuove

```
GET  /api/piani                              lista piani attivi (id, nome, categoria, ordine)
GET  /api/piani/:id/prezzo?esame=NOME        { prezzo, fonte: 'piano'|'custom'|'base'|'assente' }
POST /api/prezzi-custom                      { esame_nome, piano_id, prezzo } — upsert
GET  /api/esami-riferimento/autocomplete?q=  nomi noti (esami_riferimento UNION DISTINCT esame_nome da prezzi_esami_custom), LIKE %q%

# Pannello admin piani
GET    /api/piani/:id                        dettaglio + tutti i prezzi esame di quel piano
PUT    /api/piani/:id/prezzi                 upsert in blocco prezzi esame per quel piano
PUT    /api/piani/:id/attivo                 { attivo: 0|1 } — nascondi/mostra senza cancellare
POST   /api/piani/import                     carica un JSON nello stesso formato di piani_sconto_esami_2026.json, upsert per nome
```

## Frontend

**Selettore piano** (nuovo componente, stile pillola): in `buildRoiSectionHtml()`, accanto ai tab esistenti. Stato in `S.roi.pianoId` (unico per tutto il calcolatore, non per tab). Al cambio, richiama `aggiornaRigaDOM` su tutte le righe della tabella corrente per ricalcolare.

**Cascata prezzo per riga** (in `aggiornaRigaDOM`, campo `prezzo_scontato_lav`):
1. Piano selezionato + esame in `prezzi_piano_esame` → autofill, badge "🔒 auto" (cliccabile per sovrascrivere manualmente → passa a custom).
2. Piano selezionato + esame in `prezzi_esami_custom` per quel piano → autofill da lì.
3. Piano selezionato + esame sconosciuto per quel piano → campo vuoto/editabile, bordo giallo, hint. Al blur con valore → `POST /api/prezzi-custom`.
4. Nessun piano selezionato → comportamento odierno, invariato (manuale, nessun autofill).

Il campo `listino_lav` si autofill sempre da `esami_riferimento.prezzo_base` quando l'esame è noto, indipendentemente dal piano (dato stabile, non cambia per piano).

**Autocomplete esami**: estende quello esistente (`roiAutocomplete`) includendo anche i nomi da `esami_riferimento` oltre a quelli già visti in `dati_foglio`.

**Normalizzazione**: riuso della funzione `norm()` già presente in `server.js` per ogni confronto/lookup di nomi esame — evita duplicati per differenze di maiuscole/spazi.

**Pannello admin piani**: nuova vista in sidebar (`navigate('piani')`), tabella piani con toggle attivo/disattivo, editing prezzi inline (stile `roi-editable-table` riusato), pulsante "Importa nuovo listino JSON".

## Compatibilità

- ROI esistenti (`dati_foglio` senza `piano_id`): continuano a funzionare identici, nessuna migrazione dei dati storici richiesta.
- Flusso upload Excel: non toccato.
- Se `piani_sconto_esami_2026.json` manca un prezzo per una combinazione esame+piano che dovrebbe esistere: fallback al prezzo base, log console (`console.warn`), nessun blocco operatore.
