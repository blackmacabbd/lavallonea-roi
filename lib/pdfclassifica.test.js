const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { classificaRighe, parsePrezzo } = require('./pdfclassifica');
const { estraiRigheGrezze } = require('./pdfestrazione');

// Riga grezza minima: la classificazione lavora sul testo, le coordinate
// servono solo a essere riportate intatte per l'evidenziazione.
let _y = 0;
const grezza = (testo, pagina = 1) => ({
  pagina, testo, x: 48, y: (_y += 20), w: 400, h: 12
});

const cls = (...testi) => classificaRighe(testi.map(t => grezza(t)));
const unica = (testo) => cls(testo).righe[0];

test('riga tabellare semplice: nome e prezzo separati, confidenza alta', () => {
  const r = unica('EMOCROMO COMPLETO 18,50');
  assert.strictEqual(r.nome, 'EMOCROMO COMPLETO');
  assert.strictEqual(r.prezzo, 18.5);
  assert.strictEqual(r.confidenza, 'alta');
  assert.strictEqual(r.scartata, false);
});

test('prezzo italiano con separatore delle migliaia', () => {
  assert.strictEqual(unica('PANNELLO GENETICO COMPLETO 1.234,56').prezzo, 1234.56);
});

// La UI mostra i prezzi in formato italiano: 1234.56 diventa "1.234,56". Se il
// parser leggesse quel testo come 1.234 il prezzo verrebbe diviso per mille
// ogni volta che l'operatore tocca il campo.
test('parsePrezzo interpreta i formati italiano e anglosassone', () => {
  const casi = [
    ['1.234,56', 1234.56], ['2.000,00', 2000], ['18,50', 18.5], ['18,5', 18.5],
    ['1.234', 1234], ['1,5', 1.5], ['1234.56', 1234.56], ['1,234.56', 1234.56],
    ['€ 18,50', 18.5], [' 18,50 ', 18.5], ['0,00', 0], [18.5, 18.5]
  ];
  for (const [dato, atteso] of casi) {
    assert.strictEqual(parsePrezzo(dato), atteso, `parsePrezzo(${JSON.stringify(dato)})`);
  }
  for (const vuoto of ['', '   ', 'abc', null, undefined]) {
    assert.ok(Number.isNaN(parsePrezzo(vuoto)), `parsePrezzo(${JSON.stringify(vuoto)}) deve essere NaN`);
  }
});

// Molti listini stampano "18,5". Prima queste righe non erano nemmeno
// tabellari: sparivano dal conteggio di completezza senza lasciare traccia.
test('prezzo con un solo decimale: riconosciuto', () => {
  const r = unica('EMOCROMO COMPLETO 18,5');
  assert.strictEqual(r.tabellare, true);
  assert.strictEqual(r.prezzo, 18.5);
  assert.strictEqual(r.scartata, false);
});

// Contropartita di accettare un decimale solo: una quantita' nella descrizione
// non deve diventare un esame inventato.
test('quantita con unita di misura: non e un prezzo', () => {
  for (const t of ['Prelievo minimo 2,5 ml', 'Campione 0,5 g', 'Provetta 1,5 ML']) {
    const r = unica(t);
    assert.strictEqual(r.scartata, true, t);
    assert.match(r.motivo, /quantita/i, t);
  }
});

test('un codice dopo il prezzo non viene scambiato per unita di misura', () => {
  const r = unica('EMOCROMO COMPLETO 12,50 GALLS');
  assert.strictEqual(r.scartata, false);
  assert.strictEqual(r.prezzo, 12.5);
});

test('prezzo col punto decimale', () => {
  assert.strictEqual(unica('ESAME URINE COMPLETO 18.50').prezzo, 18.5);
});

test('il simbolo di euro non finisce nel nome', () => {
  const r = unica('T4 TOTALE € 22,90');
  assert.strictEqual(r.nome, 'T4 TOTALE');
  assert.strictEqual(r.prezzo, 22.9);
});

test('separatori residui rimossi dalla coda del nome', () => {
  assert.strictEqual(unica('EMOCROMO COMPLETO ..... 18,50').nome, 'EMOCROMO COMPLETO');
  assert.strictEqual(unica('EMOCROMO COMPLETO: 18,50').nome, 'EMOCROMO COMPLETO');
});

