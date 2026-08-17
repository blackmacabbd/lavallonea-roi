# Design — Macchinari: riordino per listini e confronto in sezione propria

Data: 2026-08-17
Sostituisce alcune scelte di `2026-08-16-macchinari-analizzatori-design.md`, che resta valido per tutto il resto.

## Perche'

Il modulo Macchinari e' stato costruito e verificato, ma provandolo sono emersi tre
problemi di impostazione, non di codice:

1. **Manca ordine.** La sezione mostra un elenco piatto di macchine, senza dire da
   quale listino vengono. Gestione concorrenti risolve lo stesso problema da tempo,
   con due livelli: prima i concorrenti, poi i loro esami.
2. **Lo smistamento automatico e' piu' rischio che comodita'.** Un listino
   importato in Gestione piani o Gestione concorrenti puo' contenere righe che il
   riconoscimento marca come macchine, e queste finivano nella sezione Macchinari
   senza che l'operatore l'avesse chiesto. Una riga senza prezzo come «Noleggio
   contenitori per trasporto campioni» basta ad aprire per errore una sezione
   macchine e tipizzare male tutte le righe successive: su un listino di
   ottocento righe il danno non e' recuperabile a mano.
3. **Il confronto e' sepolto.** Sta in fondo alla pagina del catalogo, dove non lo
   si trova e non ha lo spazio che merita.

Il modulo non e' mai stato pushato e in produzione non esiste nessuna macchina:
lo schema si puo' ristrutturare senza migrazioni ne' rischio sui dati.

## Decisioni

1. **Le macchine appartengono a un listino**, come gli esami di un concorrente
   appartengono al concorrente. Il listino porta il nome del file importato e la
   provenienza (proprie oppure di un concorrente).
2. **Niente piu' smistamento automatico.** Le macchine entrano solo dalla sezione
   Macchinari. Un import in Gestione piani o Gestione concorrenti torna a
   trattare tutte le righe come esami, esattamente come prima del modulo.
3. **Nella sezione Macchinari si importa solo da PDF.** L'aggiunta a mano resta,
   ma dentro un listino aperto: serve a correggere o completare un import, non a
   creare macchine dal nulla.
4. **Il confronto ha una voce di menu propria**, con la stessa barra di comandi
   del simulatore esami.

## Architettura

### Dati

```sql
CREATE TABLE listini_macchine (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  nome           TEXT    NOT NULL,   -- nome del file importato, modificabile
  concorrente_id INTEGER REFERENCES concorrenti(id),  -- NULL = listino proprio
  data_import    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- macchine perde concorrente_id e guadagna listino_id: la provenienza e' una
-- proprieta' dell'import, non della singola riga, e tenerla in due posti
-- significherebbe poterli far divergere.
CREATE TABLE macchine (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listino_id  INTEGER NOT NULL REFERENCES listini_macchine(id),
  nome        TEXT    NOT NULL,
  prezzo      REAL    NOT NULL,
  note        TEXT,
  UNIQUE(listino_id, nome)
);
```

`macchine` non ha piu' `user_id`: l'appartenenza passa dal listino. Ogni lettura
e scrittura risale al listino per verificare l'account, e le funzioni continuano
a ricevere `userId` come oggi — cambia l'implementazione, non il contratto.

`UNIQUE(listino_id, nome)` sostituisce i due indici parziali precedenti: dentro
un listino un nome compare una volta, ma lo stesso analizzatore puo' stare in
listini diversi (il proprio e quello del concorrente) senza collisioni. Sparisce
cosi' anche il caso che aveva richiesto gli indici parziali.

### Eliminazione

Eliminare un listino elimina le sue macchine, nella stessa transazione. E'
l'operazione che l'operatore chiama «elimina il PDF importato».

`eliminaConcorrente` deve continuare a funzionare: elimina anche i listini
macchine di quel concorrente e le loro macchine.

### Import

`POST /api/import-pdf/analizza` resta com'e'. La conferma cambia:

| destinazione | cosa succede |
|---|---|
| `piano` | tutte le righe valide diventano prezzi base del proprio catalogo |
| `concorrente` | tutte le righe valide diventano esami di quel concorrente |
| `macchina` | si crea un listino macchine e tutte le righe valide diventano sue macchine |

