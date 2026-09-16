# Design — Calcolatore clip: fare in casa o mandare a Mylav

Data: 2026-08-18

La sezione Macchinari viene rimossa e sostituita da un secondo calcolatore,
gemello di quello degli esami, che risponde alla domanda che il veterinario si
pone davvero: **questo esame conviene farlo in casa con la mia clip, o mandarlo
a Mylav?**

## Perche' la logica dei macchinari va via

Costruiva un catalogo separato di analizzatori: righe smistate in una sezione
propria, raggruppate per listino importato, con un confronto fra le proprie
macchine e quelle del concorrente. Confrontava **il prezzo di acquisto degli
analizzatori**, che non e' la decisione che il veterinario prende: lui
l'analizzatore ce l'ha gia', e ogni giorno sceglie se accendere una clip o
riempire una provetta per il laboratorio. Il calcolatore nuovo confronta quella
scelta, ed e' un ragionamento per analisi, non per apparecchiatura.

Da rimuovere: le voci **Macchinari** e **Confronto macchine**, le tabelle
`listini_macchine` e `macchine`, il ramo `macchina` dell'import PDF e il codice
che lo serve (selettore del lato, blocchi blu e rosso, ricerca dei listini).
Nel database ci sono **0 listini e 0 macchine**: non si perde alcun dato.

Resta invece la ricerca tollerante (`public/ricerca.js`): serve ai suggerimenti
del calcolatore nuovo.

## Che cosa sono le clip

Gli analizzatori da banco (IDEXX Catalyst e simili) lavorano con **clip
precaricate**: un supporto che contiene i reagenti di un pannello intero e
restituisce in un colpo solo tutti i valori di quel pannello. Una `Catalyst Chem
17 CLIP` rende ALB, ALB/GLOB, ALKP, ALT, AMYL, BUN, BUN/CREA, Ca, CHOL, CREA,
GGT, GLOB, GLU, LIPA, PHOS, TBIL, TP.

Le clip stanno **gia'** nei listini importati. Dal listino reale in archivio:

| voce | prezzo | pezzi | costo per clip |
|---|---|---|---|
| Catalyst™ Chem 17 CLIP 98-11003-02 12 | 448,50 | 12 | 37,38 |
| Catalyst™ Chem 15 CLIP 98-11004-01 12 | 437,90 | 12 | 36,49 |
| Catalyst™ Chem 10 CLIP 98-11005-01 12 | 303,00 | 12 | 25,25 |
| Catalyst™ Lyte 4 CLIP 98-11009-02 12 | 112,20 | 12 | 9,35 |
| Catalyst™ CORT Cortisolo 99-0020377 6 | 144,00 | 6 | 24,00 |

**Il prezzo e' per confezione e l'ultimo numero del nome e' il numero di pezzi.**
Questo e' il fatto su cui poggia tutto il calcolo: sbagliarlo falserebbe ogni
confronto di un fattore dodici.

## La riga del calcolatore

Gemella di quella degli esami, con le colonne della clip al posto di quelle del
concorrente:

```
CLIP (rosso)                                                    MYLAV (blu)
clip │ N. │ prezzo conf. │ pezzi │ sconto% │ costo clip │ totale │ profilo │ N. │ listino │ piano │ totale │ RISPARMIO
```

- `costo clip = prezzo confezione ÷ pezzi × (1 − sconto/100)`
- `totale clip = costo clip × N`
- Il lato Mylav funziona come nel calcolatore esami: nome con suggerimenti,
  prezzo dal **piano di scontistica** scelto in cima, aggiornato al cambio di
  piano.
- **Ogni campo resta scrivibile a mano.** Gli automatismi riempiono, non
  impongono: un valore digitato dall'operatore non viene mai sovrascritto, come
  gia' avviene nel calcolatore esami.
- I pezzi si leggono dal nome della clip e restano modificabili. Se il nome non
  porta un numero riconoscibile la colonna resta vuota e la riempie l'operatore;
  senza pezzi il costo per clip non si calcola e la riga lo dice, invece di
  mostrare un numero inventato.

Le tre colonne del conto — prezzo confezione, pezzi, costo clip — si leggono
piu' tenui delle altre: sono il passaggio, non la decisione. L'occhio deve
cadere su **costo clip** e **totale**.

## Da dove arrivano le clip

Un **catalogo clip unico per account**: nome, prezzo di confezione, pezzi,
sconto abituale, provenienza. Nessun raggruppamento per listino — il
raggruppamento era parte di cio' che non funzionava nei macchinari.

Due strade per popolarlo, **entrambe con conferma dell'operatore**:

1. **Import PDF dedicato** nella sezione nuova, per un listino di sole clip.
2. **Spunta nella revisione dell'import concorrenti.** Nella finestra di
   revisione che l'operatore gia' percorre riga per riga, le righe che sembrano
   clip arrivano con una casella «e' una clip» gia' segnata. Si conferma tutto
   in un passaggio solo, insieme al resto dell'import.

