'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { leggiImporto, leggiPezziCella } = require('./importi');

// Il caso che ha fatto scrivere questo modulo: la regola precedente
// sostituiva solo la prima virgola e lasciava il punto delle migliaia, quindi
// "3.297,54" diventava 3,297 — mille volte meno. E' il prezzo reale della
// cartuccia RP500 nel listino IVET.
test('leggiImporto legge le migliaia all\'italiana', () => {
  assert.equal(leggiImporto('3.297,54'), 3297.54);
  assert.equal(leggiImporto('1.004,10'), 1004.10);
});

// Prima un importo scritto come testo col simbolo dell'euro non era un
// numero, e la riga veniva scartata in silenzio.
test('leggiImporto ignora il simbolo dell\'euro e gli spazi', () => {
  assert.equal(leggiImporto('€ 140,00'), 140);
  assert.equal(leggiImporto(' 90,00 € '), 90);
  assert.equal(leggiImporto('€23,00'), 23);
});

test('leggiImporto accetta il punto decimale e le celle gia numeriche', () => {
  assert.equal(leggiImporto('3297.54'), 3297.54);
  assert.equal(leggiImporto(140), 140);
  assert.equal(leggiImporto(0), 0);
});

test('leggiImporto restituisce null per cio che non e un importo', () => {
  assert.equal(leggiImporto(''), null);
  assert.equal(leggiImporto(null), null);
  assert.equal(leggiImporto(undefined), null);
  assert.equal(leggiImporto('omaggio'), null);
  assert.equal(leggiImporto(NaN), null);
});

test('leggiPezziCella accetta solo un intero positivo', () => {
  assert.equal(leggiPezziCella(10), 10);
  assert.equal(leggiPezziCella('10 pz'), 10);
  assert.equal(leggiPezziCella('400'), 400);
});

// Pezzi mancanti restano mancanti: null, mai 1. L'1 e' un'ipotesi del
// calcolatore, non un fatto del listino.
test('leggiPezziCella lascia vuoto cio che non e un numero di pezzi', () => {
  assert.equal(leggiPezziCella(''), null);
  assert.equal(leggiPezziCella(null), null);
  assert.equal(leggiPezziCella(0), null);
  assert.equal(leggiPezziCella(-3), null);
  assert.equal(leggiPezziCella('2,5'), null);
});

// ── Campi scritti a mano (calcolatori, gestioni) ──
const { leggiCampo, tipoCampo, LIMITI } = require('./importi');

// Il caso che ha fatto scrivere leggiCampo: «12,50» scritto nel calcolatore
// diventava 12, e «43,50» nei piani si salvava 43 dicendo «Prezzi salvati».
test('leggiCampo legge la virgola decimale come la scrive un italiano', () => {
  assert.deepEqual(leggiCampo('12,50', 'prezzo'), { valore: 12.5 });
  assert.deepEqual(leggiCampo('1.234,50', 'prezzo'), { valore: 1234.5 });
  assert.deepEqual(leggiCampo('€ 42,30', 'prezzo'), { valore: 42.3 });
  assert.deepEqual(leggiCampo(17, 'prezzo'), { valore: 17 });
  assert.deepEqual(leggiCampo('7,5', 'sconto'), { valore: 7.5 });
});

test('leggiCampo distingue un campo vuoto da un valore sbagliato', () => {
  assert.deepEqual(leggiCampo('', 'prezzo'), { vuoto: true });
  assert.deepEqual(leggiCampo('   ', 'prezzo'), { vuoto: true });
  assert.deepEqual(leggiCampo(null, 'prezzo'), { vuoto: true });
  assert.deepEqual(leggiCampo('cento', 'prezzo'), { errore: true });
});

test('leggiCampo rifiuta i valori impossibili', () => {
  assert.deepEqual(leggiCampo('-5', 'prezzo'), { errore: true });
  assert.deepEqual(leggiCampo(LIMITI.prezzo.max + 1, 'prezzo'), { errore: true });
  assert.deepEqual(leggiCampo('150', 'sconto'), { errore: true });
  assert.deepEqual(leggiCampo('-1', 'sconto'), { errore: true });
  assert.deepEqual(leggiCampo('0', 'quantita'), { errore: true });
  assert.deepEqual(leggiCampo('2,5', 'quantita'), { errore: true });
  assert.deepEqual(leggiCampo(1e9, 'quantita'), { errore: true });
  assert.deepEqual(leggiCampo('0', 'pezzi'), { errore: true });
});

test('leggiCampo accetta i limiti esatti', () => {
  assert.deepEqual(leggiCampo('0', 'prezzo'), { valore: 0 });
  assert.deepEqual(leggiCampo('100', 'sconto'), { valore: 100 });
  assert.deepEqual(leggiCampo('0', 'sconto'), { valore: 0 });
  assert.deepEqual(leggiCampo('1', 'quantita'), { valore: 1 });
  assert.deepEqual(leggiCampo(String(LIMITI.quantita.max), 'quantita'), { valore: LIMITI.quantita.max });
});

test('tipoCampo ricava il limite dal nome della colonna', () => {
  assert.equal(tipoCampo('n_esami'), 'quantita');
  assert.equal(tipoCampo('n_concorrenza'), 'quantita');
  assert.equal(tipoCampo('n_clip'), 'quantita');
  assert.equal(tipoCampo('pezzi'), 'pezzi');
  assert.equal(tipoCampo('pezzi_mylav'), 'pezzi');
  assert.equal(tipoCampo('sconto_concorrenza'), 'sconto');
  assert.equal(tipoCampo('sconto_clip'), 'sconto');
  assert.equal(tipoCampo('listino_lav'), 'prezzo');
  assert.equal(tipoCampo('prezzo_confezione'), 'prezzo');
});

test('campiNonValidi elenca i campi sbagliati di una riga, non quelli vuoti', () => {
  const { campiNonValidi } = require('./importi');
  const colonne = ['n_esami', 'listino_concorrenza', 'sconto_concorrenza', 'listino_lav'];
  assert.deepEqual(campiNonValidi({ n_esami: 2, listino_concorrenza: '12,50', sconto_concorrenza: '', listino_lav: 30 }, colonne), []);
  assert.deepEqual(campiNonValidi({ n_esami: 0, listino_concorrenza: '-5', sconto_concorrenza: 150, listino_lav: 'abc' }, colonne),
    ['n_esami', 'listino_concorrenza', 'sconto_concorrenza', 'listino_lav']);
  assert.deepEqual(campiNonValidi({}, colonne), []);
});