La provenienza del listino si scegli all'import, col selettore «Le mie macchine
oppure un concorrente» gia' presente nella finestra: quella scelta diventa il
`concorrente_id` del listino, e tutte le sue macchine la ereditano. Le righe
aggiunte a mano dentro un listino aperto non ripetono la domanda.

Nessun import scrive piu' in due destinazioni. La risposta perde
`esamiImportati` e `macchineImportate` e torna a un solo conteggio, piu'
`listinoId` quando la destinazione e' `macchina`.

Il campo `tipo` per riga resta prodotto dal classificatore, con un solo scopo:
avvisare, in un import verso Macchinari, quando non viene riconosciuto nessun
analizzatore — segno che quel PDF sembra un listino di esami. L'avviso non
blocca: la scelta resta dell'operatore.

La finestra di revisione torna a una tabella sola, senza i due gruppi e senza il
pulsante di spostamento fra gruppi: non avendo piu' due destinazioni, quel
comando non ha piu' significato.

### Sezione Macchinari, due livelli

**Primo livello** — elenco dei listini importati: nome, provenienza (propria
oppure nome del concorrente), numero di macchine, data. Per ogni riga «Vedi
macchine» ed «Elimina». In testa un solo comando, «Importa listino PDF», e
l'avviso sul perimetro della sezione:

> Carica qui soltanto listini di analizzatori. Ogni riga del file verra'
> importata come macchina, comprese quelle che sembrano esami: se il PDF contiene
> anche prezzi di esami, importalo in Gestione piani o in Gestione concorrenti.

L'avviso dice la conseguenza, non solo la regola: e' cio' che lo rende utile.

**Secondo livello** — le macchine di quel listino, modificabili in riga, con
«+ Aggiungi macchina» (che appartiene al listino aperto) ed eliminazione per
riga. Struttura e comandi identici a `renderConcorrenteDettaglio`.

### Sezione «Confronto macchine»

Voce di menu propria. In testa una barra nello stile del simulatore esami
(`roi-toolbar`): titolo, sottotitolo «Mylav vs concorrenza», e i comandi
«+ Aggiungi riga», «Rimuovi tutto», «Gestisci macchinari» — quest'ultimo porta
alla sezione Macchinari.

Sotto, la tabella di confronto: per riga una macchina propria e una del
concorrente scelte a mano, differenza per riga e totali. Blu quando conviene
Mylav, rosso quando conviene la concorrenza, come nel calcolatore esami.

Quando manca un lato, il messaggio dice quale manca e offre il pulsante che
porta dove si risolve.

Il calcolatore sparisce dalla pagina Macchinari: sta in un posto solo.

## Fuori scope

Restano fuori le cose gia' dichiarate nel disegno precedente (ammortamenti,
costo per test, mappatura automatica o persistente, import Excel), piu':

- rinominare un listino dopo l'import (il nome resta quello del file);
- spostare macchine da un listino a un altro;
- import PDF nella sezione Macchinari con destinazione diversa da un listino
  nuovo (ogni import crea il suo listino).

## Fette

1. **Dati.** `listini_macchine`, `macchine` ristrutturata, funzioni di libreria
   per listini e macchine, eliminazione a cascata, `eliminaConcorrente`
   aggiornata. Test.
2. **Import a una destinazione.** Conferma che crea il listino per `macchina` e
   torna al comportamento precedente per `piano` e `concorrente`; rotte dei
   listini; revisione a tabella singola. Test.
3. **Macchinari a due livelli.** Elenco listini, dettaglio, eliminazione,
   avviso nuovo, aggiunta a mano dentro il listino.
4. **Sezione Confronto macchine.** Voce di menu, barra dei comandi, tabella,
   rimozione del calcolatore da Macchinari.
5. **Verifica end-to-end** sull'intero flusso.

## Vincoli

- Nessuna dipendenza nuova.
- `npm test` verde a ogni fetta.
- Nessuna regressione su Gestione piani e Gestione concorrenti, che tornano al
  comportamento precedente al modulo.
- Ogni lettura e scrittura vincolata all'account autenticato.
- UI in italiano, palette e componenti del marchio MYLAV.
- Nessun push senza autorizzazione esplicita.