test('con due importi prende il primo (prezzo base, non quello maggiorato)', () => {
  const r = unica('COAGULAZIONE PT APTT 28,00 35,60');
  assert.strictEqual(r.prezzo, 28);
  assert.strictEqual(r.confidenza, 'alta');
});

test('troppi importi sulla stessa riga: da rivedere', () => {
  const r = unica('PROFILO 12,00 15,00 18,00 21,00');
  assert.strictEqual(r.scartata, false);
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /importi/i);
});

test('riga senza importi: scartata e non conta come tabellare', () => {
  const res = cls('I prezzi sono espressi in euro e non comprendono IVA.');
  assert.strictEqual(res.righe[0].scartata, true);
  assert.strictEqual(res.righe[0].prezzo, null);
  assert.strictEqual(res.totaliTabellari, 0);
  assert.strictEqual(res.classificate, 0);
});

test('numero di pagina e intestazione colonne: scartati, non tabellari', () => {
  const res = cls('Pagina 1 di 2', 'Esame Prezzo', 'Listino Esami di Laboratorio 2026');
  assert.ok(res.righe.every(r => r.scartata), 'rumore non scartato');
  assert.strictEqual(res.totaliTabellari, 0);
});

test('intestazione di tabella con importo: tabellare ma scartata', () => {
  const r = unica('Esame Materiale Tempi Prezzo 0,00');
  assert.strictEqual(r.scartata, true);
  assert.match(r.motivo, /intestazione/i);
  assert.strictEqual(cls('Esame Materiale Tempi Prezzo 0,00').totaliTabellari, 1);
});

test('intestazione di sole colonne, anche senza materiale/tempi: scartata', () => {
  const r = unica('Esame Prezzo 0,00');
  assert.strictEqual(r.scartata, true);
  assert.match(r.motivo, /intestazione/i);
});

test('solo un importo senza nome: scartata', () => {
  const r = unica('18,50');
  assert.strictEqual(r.scartata, true);
  assert.match(r.motivo, /nome/i);
});

test('nome troppo corto: scartata', () => {
  const r = unica('AB 18,50');
  assert.strictEqual(r.scartata, true);
  assert.match(r.motivo, /corto/i);
});

// Una riga scartata per il nome ha comunque un importo letto correttamente:
// conservarlo permette di recuperarla in revisione senza ridigitare il prezzo.
test('riga scartata per il nome: conserva l importo trovato', () => {
  const r = unica('AB 12,00');
  assert.strictEqual(r.scartata, true);
  assert.strictEqual(r.tabellare, true);
  assert.strictEqual(r.prezzo, 12);
});

test('la percentuale non lascia un prezzo da recuperare', () => {
  const r = unica('Sconto convenzione 10,00 %');
  assert.strictEqual(r.scartata, true);
  assert.strictEqual(r.prezzo, null);
});

test('una riga senza importo non ha prezzo ne e tabellare', () => {
  const r = unica('Pagina 1 di 2');
  assert.strictEqual(r.prezzo, null);
  assert.strictEqual(r.tabellare, false);
});

test('sigla isolata come nome: importata ma da rivedere', () => {
  const r = unica('GALLS 18,50');
  assert.strictEqual(r.scartata, false);
  assert.strictEqual(r.confidenza, 'incerta');
});

test('prezzo a zero: importato ma da rivedere', () => {
  const r = unica('EMOCROMO COMPLETO 0,00');
  assert.strictEqual(r.scartata, false);
  assert.strictEqual(r.prezzo, 0);
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /prezzo/i);
});

test('prezzo fuori scala: importato ma da rivedere', () => {
  const r = unica('PANNELLO COMPLETO 9.999,00');
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /prezzo/i);
});

test('percentuale: non e un prezzo', () => {
  const r = unica('Sconto applicato 10,00 %');
  assert.strictEqual(r.scartata, true);
  assert.match(r.motivo, /percentuale/i);
});

test('paragrafo lungo con un importo dentro: da rivedere', () => {
  const r = unica(
    'Le tariffe indicate si applicano solo ai clienti convenzionati e possono ' +
    'variare in corso d anno secondo il tariffario vigente 12,00'
  );
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /lungo/i);
});

