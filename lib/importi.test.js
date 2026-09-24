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
