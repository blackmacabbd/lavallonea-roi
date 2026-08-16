# Design — Macchinari (analizzatori): riconoscimento, catalogo e confronto

Data: 2026-08-16
Moduli coinvolti: **Import PDF condiviso**, **Gestione piani**, **Gestione concorrenti**, nuovo modulo **Macchinari**.

## Problema

I listini PDF dei fornitori contengono due cose diverse mescolate: i prezzi dei
**singoli esami** e i listini degli **analizzatori** (macchine da laboratorio,
con acquisto, noleggio, bundle con reagenti). Oggi l'import PDF li tratta allo
stesso modo: le macchine finiscono nel catalogo esami, dove non hanno senso e
sporcano il calcolatore.

Serve separarli e poter confrontare le macchine per conto proprio.

Vincolo dichiarato dall'utente: **i PDF sono variabili**. Le macchine non stanno
sempre nelle stesse pagine, e certi documenti sono interamente di analizzatori.
Un intervallo di pagine scelto a mano non basta: la suddivisione dev'essere
automatica.

## Decisioni prese

1. **Il segnale di riconoscimento sono le intestazioni di sezione**, non le
   parole nei nomi delle righe. L'utente ha confermato che nei suoi listini le
   macchine stanno in capitoli propri, introdotti da un titolo. E' il segnale
   piu' affidabile: una parola come "noleggio" puo' comparire in un nome esame,
   una intestazione di sezione no.
2. **Il confronto e' fra le proprie macchine e quelle del concorrente**, come
   gia' avviene per gli esami. Non fra concorrenti diversi, non contro il costo
   di mandare i campioni al laboratorio esterno.
3. **Nessuna logica finanziaria inventata.** Niente ammortamenti ne' costo per
   test proiettato nel tempo: l'operatore accoppia una sua macchina con quella
   del concorrente, il sistema mostra la differenza. "L'utente mappa, il ROI
   esegue".
4. **Un import puo' scrivere in due destinazioni.** Caricando un listino intero
   in Gestione piani, gli esami vanno nel catalogo e le macchine in Macchinari,
   in un solo passaggio di conferma.

## Architettura

### Stadio 2 esteso: il tipo di riga (`lib/pdfclassifica.js`)

La classificazione guadagna un campo per riga:

```
tipo: 'esame' | 'macchina'
```

Come viene deciso:

- Le righe **senza importo**, lunghe al massimo 60 caratteri e senza punto
  finale, sono candidate a intestazione di sezione. I due limiti servono a
  escludere le note in prosa, che nei listini sono lunghe e terminano con un
  punto.
- Una intestazione e' di tipo *macchina* se corrisponde al vocabolario
  `analizzator*`, `strument*`, `apparecchiatur*`, `macchin*`, `noleggi*`,
  `comodato`, `diagnostica strumentale`.
- E' di tipo *esame* se corrisponde a `esam*`, `analisi`, `profil*`,
  `biochimic*`, `ematolog*`, `sierolog*`, `microbiolog*`, `citolog*`,
  `istolog*`, `listino prezzi`.
- Ogni altra intestazione e' neutra e non cambia la sezione corrente.
- Ogni riga con prezzo eredita la sezione aperta sopra di se'.

**Default sicuro:** senza nessuna intestazione riconoscibile, tutte le righe
restano `esame`. I listini che oggi funzionano continuano a funzionare
identici — questa e' la garanzia di non regressione.

Il risultato di `classificaRighe` guadagna i conteggi `esami` e `macchine`.

### Dati (`lib/macchine.js`, nuovo)

```sql
CREATE TABLE macchine (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  concorrente_id INTEGER REFERENCES concorrenti(id),  -- NULL = macchina propria
  nome           TEXT NOT NULL,
  prezzo         REAL NOT NULL,
  note           TEXT,
  data_import    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_macchine_propria ON macchine(user_id, nome)
  WHERE concorrente_id IS NULL;
CREATE UNIQUE INDEX idx_macchine_conc ON macchine(concorrente_id, nome)
  WHERE concorrente_id IS NOT NULL;
```

`concorrente_id IS NULL` distingue le proprie macchine da quelle di un
concorrente: e' cio' che rende possibile il confronto a due lati. Gli indici
parziali riflettono la stessa scelta gia' fatta per il catalogo piani (in
SQLite i NULL sono distinti fra loro in un UNIQUE, quindi un indice unico
normale su `(concorrente_id, nome)` non impedirebbe i duplicati fra le proprie).

Ogni lettura e scrittura e' vincolata a `user_id`, come per piani e concorrenti.

### Import a doppia destinazione (`server.js`)

L'analisi resta una sola chiamata e produce una sola bozza, che ora contiene
righe di entrambi i tipi. La conferma smista:

| destinazione scelta | righe `esame` | righe `macchina` |
|---|---|---|
| `piano` | prezzi base del proprio catalogo | `macchine` con `concorrente_id NULL` |
| `concorrente` | esami di quel concorrente | `macchine` di quel concorrente |
| `macchina` | trattate come macchine, mostrate nell'unico gruppo | `macchine`, lato scelto dall'operatore |