// Con l'estrazione posizionale le colonne intermedie di un listino reale
// (materiale, tempi di refertazione) finiscono sulla stessa riga del nome.
// Il prezzo resta corretto, ma la riga deve arrivare in revisione: se fosse
// marcata "alta" l'operatore non saprebbe che il nome va ripulito.
test('riga in stile listino reale con colonne intermedie: prezzo giusto, da rivedere', () => {
  const r = unica('Emocromo completo Sangue in EDTA in giornata 12,50 21,35 GALLS');
  assert.strictEqual(r.prezzo, 12.5, 'deve prendere il prezzo base, non il maggiorato');
  assert.strictEqual(r.scartata, false);
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /colonna/i);
});

test('un nome esame legittimo con un materiale dentro resta ad alta confidenza', () => {
  assert.strictEqual(unica('ESAME URINE COMPLETO 15,00').confidenza, 'alta');
  assert.strictEqual(unica('EMOCROMO SU SANGUE INTERO 18,50').confidenza, 'alta');
});

// Un listino reale (CDVET, 117 pagine) ha una colonna "tempi" che l'estrazione
// appiccica al nome: senza riconoscerla, 1705 righe su 1748 finivano "da
// rivedere" e la revisione diventava impraticabile.
test('colonna dei tempi ricorrente: tolta dai nomi, righe promosse ad alta', () => {
  const res = cls(
    'CORTISOLO/CREATININA URINARI 4 h 18,00',
    'ESAME CITOLOGICO DEL SEDIMENTO URINARIO 24 h 33,30',
    'VALUTAZIONE QUALITATIVA PROTEINURIA 7 gg 38,50',
    'RICERCA ORGANOFOSFORICI 5/7 gg 60,00',
    'PROFILO BIOCHIMICO COMPLETO in giornata 42,00',
    'ESAME URINE, PU/CU, CHIMICA URINARIA vedi singole analisi 30,30'
  );
  assert.strictEqual(res.nomiRipuliti, 6);
  assert.strictEqual(res.incerte, 0, 'ripulite non devono restare dubbie');
  assert.strictEqual(res.confidenzaComplessiva, 1);
  assert.deepStrictEqual(res.righe.map(r => r.nome), [
    'CORTISOLO/CREATININA URINARI',
    'ESAME CITOLOGICO DEL SEDIMENTO URINARIO',
    'VALUTAZIONE QUALITATIVA PROTEINURIA',
    'RICERCA ORGANOFOSFORICI',
    'PROFILO BIOCHIMICO COMPLETO',
    'ESAME URINE, PU/CU, CHIMICA URINARIA'
  ]);
});

// L'altra faccia: senza la prova che il documento abbia quella colonna, un
// tempo dentro un nome resta li e viene segnalato, non cancellato.
test('un tempo isolato non fa una colonna: nome intatto e segnalato', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50', 'PROFILO BIOCHIMICO 42,00', 'LEISHMANIA IFI 31,50',
    'T4 TOTALE 22,90', 'ESAME URINE COMPLETO 15,00', 'COAGULAZIONE PT APTT 28,00',
    'RACCOLTA URINE 24 h 30,00'
  );
  assert.strictEqual(res.nomiRipuliti, 0);
  const conTempo = res.righe.find(r => r.nome && r.nome.includes('24 h'));
  assert.ok(conTempo, 'il nome non va modificato');
  assert.strictEqual(conTempo.confidenza, 'incerta');
});

test('la colonna non viene tolta se resterebbe un nome vuoto', () => {
  const res = cls(
    'ESAME UNO 4 h 10,00', 'ESAME DUE 4 h 11,00', 'ESAME TRE 4 h 12,00',
    'ESAME QUATTRO 4 h 13,00', 'ESAME CINQUE 4 h 14,00', '24 h 15,00'
  );
  assert.ok(res.nomiRipuliti >= 5);
  const solaCoda = res.righe.find(r => r.nome === '24 h');
  assert.ok(solaCoda, 'meglio un nome sporco che nessun nome');
});

// Le macchine stanno in capitoli propri, introdotti da un titolo: e' il
// segnale piu' affidabile, perche' una parola come "noleggio" puo' comparire
// in un nome esame mentre una intestazione di sezione no.
test('intestazione di sezione: le righe sotto diventano macchine', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',
    'ANALIZZATORI',
    'Analizzatore biochimico da banco 8.500,00',
    'Ematologico veterinario 11.200,00'
  );
  assert.deepStrictEqual(res.righe.map(r => r.tipo), ['esame', 'macchina', 'macchina', 'macchina']);
  assert.strictEqual(res.esami, 1);
  assert.strictEqual(res.macchine, 2);
});