La scelta della seconda strada e' deliberata: aggiungere un passaggio separato
dopo l'import significherebbe far rivedere due volte gli stessi dati, e la
finestra di revisione esiste proprio per garantire che nulla entri senza che un
umano l'abbia visto. **Niente si sposta da solo**: e' l'errore della logica
vecchia, dove le righe venivano smistate senza che nessuno confermasse.

Le righe spuntate entrano nel catalogo clip **in aggiunta**, senza sparire dal
listino del concorrente: una clip e' una voce di quel listino e resta li'.

Il riconoscimento e' un suggerimento, non un verdetto: si basa sul nome (CLIP,
Chem, Profile, e un numero di pezzi in coda) e puo' sbagliare in entrambi i
versi. Per questo la casella e' modificabile in tutte e due le direzioni.

## Il motore comune

Il calcolatore esami e' circa 1050 righe in `public/app.js`. Copiarlo per farne
un secondo significa che ogni correzione futura va fatta due volte, e una delle
due verra' dimenticata: e' gia' successo in questo progetto con la guardia sui
segnaposto, esistita in due copie finche' una sola delle due controllava il caso
che contava.

Si estrae quindi un motore comune in `public/calcolatore.js`, che tiene cio' che
nei due calcolatori e' **identico**: sincronia fra campi e stato, somma dei
totali, aggiunta e rimozione di righe, Tab sull'ultima riga che ne crea una
nuova, tendina dei suggerimenti, area dei messaggi, salvataggio.

Resta **proprio di ciascun calcolatore**: l'elenco delle colonne, la forma della
riga vuota, il calcolo della riga e dei totali, e la cascata che riempie i campi
quando cambia un nome.

Il vincolo su questa estrazione e' netto: **il calcolatore esami deve
comportarsi esattamente come oggi**, perche' e' lo strumento che il committente
usa davanti ai clienti. L'estrazione precede la costruzione del secondo
calcolatore, e va verificata prima di costruirci sopra.

## Cronologia clip

Voce di menu propria, accanto a Cronologia file, con i calcoli sulle clip in un
elenco tutto loro. I due tipi di calcolo non si mescolano mai: tabelle proprie,
`calcoli_clip` e `righe_calcolo_clip`, senza toccare `dati_foglio`, che resta
degli esami.

Un calcolo salvato conserva i valori come erano al momento del salvataggio —
prezzi, sconti, pezzi — non i riferimenti al catalogo: un listino che cambia
domani non deve riscrivere una trattativa di ieri.

## Quattro lingue

Tutto cio' che si vede passa dal dizionario, in italiano, inglese, francese e
spagnolo, con la convenzione singolare/plurale gia' in uso. In italiano i testi
esistenti restano identici.

## Fuori scope

- **La composizione delle clip.** L'app non sa quali analiti contiene una clip,
  quindi non puo' dire da sola «ti servono tre valori, la clip te ne da'
  diciassette». L'operatore puo' gia' costruire quella riga a mano mettendo tre
  esami sul lato Mylav. Conoscere la composizione e' il passo successivo, da
  fare dopo aver usato il calcolatore sul campo: e' li' che si capira' se serve
  davvero e con quale catalogo.
- Costi dell'analizzatore: ammortamento, manutenzione, controllo qualita', tempo
  del personale. Il committente ha scelto di confrontare prezzo della clip,
  sconti e numero di clip, e nient'altro.
- Traduzione dei documenti PDF generati, come nel resto del progetto.

## Vincoli

- Nessuna dipendenza nuova.
- `npm test` verde a ogni fetta; oggi 212 test.
- **Il calcolatore esami resta identico nel comportamento.**
- In italiano l'interfaccia resta identica a oggi.
- I dati dell'operatore non si traducono e non si alterano mai.
- Palette: rosso il costo che il veterinario sostiene da solo, blu Mylav.
- Il database contiene un account cliente reale: nessuna migrazione distruttiva.
- Nessun push senza richiesta esplicita.

## Fette

1. **Rimozione dei macchinari**: sezioni, tabelle, ramo dell'import, chiavi di
   traduzione rimaste orfane.
2. **Motore comune**: estrazione da `app.js` a `public/calcolatore.js`, col
   calcolatore esami invariato e verificato tale.
3. **Catalogo clip**: tabella, lettura dei pezzi dal nome con i suoi test,
   import PDF dedicato nella sezione nuova.
4. **Riconoscimento nella revisione dell'import concorrenti**, con la casella
   confermabile nei due versi.
5. **Calcolatore clip**: sezione, riga, totali, salvataggio.
6. **Cronologia clip**: voce di menu, elenco, riapertura di un calcolo.
7. **Traduzioni e verifica end-to-end** nelle quattro lingue.