La risposta della conferma riporta separatamente quante righe sono finite in
ciascuna destinazione, e l'audit registra entrambi i numeri.

Per la destinazione `macchina` l'operatore indica se le macchine sono proprie o
di un concorrente (e quale). Se il riconoscimento rileva che il documento e' in
prevalenza esami, il banner **avvisa senza bloccare**: la scelta resta
dell'operatore, coerentemente con il disclaimer della sezione.

### Revisione a due gruppi (`public/importpdf.js`)

La tabella di revisione mostra due blocchi distinti con intestazione — `Esami
(N)` e `Macchine (N)` — entrambi editabili con le funzioni gia' esistenti
(modifica, elimina, aggiungi) e confermati insieme da un'unica spunta.

Ogni riga puo' essere **spostata dall'altro gruppo**: se il riconoscimento
sbaglia, l'operatore corregge senza rifare l'import. Il banner dichiara
esplicitamente dove finira' ciascun gruppo, perche' uno spostamento silenzioso
di dati fra sezioni sarebbe peggio di un errore visibile.

Se un gruppo e' vuoto, il suo blocco non compare.

### Sezione Macchinari (`public/app.js`, `public/style.css`)

Voce di menu propria. La pagina contiene:

- **Disclaimer in evidenza:** «Carica qui solo listini di analizzatori. I
  listini di esami vanno in Gestione piani o Gestione concorrenti.»
- Tabella delle macchine con nome, prezzo, proprieta' (propria / nome
  concorrente), ordinata per prezzo crescente.
- Pulsante di import PDF che riusa il componente condiviso con
  `entita: 'macchina'`.
- Aggiunta e modifica manuale di una riga, per i casi che il PDF non copre.

Palette e componenti sono quelli gia' in uso (`--ink`, `--blue`, `--red`,
`.table-card`, `.btn-outline`): la sezione deve sembrare parte dell'app, non un
innesto.

### Calcolatore macchine

Vive dentro la sezione Macchinari, come secondo blocco sotto la tabella del
catalogo: non e' una voce di menu a se', perche' senza macchine importate non
avrebbe nulla da mostrare. Stessa impostazione visiva del calcolatore esami. Ogni riga
accoppia una macchina propria e una del concorrente, scelte da due elenchi; il
sistema mostra la differenza per riga e i totali:

```
MACCHINA                    MYLAV      CONCORRENTE    DIFFERENZA
Analizzatore biochimico    6.900 €       8.500 €      −1.600 €
Ematologico + reagenti     9.200 €      11.200 €      −2.000 €
TOTALE                    16.100 €      19.700 €      −3.600 €
```

L'accoppiamento e' manuale e vive nel calcolatore: nessuna tabella di
mappatura persistente, nessun algoritmo di somiglianza. E' la scelta
esplicita dell'utente ("l'utente mappa le cose e il ROI esegue") e tiene
fuori un intero sottosistema che non e' stato chiesto.

Il risparmio in rosso quando la macchina propria costa di piu', come gia'
avviene nel calcolatore esami.

## Fuori scope

- Ammortamento, costo per test, punto di pareggio, proiezioni pluriennali.
- Mappatura automatica o persistente fra macchina propria e macchina
  concorrente.
- Import Excel delle macchine (solo PDF e inserimento manuale).
- Riconoscimento basato su parole nel nome della riga o sulla fascia di prezzo:
  scartati come segnali primari perche' fragili. Restano disponibili come
  rinforzo se il segnale delle intestazioni si rivelasse insufficiente sui
  listini reali.

## Piano di attacco a fette

Ogni fetta e' verificabile da sola e viene chiusa prima di aprire la successiva.

1. **Riconoscimento sezioni.** Campo `tipo` in `lib/pdfclassifica.js` piu'
   fixture PDF con entrambe le sezioni. Verifica: un listino solo esami resta
   invariato, un listino misto viene suddiviso, un listino di sole macchine
   viene riconosciuto tale.
2. **Schema e repository.** `lib/macchine.js` con isolamento per account,
   inserimento, elenco, modifica, eliminazione. Verifica: le macchine di un
   account non sono leggibili ne' modificabili da un altro.
3. **Conferma a doppia destinazione.** Rotte di conferma che smistano i due
   gruppi. Verifica: un import in Gestione piani scrive esami nel catalogo e
   macchine in `macchine`, con i conteggi corretti nella risposta e nell'audit.
4. **Revisione a due gruppi.** Blocchi separati nella tabella, spostamento di
   una riga fra i gruppi, banner che dichiara le destinazioni.
5. **Sezione Macchinari.** Pagina, disclaimer, tabella, import dedicato con
   scelta propria/concorrente, aggiunta manuale.
6. **Calcolatore macchine** e verifica end-to-end sull'intero flusso.

## Vincoli

- Nessuna dipendenza nuova.
- `npm test` deve restare verde a ogni fetta.
- Nessuna regressione sui listini di soli esami: senza intestazioni
  riconoscibili il comportamento e' identico a oggi.
- UI in italiano, palette e componenti del marchio MYLAV.
- Nessun push senza autorizzazione esplicita.
