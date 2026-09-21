# Design — Quattro sezioni, e le clip appartengono a un laboratorio

Data: 2026-09-21

Due problemi che si risolvono insieme, perche' hanno la stessa causa: **le clip
non sanno di chi sono.**

## I due problemi

**Il mix.** Il catalogo clip e' una lista piatta per account. Con dieci listini
di dieci laboratori diversi, scrivendo «Chem» il calcolatore propone le Chem di
tutti: quella di IDEXX accanto a quella di un altro fornitore, allo stesso
prezzo apparente. L'operatore non ha modo di sapere quale sta scegliendo.

**Il catalogo invisibile.** Le clip entrano solo spuntando la casella durante un
import, e non esiste nessuna schermata per vederle o correggerle. Il listino
reale in archivio contiene **11 righe riconoscibili come clip su 517**, ma il
catalogo e' **vuoto**, perche' quell'import e' stato fatto prima che la casella
esistesse. Scrivendo «Chem 17» il calcolatore cerca in un catalogo vuoto e non
trova niente: e' il bug segnalato dal committente.

## Le quattro sezioni

Il nome dice a chi appartiene la cosa, non come funziona:

| oggi | domani | contenuto |
|---|---|---|
| Gestione piani | **Gestione esami interni** | i piani di scontistica Mylav |
| Gestione concorrenti | **Gestione esami esterni** | listini esami dei laboratori |
| — | **Gestione macchinari interni** | analizzatori che Mylav vende o noleggia |
| — | **Gestione macchinari esterni** | listini clip dei laboratori |

## Un laboratorio, due listini

«IDEXX» esiste **una volta sola**. La tabella `concorrenti` e' gia' l'anagrafica
dei laboratori: resta quella, e guadagna un secondo listino.

- `esami_concorrente` — il listino esami, come oggi
- `clip` — il listino clip, che guadagna una colonna `concorrente_id`

Le due sezioni «esterni» mostrano le due facce dello stesso laboratorio. Un
laboratorio puo' avere solo uno dei due listini, ed e' normale.

**Perche' non una anagrafica per ciascuna sezione:** lo stesso laboratorio
finirebbe scritto «IDEXX» da una parte e «Idexx» dall'altra, e nessuno se ne
accorgerebbe finche' un confronto non desse un risultato assurdo.

**Perche' il listino clip appartiene al laboratorio e non alla struttura:** dieci
veterinari che comprano da IDEXX usano lo stesso listino. Legarlo alla struttura
significherebbe importare dieci volte lo stesso PDF, e aggiornare un prezzo
dieci volte.

### Le clip che esistono gia'

La colonna `concorrente_id` nasce vuota sulle righe esistenti: la migrazione e'
additiva e non tocca nulla. Una clip senza laboratorio compare nel catalogo
sotto **«laboratorio non indicato»**, e da li' si assegna. Nessuna riga sparisce
e nessuna viene attribuita d'ufficio a un laboratorio che l'operatore non ha
scelto.

## Il calcolatore clip

Una colonna **Laboratorio** in cima, accanto alla struttura, come il selettore
del concorrente nel calcolatore esami. Scelto il laboratorio, scrivendo il nome
della clip compaiono **solo le sue**, con la ricerca tollerante agli errori di
battitura gia' in uso.

Senza laboratorio scelto il campo lo chiede, invece di proporre tutto: proporre
tutto e' esattamente il mix da cui nasce questo lavoro.

La **struttura** resta dov'e': e' il cliente per cui si sta calcolando, non il
proprietario del listino.

## Il catalogo diventa visibile

In **Gestione macchinari esterni**, come nelle altre sezioni: l'elenco dei
laboratori, e aprendone uno le sue clip con prezzo di confezione, pezzi e
sconto. Da li' si corregge a mano, si aggiunge e si elimina.

Piu' un comando **«recupera le clip dai listini gia' importati»**: rilegge i
listini esami in archivio, mostra le righe riconosciute come clip e le aggiunge
**dopo conferma**, attribuendole al laboratorio del listino da cui vengono. E'
cosi' che le 11 clip gia' presenti entrano nel catalogo senza reimportare nulla.

Niente si sposta da solo: e' la regola che ha gia' fatto buttare una volta la
logica dei macchinari.

## Gestione macchinari interni

Catalogo degli analizzatori che Mylav vende o noleggia: elenco, import, modifica
a mano.

**Assunzione dichiarata, da correggere se sbagliata:** questo catalogo **non
entra nel calcolo** del calcolatore clip. Li' il lato Mylav e' il piano di
scontistica sugli esami; vendere o noleggiare un analizzatore e' un'altra
trattativa. Se dovesse entrare nel confronto, la struttura cambierebbe e va
detto prima.

## Fuori scope

- **Il bug dell'import PDF** segnalato dal committente: non e' stato descritto,
  e senza sapere cosa succede non si tocca.
- Collegare una struttura al suo laboratorio abituale, per preselezionarlo nel
  calcolatore. Utile, ma si capisce se serve dopo aver usato la colonna.
