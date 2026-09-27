# Design — Gestione macchinari esterni ed esami esterni, più chiare

Data: 2026-09-27

Due schermate che oggi mostrano più di quello che serve. Il committente le ha
guardate coi dati veri e le trova ridondanti: questo documento dice cosa cambia
e perché.

## Il problema

**Gestione macchinari esterni** ha due elenchi uno sotto l'altro:

- i **laboratori**, uno per riga, con il numero di clip e «Vedi clip». Compaiono
  anche quelli che di clip non ne hanno: «2026_LISTINO PREZZI_Italy 0»,
  «IVET 0», «ivet esami 0»;
- i **listini importati**, uno per file, con «Elimina questo listino».

Le stesse clip si vedono due volte, raggruppate in due modi diversi.

**Gestione esami esterni** mostra anche i laboratori che non hanno nessun
esame, con l'etichetta «solo macchinari, nessun esame». Era voluto: quella
pagina era l'unico posto col pulsante «Elimina», e nascondere quei laboratori
li avrebbe resi impossibili da cancellare (`public/app.js`, commento sopra
`renderConcorrentiAdmin`). Il vincolo cade appena i listini macchinari si
eliminano dalla loro sezione.

## Un difetto trovato preparando il disegno

I listini si raggruppano **solo per nome del file**, e `eliminaGruppoClip`
(`lib/clip.js`) cancella per nome del file **in tutti i laboratori
dell'account**. Se lo stesso file viene caricato per due laboratori, nell'elenco
diventano una riga sola, ed eliminarla li cancella entrambi. Nei dati veri
esistono «IVET», «ivet» e «ivet esami» come laboratori distinti: il caso non è
teorico. La chiave di un listino dev'essere **laboratorio + file**.

## 1 · Gestione macchinari esterni: un elenco solo

Una riga per **listino importato**, cioè per coppia laboratorio + file.

- In evidenza il **nome del laboratorio** dato all'import.
- Sotto, in tono più tenue: il nome del file, la data dell'ultimo import e
  quante clip contiene.
- A destra **«Vedi listino»** ed **«Elimina»**.

L'elenco dei laboratori sparisce. Un laboratorio senza listini non compare,
perché non ha niente da mostrare.

Due listini dello stesso laboratorio — IVET 2026 e IVET 2027 — sono due righe
«IVET», distinte dal file e dalla data. «Vedi listino» apre le clip **di quel
file per quel laboratorio**, non tutte le clip del laboratorio.

Le clip entrate prima che si tenesse traccia del file hanno `file_origine`
nullo: formano una riga per laboratorio, col nome del laboratorio e, al posto
del file, «Importate prima che si tenesse traccia del file». Le clip senza
laboratorio (`concorrente_id` nullo) formano una riga «Laboratorio non
indicato». Entrambe si vedono e si eliminano come le altre: sono l'unico modo di
ripulirle.

La barra di ricerca cerca nel nome del laboratorio **e** nel nome del file.

Ordine: per nome del laboratorio, e a parità di laboratorio dal listino più
recente.

## 2 · Gestione esami esterni: niente righe vuote

Il laboratorio senza esami non compare più, e l'etichetta «solo macchinari,
nessun esame» si toglie insieme alla sua chiave di traduzione nelle quattro
lingue. Il server sa già filtrare (`GET /api/concorrenti?soloConEsami=1`, usato
dal calcolatore esami): la pagina di gestione passa a usarlo.

## 3 · Cosa cancella «Elimina»

Ogni sezione cancella solo il suo. È la scelta del committente, e toglie una
trappola: oggi «Elimina» negli esami esterni cancella il laboratorio con esami
**e** consumabili.

- **Esami esterni**: toglie gli esami di quel laboratorio. I suoi listini
  macchinari restano.
- **Macchinari esterni**: toglie le clip di quel listino, di quel laboratorio.
  Gli esami restano.
- **Un laboratorio che resta vuoto in entrambe le sezioni si elimina da solo.**
  Senza questa regola resterebbe un laboratorio invisibile ovunque, che
  `trovaOCreaConcorrente` continuerebbe a riusare per nome.
- La conferma dice quante righe se ne vanno, e di quale sezione. Non parla più
  delle clip quando si eliminano esami, perché le clip non si toccano più.

La cancellazione e la pulizia del laboratorio vuoto stanno nella **stessa
transazione**: o avvengono entrambe, o nessuna delle due.

«Vuoto» vuol dire **nessun esame e nessuna clip**. Le vecchie tabelle dei
macchinari (`listini_macchine`, `macchine`) non contano: nessuna schermata le
legge più, quindi un laboratorio che ha solo righe lì è vuoto per l'operatore.
Quando il laboratorio sparisce se ne vanno anche quelle, come oggi, prima della
riga del laboratorio, perché hanno una chiave esterna verso di lui.

## Grafica

Stesso vocabolario Mylav delle altre sezioni: la gestione esterna resta sul
rosso della concorrenza (`--red`), nessun colore nuovo. Il nome del laboratorio
è la cosa che l'occhio deve trovare per prima; file, data e numero di clip
stanno sotto, più piccoli e in grigio. «Elimina» resta rosso bordato come negli
esami esterni, così le due sezioni si leggono allo stesso modo.

## Fuori da questo lavoro

- **«IVET» e «ivet» come stesso laboratorio.** Si può fare, ma richiede di
  fondere i doppioni già in archivio, e fondere dati del cliente è una decisione
  a parte.
- **La pulizia dei dati sbagliati già caricati** (per esempio «cdvet» con 1 281
  clip nei macchinari, che è il listino esami caricato lì). Dopo questa modifica
  il committente li vede uno per riga e li elimina lui.

## Vincoli

- Nessuna dipendenza nuova.
- `npm test` verde; oggi **285 test**.
- Nessuna migrazione distruttiva.
- Mai scrivere nell'account del cliente per provare: server di prova su database
  temporaneo.
- Ogni lettura e scrittura filtra per `user_id`.
- In italiano l'interfaccia resta identica per tutto ciò che non viene cambiato
  apposta.
- Ogni chiave di traduzione in tutte e quattro le lingue.
- Un valore dentro un `onclick` passa per due parser: `jsAttr()`.
- Nessun push senza richiesta esplicita.