// Caso 7: ritorno agli esami dopo il capitolo macchine. "STRUMENTAZIONE" ed
// "ESAMI DI LABORATORIO" compaiono una sola volta ciascuno (sotto soglia,
// nessuna delle due e' un'intestazione corrente): la seconda deve richiudere
// la sezione macchine aperta dalla prima, e la riga esame successiva torna
// 'esame'.
test('una intestazione esami chiude la sezione macchine', () => {
  const res = cls(
    'STRUMENTAZIONE',
    'Analizzatore biochimico 8.500,00',
    'ESAMI DI LABORATORIO',
    'EMOCROMO COMPLETO 18,50'
  );
  const perTipo = res.righe.filter(r => !r.scartata).map(r => [r.nome, r.tipo]);
  assert.deepStrictEqual(perTipo, [
    ['Analizzatore biochimico', 'macchina'],
    ['EMOCROMO COMPLETO', 'esame']
  ]);
});

// Caso 5. Garanzia di non regressione: i listini che oggi funzionano non
// cambiano.
test('senza intestazioni riconoscibili tutto resta esame', () => {
  const res = cls('EMOCROMO COMPLETO 18,50', 'T4 TOTALE 22,90', 'LEISHMANIA IFI 31,50');
  assert.ok(res.righe.every(r => r.tipo === 'esame'));
  assert.strictEqual(res.macchine, 0);
  assert.strictEqual(res.esami, 3);
});

// Una nota in prosa non e' un titolo: lunga e con il punto finale.
// Le due note iniziano apposta con una parola del vocabolario macchine
// ("Analizzatori"), cosi superano la regex di SEZIONE_MACCHINE e il rigetto
// dimostra davvero i due limiti (lunghezza, punto finale), non un mancato
// match della regex. Prima la nota iniziava con "Gli...", che la regex
// scarta gia' da sola: lunghezza e punto finale non venivano mai esercitati
// (rimuovendo quei due controlli il test continuava a passare comunque).
// Una nota sola non basta a provare entrambi i limiti in modo indipendente
// (i due controlli sono in OR: l'altro resterebbe comunque attivo), quindi
// ce ne vogliono due: una che sfora solo per lunghezza, una che sfora solo
// per il punto finale.
test('una nota lunga non viene scambiata per intestazione di sezione', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',
    // Supera i 60 caratteri e non finisce con un punto: esercita solo il
    // limite di lunghezza.
    'Analizzatori e apparecchiature diagnostiche disponibili anche a noleggio o comodato in filiale',
    'T4 TOTALE 22,90',
    // Sotto i 60 caratteri ma finisce con un punto: esercita solo il limite
    // del punto finale.
    'Analizzatori disponibili anche a noleggio.',
    'LEISHMANIA IFI 31,50'
  );
  assert.ok(res.righe.every(r => r.tipo === 'esame'), 'le note non devono aprire una sezione macchine');
});

// Caso 8: una nota che sfora insieme entrambi i limiti (piu' lunga di 60
// caratteri E con il punto finale), a differenza del test sopra dove i due
// limiti sono isolati uno alla volta. Comincia apposta con una parola del
// vocabolario macchine ("Analizzatori") per dimostrare che a fermarla sono i
// limiti di lunghezza/punteggiatura, non un mancato match della regex.
test('nota in prosa lunga e con punto finale insieme: non apre nessuna sezione', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',
    'Analizzatori, apparecchiature diagnostiche e strumentazione di laboratorio disponibili anche a noleggio o comodato in filiale.',
    'T4 TOTALE 22,90'
  );
  assert.ok(res.righe.every(r => r.tipo === 'esame'), 'la nota non deve aprire una sezione macchine');
});

// Le prove seguenti riguardano la distinzione fra un'intestazione corrente
// (titolo ricorrente in cima a ogni pagina, es. "LISTINO PREZZI - sezione N")
// e un titolo di capitolo vero. La discriminante e' la ricorrenza del testo
// normalizzato (vedi normalizzaIntestazione in lib/pdfclassifica.js) su piu'
// pagine distinte, non la posizione verticale: anche un titolo di capitolo
// vero sta in cima alla sua pagina, quindi la posizione da sola non separa i
// due casi (vedi il caso 1 sotto).

