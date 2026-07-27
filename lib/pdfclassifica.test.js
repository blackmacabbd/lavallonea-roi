const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { classificaRighe } = require('./pdfclassifica');
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
