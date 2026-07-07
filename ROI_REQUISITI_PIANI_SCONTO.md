# Requisiti — Piani di scontistica nel "Creatore di ROI"

Questo file descrive nel dettaglio la modifica da apportare al modulo **"Creatore di ROI"**
del gestionale lavallonea.roi: la schermata in cui l'operatore inserisce manualmente la
struttura (clinica veterinaria) e il tipo di esami per generare un ROI.

Va letto insieme al file dati `piani_sconto_esami_2026.json`, che contiene i numeri reali
(esami, prezzi base, prezzo scontato di ciascun esame per ciascuno dei piani).

---

## 1. Contesto — cosa esiste oggi

Nel "Creatore di ROI" l'operatore inserisce a mano:
- la struttura (nome della clinica/cliente)
- una o più righe con il tipo di esame e il relativo prezzo

Oggi il prezzo per esame è presumibilmente il "prezzo base" (listino standard), inserito
manualmente riga per riga. Questo comportamento **deve continuare a funzionare come oggi**
quando l'operatore non seleziona alcun piano di scontistica (retrocompatibilità con i ROI
già creati/salvati).

## 2. Cosa aggiungere

### 2.1 Selettore "Piano di scontistica" in alto a destra

- Posizione: in alto a destra nella schermata del Creatore di ROI.
- Contenuto: la lista dei piani di scontistica applicabili (es. Silver, Gold, Platinum,
  Diamond, Titanium, e le numerose varianti/convenzioni — vedi sezione 5, sono **60 piani**
  reali ad oggi, non solo 3-4).
- Vincolo: lo spazio disponibile in quell'area della UI è limitato. Con 60 opzioni **non è
  praticabile** un elenco di pulsanti o un dropdown semplice non filtrabile: servirebbe una
  soluzione compatta e "intelligente". Proposta (adattabile a quanto già presente nella UI
  esistente):
  - un combobox/select **con ricerca testuale** (l'operatore digita "gold" e vede solo i
    piani che contengono "gold"), **oppure**
  - un select con opzioni raggruppate per categoria (`<optgroup>` o equivalente) secondo la
    categorizzazione proposta nella sezione 5, così l'elenco è navigabile senza dover
    scorrere 60 righe piatte.
  - il nome del piano selezionato può essere troncato con "…" nel campo chiuso, con il nome
    completo visibile al passaggio del mouse (tooltip/title) o quando il menu è aperto.
  - Questa è una proposta, non un vincolo rigido: prima di implementare, chiedere
    conferma/adattarla a quanto già presente nell'header della schermata (vedi step
    "Conversation" nel prompt).
- Cambiare il piano selezionato deve ricalcolare immediatamente i prezzi delle righe esame
  già presenti nel ROI in costruzione (se ci sono righe con esami noti).
- Se non viene selezionato nessun piano, il comportamento resta quello attuale (prezzo base
  inserito manualmente).

### 2.2 Tendina (autocomplete) per il nome dell'esame

- Nel campo dove si inserisce il nome dell'esame per una riga del ROI, mentre l'operatore
  digita deve apparire una tendina con i nomi degli esami noti che corrispondono a quanto
  digitato (match case-insensitive, per sottostringa o per prefisso — usare quanto di più
  semplice si integra con i componenti già presenti nella UI).
- Gli esami "noti" sono quelli elencati nel file `piani_sconto_esami_2026.json`
  (`exams_base_price`), oggi **32 esami**. Questa lista deve poter crescere in futuro:
  quando l'operatore inserisce un esame nuovo con uno sconto manuale (vedi 2.3), quell'esame
  diventa a sua volta selezionabile dalla tendina la volta successiva.
- Selezionare una voce dalla tendina deve inserire il nome **esattamente come salvato a
  sistema** (nome canonico), per garantire che il calcolo automatico del prezzo funzioni
  (evitare mismatch per spazi, maiuscole/minuscole, ecc. — normalizzare/fare trim del testo
  prima di confrontarlo).