// Caso 1 (il difetto): quattro capitoli veri, ognuno titolato dalla riga piu'
// in alto della propria pagina, senza alcuna intestazione ricorrente: i
// quattro testi sono tutti diversi. Con la vecchia euristica posizionale,
// quattro titoli tutti "in cima alla loro pagina" facevano scattare la soglia
// di intestazione corrente (4 pagine su 4 con una candidata in cima, 100% >=
// 50%) e tutti i titoli venivano ignorati: risultato macchine: 0 invece di 2,
// con 8.500 e 11.200 segnalati "prezzo fuori scala" (le righe restavano
// classificate 'esame', col tetto di prezzo degli esami invece di quello
// delle macchine). Con la regola nuova nessuno dei quattro testi normalizzati
// ricorre su piu' di una pagina (sotto soglia): ogni titolo cambia sempre la
// sezione.
test('quattro capitoli veri su quattro pagine, titoli tutti diversi: nessuno e un intestazione corrente', () => {
  const righe = [
    { pagina: 1, testo: 'ANALIZZATORI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 1, testo: 'Analizzatore biochimico da banco 8.500,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 2, testo: 'ESAMI DI LABORATORIO', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 2, testo: 'EMOCROMO COMPLETO 18,50', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 3, testo: 'STRUMENTAZIONE VETERINARIA', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 3, testo: 'Ematologico veterinario 11.200,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 4, testo: 'PROFILI SPECIALISTICI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 4, testo: 'PROFILO BIOCHIMICO COMPLETO 42,00', x: 0, y: 30, w: 400, h: 12 }
  ];
  const res = classificaRighe(righe);
  assert.strictEqual(res.macchine, 2, 'i due capitoli macchine devono contare come macchine');
  assert.strictEqual(res.esami, 2, 'i due capitoli esami devono contare come esami');
  const macchine = res.righe.filter(r => !r.scartata && r.tipo === 'macchina');
  // Se una qualunque sezione macchine si richiudesse per errore, il prezzo
  // userebbe il tetto degli esami (2000) invece di quello delle macchine
  // (200000) e risulterebbe "fuori scala".
  assert.ok(macchine.every(r => r.confidenza === 'alta'), 'nessuna macchina deve risultare fuori scala');
});

