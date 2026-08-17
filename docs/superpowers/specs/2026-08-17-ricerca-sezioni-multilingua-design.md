# Design — Ricerca intelligente, Macchinari in due sezioni, multilingua

Data: 2026-08-17

Tre richieste del committente, indipendenti fra loro. La terza pesa da sola piu'
delle altre due insieme: l'interfaccia conta circa **284 stringhe** piu' **115
messaggi d'errore** dal server.

## 1. Ricerca intelligente

Una sola funzione condivisa, usata da tutte le sezioni che elencano macchine.

```
cercaCorrisponde(testo, query) -> boolean
```

Comportamento deciso col committente:

- **Accenti e maiuscole ignorati.** «citologico» trova «Esame Citològico».
- **Parole in qualsiasi ordine.** «urine completo» trova «ESAME URINE, PU/CU,
  COMPLETO»: ogni parola digitata deve comparire nel testo, in qualunque
  posizione.
- **Tollerante agli errori di battitura.** «analizatore» trova «Analizzatore».
  La tolleranza cresce con la lunghezza della parola cercata: distanza di
  modifica 1 per parole da 4 a 6 caratteri, 2 da 7 in su, **nessuna tolleranza
  sotto i 4 caratteri**. Su parole corte la tolleranza produrrebbe piu' rumore
  che aiuto: con «TSH» a distanza 1 si troverebbe mezzo listino.

Esplicitamente **non** richiesti e non costruiti: ricerca per prezzo o
provenienza, e ordinamento per pertinenza.

Le barre compaiono in ogni sezione che elenca macchine: una per ciascuna delle
due sezioni di Macchinari (vedi punto 2) e una nel dettaglio di un listino
aperto. La sezione Confronto macchine non elenca macchine ma accoppia scelte,
quindi non ha una barra: se servisse filtrare gli elenchi a tendina si
aggiungera' dopo averlo visto all'uso.

## 2. Macchinari in due sezioni

La pagina si divide in due blocchi, distinti dai colori del marchio, che nel
progetto hanno gia' un significato preciso: **blu `--blue` = Mylav**, **rosso
`--red` = concorrenza**.

| Sezione | Colore | Import |
|---|---|---|
| Le mie macchine | blu | «Importa listino PDF» — provenienza propria, nessuna domanda |
| Macchine della concorrenza | rosso | «Importa listino concorrente» — chiede quale concorrente |

Ogni blocco ha la propria barra di ricerca e la propria tabella di listini. Il
selettore di provenienza nella finestra di import sparisce: la scelta e' ora
implicita nel pulsante premuto, e per la concorrenza resta solo la domanda su
quale concorrente. Un comando che dichiara cosa fa vale piu' di un comando
generico seguito da una domanda.

Aprendo un listino, il dettaglio compare sotto il blocco a cui appartiene.

## 3. Multilingua: italiano, inglese, francese, spagnolo

### Impianto

Nuovo file `public/i18n.js`, caricato prima di `app.js`:

```
LINGUE = ['it', 'en', 'fr', 'es']
t(chiave, sostituzioni) -> string
linguaCorrente() -> 'it' | 'en' | 'fr' | 'es'
impostaLingua(codice)
```

- Il dizionario e' un oggetto per lingua, con chiavi descrittive a punti
  (`macchinari.avviso`, `confronto.manca.entrambi`).
- `t` accetta sostituzioni per i numeri e i nomi che compaiono nelle frasi
  (`t('macchinari.listini', { n: 3 })`), cosi' le frasi restano intere in ogni
  lingua invece di essere cucite da pezzi: l'ordine delle parole cambia fra
  lingue e la concatenazione produce frasi sgrammaticate.
- Chiave mancante in una lingua: si ricade sull'italiano, non sulla chiave
  grezza. Un testo nella lingua sbagliata e' un difetto; una chiave a schermo e'
  una rottura.
- La lingua scelta vive in `localStorage`, come il token di sessione. Cambiarla
  ridisegna la pagina corrente senza ricaricare.

### Selettore

Un comando compatto fissato in alto a destra (`position: fixed`), fuori dal
disegno delle pagine: le pagine si ridisegnano continuamente, il selettore no.
Mostra la lingua attiva e apre l'elenco delle quattro.

`.page-header` guadagna uno spazio a destra pari all'ingombro del selettore,
perche' i pulsanti di pagina non gli finiscano sotto.

### Cosa viene tradotto e cosa no

**Tradotto:** menu, titoli, sottotitoli, pulsanti, etichette, intestazioni di
tabella, stati vuoti, avvisi, conferme, e le fasi della finestra di import.

**Non tradotto, mai:** i dati dell'operatore — nomi di esami, macchine,
concorrenti, strutture, piani, e gli importi. Vengono dai suoi PDF e dalle sue
dita: tradurli significherebbe alterare i suoi dati.

**Messaggi dal server:** solo quelli che si incontrano nell'uso normale (circa
venti: dati non validi, risorsa non trovata, PDF illeggibile o scansionato,
conferma di completezza mancante, nome duplicato). Il server aggiunge un
`codice` accanto al testo; il client mostra la traduzione di quel codice e,
se non la trova, il testo del server. Gli altri messaggi restano in italiano:
sono guasti interni che un cliente non vede.

### Qualita' della traduzione

Termini del mestiere, non traduzione parola per parola. Le scelte che valgono
per tutto il dizionario:

| Italiano | Inglese | Francese | Spagnolo |
|---|---|---|---|
| esame | test | analyse | análisis |
| listino | price list | tarif | tarifa |
| analizzatore | analyzer | analyseur | analizador |
| macchinari | equipment | équipements | equipos |
| concorrente | competitor | concurrent | competidor |
| piano di scontistica | discount plan | plan de remises | plan de descuentos |
| struttura | practice | clinique | clínica |
| risparmio | saving | économie | ahorro |
| revisione | review | révision | revisión |

Le traduzioni sono scritte con cura, ma **vanno lette da un madrelingua prima di
mostrarle a un cliente**: e' l'unico punto di questo lavoro che non si puo'
verificare con un test.

## Fuori scope

- Traduzione dei dati dell'operatore.
- Traduzione dei documenti PDF generati (restano in italiano).
- Traduzione dei 95 messaggi d'errore interni.
- Lingua salvata sull'account invece che nel browser.
- Ricerca per prezzo o provenienza, ordinamento per pertinenza.
- Barra di ricerca nella sezione Confronto macchine.

## Fette

1. **Ricerca intelligente**: la funzione `cercaCorrisponde` con i suoi test, e
   la barra nel dettaglio di un listino.
2. **Macchinari in due sezioni**: blocchi blu e rosso, due pulsanti di import,
   una barra di ricerca per blocco, selettore di provenienza rimosso.
3. **Impianto multilingua**: `public/i18n.js`, selettore in alto a destra,
   persistenza, e traduzione di menu, Dashboard e stati comuni.
4. **Traduzione delle sezioni**: Gestione piani, Gestione concorrenti,
   Macchinari, Confronto macchine.
5. **Traduzione della finestra di import** e codici d'errore per i messaggi
   comuni del server.
6. **Verifica end-to-end** nelle quattro lingue.

## Vincoli

- Nessuna dipendenza nuova: nessuna libreria di internazionalizzazione.
- `npm test` verde a ogni fetta.
- Nessuna regressione: in italiano l'applicazione deve restare identica a oggi.
- Palette del marchio: blu Mylav, rosso concorrenza.
- Nessun push senza autorizzazione esplicita.