### 2.3 Calcolo automatico dello sconto

Quando l'operatore ha selezionato un piano (2.1) e ha scelto/digitato un nome esame (2.2),
il gestionale deve determinare il prezzo da mostrare per quella riga secondo questa logica:

1. **Esame noto + piano selezionato** → il prezzo si compila **automaticamente** leggendo il
   valore corrispondente da `piani_sconto_esami_2026.json` (`plans[nome_piano][nome_esame]`).
   L'operatore non deve inserire nulla a mano in questo caso.
2. **Esame noto ma senza piano selezionato** → si usa il prezzo base
   (`exams_base_price[nome_esame]`), come già oggi.
3. **Esame NON noto (nuovo, non presente nei dati)** → l'operatore inserisce **manualmente**
   il prezzo scontato per il piano attualmente selezionato. Il gestionale deve:
   - salvare in memoria (persistere) la coppia **(nome esame, piano)** → prezzo inserito;
   - da quel momento in poi, ogni volta che nel Creatore di ROI si seleziona quello stesso
     piano e si digita/seleziona quello stesso nome esame, il prezzo deve precompilarsi da
     solo usando il valore salvato, senza richiederlo di nuovo;
   - se in futuro lo stesso esame "nuovo" viene usato con un **piano diverso** per la prima
     volta, va richiesto di nuovo l'inserimento manuale per quella specifica combinazione
     esame+piano (ogni piano ha il suo sconto, non è deducibile da un altro piano);
   - l'esame nuovo, una volta inserito la prima volta, deve comparire nella tendina di
     autocomplete (2.2) per i futuri inserimenti, anche con piani diversi (a quel punto se
     il piano scelto non ha ancora un prezzo salvato per quell'esame, si ripete la richiesta
     di inserimento manuale come sopra).

### 2.4 Compatibilità e casi limite

- Non deve rompersi la creazione/visualizzazione di ROI già esistenti creati prima di questa
  modifica (che non hanno un piano associato).
- Se un esame viene rinominato o scritto in modo leggermente diverso rispetto al nome
  canonico salvato (spazi, maiuscole), va gestito con trim/normalizzazione per evitare di
  creare "duplicati" nella memoria degli sconti manuali.
- Se `piani_sconto_esami_2026.json` non contiene un prezzo per una combinazione
  esame+piano che invece dovrebbe esistere (dato mancante/errore nel file), il
  comportamento di fallback dev'essere: usare il prezzo base e segnalarlo in qualche modo
  (log o indicatore visivo), non bloccare l'operatore.

## 3. Struttura dati di riferimento

Il file `piani_sconto_esami_2026.json` (allegato) contiene:

```json
{
  "exams_base_price": {
    "NOME ESAME": prezzo_base_numero,
    ...
  },
  "plans": {
    "NOME PIANO": {
      "NOME ESAME": prezzo_scontato_numero,
      ...
    },
    ...
  },
  "plan_order": ["NOME PIANO 1", "NOME PIANO 2", ...]
}
```

- `exams_base_price`: 32 esami di riferimento con il prezzo di listino standard (uguale per
  tutti i piani — verificato che non ci sono incongruenze nel file excel di origine).
- `plans`: 60 piani, ciascuno con il prezzo scontato per ciascuno dei 32 esami.
- `plan_order`: ordine "naturale" con cui i piani compaiono nel listino originale (utile per
  mantenere un ordine sensato nella UI, es. prima gli standard, poi le varianti).

Questi dati vanno importati come **dati di partenza/seed** in una struttura persistente
lato backend (tabelle DB, o equivalente a quanto già usato nel gestionale per altri dati di
configurazione) — non vanno lasciati "hardcoded" in un file statico nel frontend, perché:
- i listini sono annuali (si nota "2026" nel nome di ogni piano/esame) e cambieranno;
- gli sconti manuali per esami nuovi (2.3) devono poter essere scritti e letti a runtime.