// Caso 2: intestazione corrente che cambia numero a ogni pagina ("LISTINO
// PREZZI - sezione 1", "... sezione 2", "... sezione 3"), col capitolo
// macchine aperto una sola volta da "ANALIZZATORI" a pagina 1. A meno delle
// cifre il testo e' identico su tutte e tre le pagine (sopra soglia,
// ricorrente): la prima occorrenza (pagina 1) si applica ma non cambia nulla
// (la sezione di partenza e' gia' 'esame'), le due occorrenze successive
// vengono ignorate perche' quel testo e' gia' stato applicato. La sezione
// macchine aperta da "ANALIZZATORI" (un solo testo, sotto soglia: cambia
// sempre) resta percio' aperta fino alla fine. Le righe sono costruite a mano
// (non con l'helper grezza, che assegna la y da solo) per controllare
// precisamente pagina e testo di ciascuna riga.
test('intestazione corrente che cambia numero a ogni pagina non richiude la sezione macchine', () => {
  const righe = [
    { pagina: 1, testo: 'LISTINO PREZZI — sezione 1', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 1, testo: 'ANALIZZATORI', x: 0, y: 30, w: 200, h: 12 },
    { pagina: 1, testo: 'Analizzatore biochimico da banco 8.500,00', x: 0, y: 50, w: 400, h: 12 },
    { pagina: 2, testo: 'LISTINO PREZZI — sezione 2', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 2, testo: 'Ematologico veterinario 11.200,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 3, testo: 'LISTINO PREZZI — sezione 3', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 3, testo: 'Analizzatore urine con lettore 4.300,00', x: 0, y: 30, w: 400, h: 12 }
  ];
  const res = classificaRighe(righe);
  const macchine = res.righe.filter(r => !r.scartata && r.tipo === 'macchina');
  assert.strictEqual(macchine.length, 3, 'tutte e tre le righe macchina devono restare tali');
  assert.deepStrictEqual(macchine.map(r => r.nome), [
    'Analizzatore biochimico da banco',
    'Ematologico veterinario',
    'Analizzatore urine con lettore'
  ]);
  // Nessuna deve risultare "incerta": se la sezione si richiudesse per errore
  // userebbero il tetto degli esami (2000) invece di quello delle macchine
  // (200000) e verrebbero segnalate come "prezzo fuori scala".
  assert.ok(macchine.every(r => r.confidenza === 'alta'), 'nessuna macchina deve risultare fuori scala');
  assert.strictEqual(res.esami, 0);
  assert.strictEqual(res.macchine, 3);
});

// Caso 3: intestazione corrente identica su tutte le pagine (nessuna cifra
// che cambia), stesso capitolo macchine aperto una sola volta. A differenza
// del caso 2, qui il testo dell'intestazione corrente non cambia affatto da
// pagina a pagina: verifica che la ricorrenza sia riconosciuta anche nel
// caso piu' semplice, senza dipendere dalla normalizzazione delle cifre.
test('intestazione corrente identica su tutte le pagine non richiude la sezione macchine', () => {
  const righe = [
    { pagina: 1, testo: 'LISTINO PREZZI UFFICIALE', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 1, testo: 'ANALIZZATORI', x: 0, y: 30, w: 200, h: 12 },
    { pagina: 1, testo: 'Analizzatore biochimico da banco 8.500,00', x: 0, y: 50, w: 400, h: 12 },
    { pagina: 2, testo: 'LISTINO PREZZI UFFICIALE', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 2, testo: 'Ematologico veterinario 11.200,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 3, testo: 'LISTINO PREZZI UFFICIALE', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 3, testo: 'Analizzatore urine con lettore 4.300,00', x: 0, y: 30, w: 400, h: 12 }
  ];
  const res = classificaRighe(righe);
  assert.strictEqual(res.macchine, 3);
  assert.strictEqual(res.esami, 0);
  const macchine = res.righe.filter(r => !r.scartata && r.tipo === 'macchina');
  assert.ok(macchine.every(r => r.confidenza === 'alta'), 'nessuna macchina deve risultare fuori scala');
});

// Caso 6: il titolo del capitolo macchine stesso ("ANALIZZATORI") e' ripetuto
// in cima a tutte e tre le sue pagine: e' lui stesso ricorrente (sopra
// soglia). Protegge la clausola "solo la prima volta" della regola: se
// un'implementazione ignorasse ogni intestazione ricorrente, compresa la sua
// prima occorrenza, la sezione macchine non si aprirebbe mai (macchine: 0
// invece di 3, resterebbe 'esame' dall'inizio alla fine). La prima occorrenza
// deve aprire la sezione; le due ripetizioni successive sono innocue perche'
// la sezione e' gia' quella giusta.
test('titolo del capitolo macchine ripetuto in cima a tutte le sue pagine: la prima occorrenza apre comunque la sezione', () => {
  const righe = [
    { pagina: 1, testo: 'ANALIZZATORI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 1, testo: 'Analizzatore biochimico da banco 8.500,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 2, testo: 'ANALIZZATORI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 2, testo: 'Ematologico veterinario 11.200,00', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 3, testo: 'ANALIZZATORI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 3, testo: 'Analizzatore urine con lettore 4.300,00', x: 0, y: 30, w: 400, h: 12 }
  ];
  const res = classificaRighe(righe);
  assert.strictEqual(res.macchine, 3, 'la prima occorrenza del titolo deve aprire la sezione macchine');
  assert.strictEqual(res.esami, 0);
});

// Caso 4: due soli titoli di capitolo, uno per pagina, testi diversi.
// Ciascun testo normalizzato compare su una sola pagina (1 <
// MIN_PAGINE_INTESTAZIONE_CORRENTE = 3): nessuno dei due e' un'intestazione
// corrente, quindi entrambi cambiano sempre la sezione e dividono
// correttamente un esame da una macchina.
test('due soli capitoli su due pagine: sotto soglia, dividono correttamente le sezioni', () => {
  const righe = [
    { pagina: 1, testo: 'ESAMI DI LABORATORIO', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 1, testo: 'EMOCROMO COMPLETO 18,50', x: 0, y: 30, w: 400, h: 12 },
    { pagina: 2, testo: 'ANALIZZATORI', x: 0, y: 10, w: 300, h: 12 },
    { pagina: 2, testo: 'Analizzatore biochimico da banco 8.500,00', x: 0, y: 30, w: 400, h: 12 }
  ];
  const res = classificaRighe(righe);
  const perTipo = res.righe.filter(r => !r.scartata).map(r => [r.nome, r.tipo]);
  assert.deepStrictEqual(perTipo, [
    ['EMOCROMO COMPLETO', 'esame'],
    ['Analizzatore biochimico da banco', 'macchina']
  ]);
  assert.strictEqual(res.esami, 1);
  assert.strictEqual(res.macchine, 1);
});

// Un analizzatore costa migliaia di euro: il tetto pensato per gli esami lo
// segnalerebbe sempre come fuori scala.
test('il prezzo di una macchina non e fuori scala', () => {
  const res = cls('ANALIZZATORI', 'Analizzatore biochimico da banco 8.500,00');
  const macchina = res.righe.find(r => r.tipo === 'macchina' && !r.scartata);
  assert.strictEqual(macchina.prezzo, 8500);
  assert.strictEqual(macchina.confidenza, 'alta');
  assert.strictEqual(macchina.motivo, null);
});

test('un esame da ottomila euro resta segnalato', () => {
  const r = unica('PROFILO STRANO 8.500,00');
  assert.strictEqual(r.confidenza, 'incerta');
  assert.match(r.motivo, /fuori scala/i);
});

test('conserva coordinate e pagina, aggiunge indice progressivo', () => {
  const res = cls('EMOCROMO COMPLETO 18,50', 'T4 TOTALE 22,90');
  res.righe.forEach((r, i) => {
    assert.strictEqual(r.indice, i);
    assert.strictEqual(r.pagina, 1);
    assert.strictEqual(r.x, 48);
    assert.ok(Number.isFinite(r.y) && r.w === 400 && r.h === 12);
  });
});

test('i conteggi di completezza quadrano', () => {
  const res = cls(
    'EMOCROMO COMPLETO 18,50',        // classificata alta
    'GALLS 18,50',                    // classificata incerta
    'Esame Materiale Tempi 0,00',     // tabellare scartata
    'Pagina 1 di 2'                   // non tabellare
  );
  assert.strictEqual(res.totaliTabellari, 3);
  assert.strictEqual(res.classificate, 2);
  assert.strictEqual(res.alta, 1);
  assert.strictEqual(res.incerte, 1);
  assert.strictEqual(res.scartate, 2);
  const tabellariScartate = res.righe.filter(r => r.tabellare && r.scartata).length;
  assert.strictEqual(res.classificate + tabellariScartate, res.totaliTabellari);
});

test('confidenza complessiva: le incerte pesano meta', () => {
  assert.strictEqual(cls('EMOCROMO COMPLETO 18,50').confidenzaComplessiva, 1);
  assert.strictEqual(cls('GALLS 18,50').confidenzaComplessiva, 0.5);
  assert.strictEqual(cls('Pagina 1 di 2').confidenzaComplessiva, 0);
});

test('accetta sia l array di righe sia il risultato dello stadio 1', () => {
  const righe = [grezza('EMOCROMO COMPLETO 18,50')];
  assert.strictEqual(classificaRighe(righe).classificate, 1);
  assert.strictEqual(classificaRighe({ pagine: 1, righe }).classificate, 1);
});

test('nessuna riga: conteggi a zero, non esplode', () => {
  const res = classificaRighe([]);
  assert.strictEqual(res.righe.length, 0);
  assert.strictEqual(res.totaliTabellari, 0);
  assert.strictEqual(res.confidenzaComplessiva, 0);
});

// Prova vera: i due stadi in catena sul PDF fixture, che imita un listino reale.
test('integrazione con lo stadio 1: estrae i 6 esami del listino fixture', async () => {
  const grezze = await estraiRigheGrezze(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'listino-testo.pdf'))
  );
  const res = classificaRighe(grezze);

  assert.strictEqual(res.totaliTabellari, 6, 'righe tabellari rilevate');
  assert.strictEqual(res.classificate, 6, 'esami classificati');
  assert.strictEqual(res.confidenzaComplessiva, 1);

  const importate = res.righe.filter(r => !r.scartata)
    .map(r => [r.nome, r.prezzo, r.pagina]);
  assert.deepStrictEqual(importate, [
    ['EMOCROMO COMPLETO', 18.5, 1],
    ['PROFILO BIOCHIMICO COMPLETO', 42, 1],
    ['ESAME URINE COMPLETO', 15, 1],
    ['T4 TOTALE', 22.9, 1],
    ['COAGULAZIONE PT APTT', 28, 2],
    ['LEISHMANIA IFI', 31.5, 2]
  ]);

  // Il rumore resta nel risultato, scartato con un motivo leggibile.
  const piede = res.righe.find(r => r.testo.includes('Pagina 1 di 2'));
  assert.ok(piede && piede.scartata && piede.motivo);
});

