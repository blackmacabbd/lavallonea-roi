# Design — Dashboard "Calcolatore-first" e sidebar semplificata

Data: 2026-07-08
Contesto: la dashboard attuale (`renderDashboard` in `public/app.js`) mostra, nell'ordine: 3 KPI (Strutture attive, File caricati, Risparmio totale), un grafico per struttura, la tabella "Ultimi file caricati", e infine — in fondo — il Calcolatore ROI, che è lo strumento usato ogni giorno. L'operatore lo trova sepolto sotto contenuti secondari.

## Obiettivo

Rendere il Calcolatore ROI l'elemento immediato all'apertura, ridurre il rumore visivo, alleggerire la sidebar. Nessuna modifica alla logica di calcolo, alle API o al DB: è una ri-strutturazione di layout + rifinitura visiva (frontend-design).

## Decisioni prese in fase di brainstorming

- **Uso primario**: Calcolatore ROI dal vivo → deve essere l'eroe della landing.
- **Widget dashboard da tenere**: card "Risparmio totale dottori" + grafico "Riepilogo per struttura".
- **Widget da rimuovere dalla dashboard**: card "Strutture attive", card "File caricati", tabella "Ultimi file caricati". I dati sugli upload restano accessibili da "Cronologia file" (nessuna perdita di funzione).
- **Sidebar**: "Cronologia file" e "Debug Excel" (raramente usate / tecnica) vanno in un gruppo a scomparsa "Gestione", chiuso di default. Restano in vista: Carica file, Dashboard, albero Strutture, Gestione piani, Gestione concorrenti, Confronto strutture.
- **Approccio layout scelto**: A — pagina unica calcolatore-first (non due viste separate).

## Sezione 1 — Landing calcolatore-first

`renderDashboard` viene riorganizzata. Ordine nuovo dall'alto:

1. **Header**: titolo "Calcolatore ROI" a sinistra; a destra le due pillole `Piano ▾` e `Concorrente ▾` (spostate qui dall'interno della sezione ROI) + bottone "Carica file" spostato come azione secondaria/ghost. La riga header diventa la barra di controllo del calcolatore.
2. **Eroe — Calcolatore ROI**: la tabella confronto a larghezza piena (colonne Concorrenza rosse / Mylav blu già a tema), seguita dalla barra azioni (`+ Aggiungi esame`, `Salva come file`, `Esporta Excel`) e dai messaggi (`roi-msg`). I banner (`roi-consiglio-banner`, `roi-match-banner`) restano invariati.
3. **Banda Riepilogo** (solo se `strutture_count > 0`): due colonne affiancate — a sinistra la card **Risparmio totale dottori** (numero blu grande, sottotitolo "vs concorrenza"), a destra il **grafico per struttura** (`chart-confronto-dash`, mostrato solo se `per_struttura.length >= 2`). Se c'è solo 1 struttura, la banda mostra la sola card Risparmio a larghezza piena. Se `strutture_count === 0`, la banda è assente (resta solo il calcolatore, come oggi nello stato vuoto).

Rimosse dal markup: `kpi-grid` con le due card conteggio, la tabella `Ultimi file caricati`. La card Risparmio non vive più nella griglia KPI a 3 ma nella banda Riepilogo.

Struttura HTML risultante (schematica):
```
page-header:  [Calcolatore ROI]            [Piano ▾] [Concorrente ▾] [Carica file]
page-body:
  section-card "calcolatore":  tabella + azioni + msg
  section "riepilogo" (cond.): [card Risparmio] [card Grafico per struttura]
```

Il Calcolatore non è più appeso via `appendChild` dopo `setMain`: entra direttamente nel markup di `renderDashboard`, come prima section del body. `initRoiEvents()` va chiamato dopo aver iniettato quel markup (invariato come meccanismo). Il grafico per struttura continua a essere istanziato dopo il render, come oggi.

## Sezione 2 — Sidebar con gruppo "Gestione"

In `buildSidebar()`:
- Restano voci top-level: `Carica file Excel` (upload), `Dashboard`, albero `Strutture`, `Gestione piani`, `Gestione concorrenti`, `Confronto strutture` (quest'ultima già condizionata a ≥2 strutture).
- Nuovo gruppo a scomparsa **"Gestione"** in fondo, reso con lo stesso pattern visivo di `struttura-group`/`struttura-header`/`struttura-children` già esistente (riuso classi, niente CSS nuovo se non minimo). Contiene: `Cronologia file`, `Debug Excel`.
- Stato aperto/chiuso del gruppo tenuto in una variabile client (`S.gestioneOpen`, default `false`). Toggle come le strutture.
- Le voci `debug` e `cronologia` restano route valide in `navigate()` (nessuna rimozione di funzionalità): cambiano solo posizione nel menu.

## Sezione 3 — Rifinitura visiva (frontend-design)

Coerente col tema brand MYLAV già applicato (grafite/blu/rosso, token `:root`). Nessun colore nuovo.

- **Card calcolatore**: più respiro interno (padding), le pillole `Piano ▾`/`Concorrente ▾` con lo stile pillola esistente (`roi-piano-btn`) ma in posizione header, ben visibili come i controlli primari.
- **Card Risparmio totale**: numero grande in `var(--blue)`, etichetta uppercase piccola, bordo/accento blu a sinistra (riuso `kpi-card` + variante). È l'unico colpo d'occhio della panoramica.
- **Banda riepilogo**: griglia a 2 colonne responsive (collassa a 1 colonna sotto ~720px).
- Titoli in `var(--ink)` grafite, spaziatura sezioni uniforme.
- Tabella confronto invariata nella densità (leggibilità numeri), tema rosso/blu già presente.

## Compatibilità

- Nessuna modifica a API, DB, `lib/*.js`, o alla logica del Calcolatore ROI (funzioni `buildRoiTableHtml`, `aggiornaPrezziAutomatici`, ecc. invariate).
- `renderCronologia`, `renderDebug` invariate: cambia solo il punto di accesso in sidebar.
- Modifiche confinate a `public/app.js` (`renderDashboard`, `buildSidebar`, `buildRoiSectionHtml`/collocazione pillole) e `public/style.css` (banda riepilogo, eventuale variante card Risparmio, gruppo Gestione se serve).
- Nessuna nuova dipendenza. Testo UI in italiano.