Proposta di schema (adattare a quanto già in uso nel progetto):
- `piani_sconto` (id, nome)
- `esami_riferimento` (id, nome, prezzo_base)
- `prezzi_piano_esame` (piano_id, esame_id, prezzo) — dati di seed dal JSON
- `prezzi_esami_custom` (nome_esame, piano_id, prezzo, data_inserimento) — memoria degli
  sconti inseriti manualmente per esami non noti

## 4. Elenco dei 32 esami di riferimento (con prezzo base)

- CHECK-UP GERIATRICO con tT4 — 46
- CHECK-UP GERIATRICO con tT4 + SDMA — 52
- PROFILO LEISHMANIOSI CON ELISA LEISHMANIA (ex Profilo 15/B) — 51
- PROFILO LEISHMANIOSI CON ELISA LEISHMANIA (ex Profilo 15/B) + SDMA — 57
- PROFILO LEISHMANIOSI CON IFI LEISHMANIA (ex Profilo 15/A) — 51
- PROFILO LEISHMANIOSI CON IFI LEISHMANIA (ex Profilo 15/A) + SDMA — 57
- PROFILO MYLAV BASE (ex Profilo 1) — 46
- PROFILO MYLAV ESTESO — 64
- PROFILO MYLAV ESTESO CON COAGULATIVO (ex Profilo 3) — 72
- PROFILO MYLAV ESTESO CON URINE (ex Profilo 2) — 71
- PROFILO MYLAV ESTESO CON URINE + SDMA (ex Profilo 2) — 77
- PROFILO MYLAV ESTESO + SDMA — 71
- PROFILO MYLAV GERIATRICO CANE (ex Profilo 16) — 111
- PROFILO MYLAV GERIATRICO CANE (ex Profilo 16) + SDMA — 117
- PROFILO MYLAV GERIATRICO GATTO (ex Profilo 17) — 91
- PROFILO MYLAV GERIATRICO GATTO (ex Profilo 17) + SDMA — 97
- PROFILO MYLAV MAXIMO - CON COAGULATIVO ED URINE (ex Profilo 4) — 109
- PROFILO: PANNELLO COMPLETO PAX AMBIENTALE — 165
- PROFILO: PANNELLO COMPLETO PAX AMBIENTALE + ALIMENTARE — 295
- PROFILO PRE-CHIRURGICO (ex Profilo 5) — 40
- PROFILO RENALE BASE (ex Profilo 6) — 39
- PROFILO RENALE COMPLETO (ex Profilo 7) — 50
- PROFILO SIEROLOGIA CANE 2 MALATTIE DA ZECCHE — 128
- PROFILO TIROIDEO CANE — 58
- PROFILO TIROIDEO GATTO — 38
- ESAME CITOLOGICO - 1 ORGANO o 1 NODULO CUTANEO — 46
- ESAME ISTOLOGICO - 1 ORGANO o 1 NODULO CUTANEO — 60
- LEISHMANIA - ELISA SEMIQUANTITATIVA — 31
- TAMPONE GENERICO COMPLETO CON ATB VET — 55
- tT4 (Total T4) — 24
- URINE — 16
- URINOCOLTURA QUANTITATIVA COMPLETA CON ANTIBIOGRAMMA VET — 55

(Valori completi e definitivi nel file `piani_sconto_esami_2026.json`.)

## 5. Elenco dei 60 piani, con categorizzazione proposta per la UI

Questa categorizzazione è solo una **proposta** per rendere gestibile il selettore
nonostante lo spazio ridotto (vedi 2.1) — verificarla/adattarla in fase di allineamento.

**Pacchetti standard (4)**
SILVER PACK 2026, GOLD PACK 2026, PLATINUM PACK 2026, CVIT PACK 2026

