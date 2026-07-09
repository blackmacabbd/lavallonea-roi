'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRigheDaTesto } = require('./pdfimport.js');

// Testo che imita l'output reale di pdf-parse sul listino IDEXX:
// nome su una riga, descrizione/materiale in mezzo, riga-prezzo coi due importi incollati + codice.
const TESTO = [
  'Profili di Routine Cane e Gatto (possono essere integrati con Add-on)',
  'Check-up completo (cane, gatto) Il nostro profilo più',
  'Quadro ematico completo, urea-N (BUN), creatinina, IDEXX',
  '1 ml siero + 1 – 2 ml',
  'sangue EDTA',
  'in giornata53,5091,38GCUPI',
  'Check-up (cane, gatto)',
  'Check-up completo (comprensivo di IDEXX SDMA), senza',
  'quadro ematico',
  '1 ml sieroin giornata47,7081,47CUPI',
  'Esame  Materiale  Tempi',
  'in giornata12,5021,35GALLS'
].join('\n');

test('parseRigheDaTesto associa nome->prezzo e prende il prezzo Vet (primo)', () => {
  const { righe } = parseRigheDaTesto(TESTO);
  assert.equal(righe.length, 2);
  assert.deepEqual(righe[0], { nome_originale: 'Check-up completo (cane, gatto) Il nostro profilo più', prezzo: 53.50, code: 'GCUPI' });
  assert.deepEqual(righe[1], { nome_originale: 'Check-up (cane, gatto)', prezzo: 47.70, code: 'CUPI' });
});

test('parseRigheDaTesto non usa le intestazioni come nome e conta le righe-prezzo orfane', () => {
  const { righe, scartate } = parseRigheDaTesto(TESTO);
  // la riga "in giornata12,5021,35GALLS" e' preceduta solo dall'intestazione "Esame Materiale Tempi"
  assert.ok(!righe.some(r => /GALLS/.test(r.code)));
  assert.equal(scartate, 1);
});

test('parseRigheDaTesto parsa i migliaia IT e i prezzi a 3 cifre incollati', () => {
  const testo = ['Esame istologico complesso', 'in giornata1.234,50115,29ISTX'].join('\n');
  const { righe } = parseRigheDaTesto(testo);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 1234.50);
  assert.equal(righe[0].code, 'ISTX');
});

test('parseRigheDaTesto scarta nomi troppo corti (< 3 char)', () => {
  const testo = ['AB', 'in giornata10,0012,00XYZ'].join('\n');
  const { righe, scartate } = parseRigheDaTesto(testo);
  assert.equal(righe.length, 0);
  assert.equal(scartate, 1);
});

test('parseRigheDaTesto: testo vuoto -> nessuna riga', () => {
  assert.deepEqual(parseRigheDaTesto(''), { righe: [], scartate: 0 });
});