- Traduzione dei documenti PDF generati, come nel resto del progetto.

## Vincoli

- Nessuna dipendenza nuova.
- `npm test` verde a ogni fetta; oggi **211 test**.
- **Il calcolatore esami resta identico nel comportamento.**
- In italiano l'interfaccia resta identica a oggi per tutto cio' che non viene
  rinominato apposta.
- I dati dell'operatore non si traducono e non si alterano mai.
- Ogni chiave di traduzione in tutte e quattro le lingue.
- **Nessuna migrazione distruttiva:** il database contiene i dati di un account
  cliente reale, e contiene ancora le vecchie tabelle dei macchinari, che hanno
  righe e vanno lasciate dove sono.
- Nessun push senza richiesta esplicita.

## Fette

1. **Rinomina** di Gestione piani e Gestione concorrenti in esami interni ed
   esterni, nelle quattro lingue.
2. **Le clip appartengono a un laboratorio**: colonna `concorrente_id`,
   migrazione additiva, import che la valorizza.
3. **Gestione macchinari esterni**: elenco dei laboratori, catalogo clip
   modificabile, e il recupero dai listini gia' importati.
4. **Colonna Laboratorio nel calcolatore clip**, coi suggerimenti filtrati.
5. **Gestione macchinari interni**: catalogo degli analizzatori Mylav.
6. **Traduzioni e verifica end-to-end** nelle quattro lingue.

---

# Correzione del 2026-09-21, dopo la revisione del committente

Le fette 1-3 sono state costruite su una lettura sbagliata. Il committente ha
chiarito, e qui si registra cio' che cambia. Le fette 4-6 vanno rifatte.

## Cosa avevo capito male

**Le clip entravano solo come spunta dentro l'import degli esami.** Non e' cosi':
**ogni sezione ha il suo import PDF**, esattamente come le due sezioni degli
esami. Si importa un PDF in Gestione macchinari esterni e **quello e' un listino
di macchinari**: tutte le righe col prezzo diventano clip di quel laboratorio.
Chi importa li' sta dichiarando di che listino si tratta, e l'applicazione gli
crede invece di indovinare riga per riga.

**Il laboratorio non e' un selettore in cima al calcolatore, e' una colonna**,
subito dopo la struttura. Si scrive la struttura, si scrive il laboratorio, e da
quel momento la ricerca delle clip pesca **da quel PDF**.

## Le tre strade per popolare il catalogo

Restano tutte e tre, e non si escludono:

1. **Import dedicato** in Gestione macchinari esterni: tutte le righe col prezzo
   diventano clip del laboratorio che si nomina all'import.
2. **Spunta nella revisione dell'import esami**: serve perche' il listino reale
   del committente contiene esami e clip nello stesso PDF, e importarlo due
   volte sarebbe lavoro inutile.
3. **Recupero dai listini gia' importati**: per quelli entrati prima che tutto
   questo esistesse.

## Gestione macchinari interni

Anche questa ha il suo import PDF: e' il listino degli analizzatori che Mylav
vende o noleggia. Non chiede un laboratorio, perche' il laboratorio e' Mylav.

Resta l'assunzione gia' dichiarata e non contestata: **e' un catalogo, non entra
nel calcolo** del calcolatore macchinari, dove il lato Mylav e' il piano di
scontistica sugli esami.

## La colonna nel calcolatore

Ordine delle colonne: **Struttura · Laboratorio conc. · [blocco clip] · [blocco
Mylav] · Risparmio**.

Il campo del laboratorio e' a testo libero con i suggerimenti, come gli altri:
si scrive qualche lettera e compaiono i laboratori che hanno clip in catalogo,
con la ricerca tollerante agli errori di battitura. Quando il nome corrisponde a
un laboratorio esistente, la colonna della clip propone **solo le clip di quel
listino**. Senza laboratorio, il campo della clip lo chiede invece di proporre
tutto: proporre tutto e' il mix da cui nasce questo lavoro.

## Le quattro sezioni si leggono come due coppie

Il progetto usa gia' il colore per dire una cosa vera: **blu `--blue` = Mylav,
rosso `--red` = concorrenza**. Le quattro sezioni ereditano quel codice —
**interni blu, esterni rossi** — invece di essere quattro voci identiche in
fila. Non e' decorazione: e' la stessa informazione che il testo gia' porta,
detta anche dall'occhio, e con un vocabolario che l'operatore conosce gia'
perche' e' quello dei due calcolatori.

Nel calcolatore, la colonna del laboratorio appartiene al lato della
concorrenza e ne prende la tinta: introduce il blocco rosso invece di stare in
un limbo neutro.

## Fette che restano

4. **Import PDF dedicato in Gestione macchinari esterni**, col nome del
   laboratorio chiesto all'import.
5. **Gestione macchinari interni**: sezione, import PDF, catalogo.
6. **Colonna Laboratorio nel calcolatore macchinari**, coi suggerimenti
   filtrati sul listino di quel laboratorio.
7. **Colore delle quattro sezioni, traduzioni e verifica end-to-end.**