**Pacchetti Diamond (4)**
DIAMOND SILVER PACK 2026, DIAMOND GOLD PACK 2026, DIAMOND PLATINUM PACK 2026,
DIAMOND CVIT PACK 2026

**Pacchetti Titanium (8)**
TITANIUM SILVER PACK 2026, TITANIUM GOLD PACK 2026, TITANIUM CVIT PACK 2026,
TITANIUM PLATINUM PACK 2026, TITANIUM SILVER PACK _ LEISHMANIA 2026,
TITANIUM GOLD PACK _ LEISHMANIA 2026, TITANIUM CVIT PACK _ LEISHMANIA 2026,
TITANIUM PLATINUM PACK _ LEISHMANIA 2026

**Offerta Leishmania (4)**
SILVER PACK OFFERTA LEISHMANIA 2026, GOLD PACK OFFERTA LEISHMANIA 2026,
CVIT PACK OFFERTA LEISHMANIA 2026, PLATINUM PACK OFFERTA LEISHMANIA 2026

**Laboratorio interno vs esterno (8)**
CVIT PACK LABORATORIO INTERNO VS ESTERNO 2026,
PLATINUM PACK LABORATORIO INTERNO VS ESTERNO 2026,
CVIT PACK LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026,
SILVER PACK OFFERTA LABORATORIO INTERNO VS ESTERNO 2026,
GOLD PACK OFFERTA LABORATORIO INTERNO VS ESTERNO 2026,
SILVER PACK OFFERTA LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026,
GOLD PACK OFFERTA LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026,
PLATINUM PACK LABORATORIO INTERNO VS ESTERNO_LEISHMANIA 2026

**Lab interni add-on (8)**
LAB INTERNI ADD ON PLATINUM PACK _ LEISHMANIA 2026, LAB INTERNI ADD ON SILVER PACK 2026,
LAB INTERNI ADD ON GOLD PACK 2026, LAB INTERNI ADD ON CVIT PACK 2026,
LAB INTERNI ADD ON PLATINUM PACK 2026, LAB INTERNI ADD ON SILVER PACK _ LEISHMANIA 2026,
LAB INTERNI ADD ON GOLD PACK _ LEISHMANIA 2026, LAB INTERNI ADD ON CVIT PACK _ LEISHMANIA 2026

**Specialistica (10)**
SPECIALISTICA SILVER PACK _ LEISHMANIA 2026, SPECIALISTICA GOLD PACK _ LEISHMANIA 2026,
SPECIALISTICA CVIT PACK _ LEISHMANIA 2026, SPECIALISTICA PLATINUM PACK _ LEISHMANIA 2026,
SPECIALISTICA GRAN SASSO SILVER PACK 2026, SPECIALISTICA GRAN SASSO GOLD PACK 2026,
SPECIALISTICA SILVER PACK 2026, SPECIALISTICA GOLD PACK 2026, SPECIALISTICA CVIT PACK 2026,
SPECIALISTICA PLATINUM PACK 2026

**Partner / convenzioni (5)**
ZOETIS VOUCHERS FR 2026, Platinum Anicura 2026, PLATINUM PACK VEZZONI 2026,
VET DIAGNOSYS 2026, LUXVET GOLD 2026

**Cataloghi internazionali — DE/PT (6)**
PREISKATALOG GOLD (DE) 2026, PREISKATALOG SILVER (DE) 2026, PREISKATALOG BASE (DE) 2026,
CATÁLOGO DE PREÇOS GOLD (PT) 2026, CATÁLOGO DE PREÇOS SILVER (PT) 2026,
CATÁLOGO DE PREÇOS BÁSICOS (PT) 2026

**Tariffari (3)**
TARIFFARIO BASE 2026, TARIFFARIO COUPON MSD 2026, TARIFFARIO PUBBLICO 2026

(Elenco completo e nomi esatti nel campo `plan_order` di `piani_sconto_esami_2026.json`.)