// Listino lungo con la colonna dei tempi, come quelli veri. Prima di
// riconoscere la colonna, un documento cosi mandava in revisione quasi tutto.
test('integrazione: listino lungo con colonna tempi, nomi puliti e nessun dubbio', async () => {
  const grezze = await estraiRigheGrezze(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'listino-lungo-tempi.pdf'))
  );
  const res = classificaRighe(grezze);

  assert.strictEqual(grezze.pagine, 12);
  assert.strictEqual(res.totaliTabellari, 120);
  assert.strictEqual(res.classificate, 120);
  assert.strictEqual(res.incerte, 0, 'con la colonna tolta non deve restare nulla da rivedere');
  assert.strictEqual(res.confidenzaComplessiva, 1);
  assert.strictEqual(res.nomiRipuliti, 120);

  // Nessun nome deve conservare la coda della colonna.
  const sporchi = res.righe
    .filter(r => !r.scartata)
    .filter(r => /(\d+\s*(h|gg)|in giornata|vedi singole analisi)\s*$/i.test(r.nome));
  assert.deepStrictEqual(sporchi.map(r => r.nome), [], 'code di colonna rimaste nei nomi');
});

// Fixture pensata per il caso difficile: righe pulite, righe con le colonne
// intermedie di un listino reale, e righe con un importo che vanno scartate.
// E' il divario di completezza (tabellari > classificate) su cui poggiano il
// banner "da rivedere" e il recupero manuale nella revisione.
test('integrazione: il listino misto misura il divario di completezza', async () => {
  const grezze = await estraiRigheGrezze(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'listino-misto.pdf'))
  );
  const res = classificaRighe(grezze);

  assert.strictEqual(res.totaliTabellari, 6, 'righe con importo nel PDF');
  assert.strictEqual(res.classificate, 4, 'righe accettate come esame');
  assert.strictEqual(res.alta, 2);
  assert.strictEqual(res.incerte, 2);
  assert.strictEqual(res.confidenzaComplessiva, 0.5);

  const accettate = res.righe.filter(r => !r.scartata).map(r => [r.nome, r.prezzo, r.confidenza]);
  assert.deepStrictEqual(accettate, [
    ['EMOCROMO COMPLETO', 18.5, 'alta'],
    ['Profilo tiroideo Siero in giornata', 34, 'incerta'],
    ['Coprologico completo Feci 2 giorni', 26, 'incerta'],
    ['LEISHMANIA IFI', 31.5, 'alta']
  ]);

  // Le due righe scartate restano visibili con il motivo: sono recuperabili.
  const scartateConImporto = res.righe.filter(r => r.tabellare && r.scartata);
  assert.strictEqual(scartateConImporto.length, 2);
  assert.match(scartateConImporto[0].motivo, /corto/i);
  assert.match(scartateConImporto[1].motivo, /percentuale/i);
});

// Prova sul documento vero: due capitoli, un solo import, due gruppi distinti.
test('integrazione: listino con capitolo esami e capitolo analizzatori', async () => {
  const grezze = await estraiRigheGrezze(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'listino-misto-macchine.pdf'))
  );
  const res = classificaRighe(grezze);

  assert.strictEqual(res.esami, 3);
  assert.strictEqual(res.macchine, 3);

  const perTipo = t => res.righe.filter(r => !r.scartata && r.tipo === t).map(r => [r.nome, r.prezzo]);
  assert.deepStrictEqual(perTipo('esame'), [
    ['EMOCROMO COMPLETO', 18.5],
    ['PROFILO BIOCHIMICO COMPLETO', 42],
    ['LEISHMANIA IFI', 31.5]
  ]);
  assert.deepStrictEqual(perTipo('macchina'), [
    ['Analizzatore biochimico da banco', 8500],
    ['Ematologico veterinario', 11200],
    ['Analizzatore urine con lettore', 4300]
  ]);
  // Nessuna macchina deve risultare "fuori scala" per via del prezzo.
  assert.strictEqual(res.righe.filter(r => r.tipo === 'macchina' && r.confidenza === 'incerta').length, 0);
});
