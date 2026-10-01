'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaRigaClip } = require('./calcoloclip');

// Caso fatto a mano: confezione da 120 € con 12 pezzi, sconto 10% -> 9 € a
// clip; 3 clip = 27 €. Mylav: piano 20 € per 2 pezzi, 3 esami -> 30 €.
// Differenza -3: la clip costa meno, non conviene Mylav.
test('il conto di una riga macchinari', () => {
  const r = calcolaRigaClip({ n_clip: 3, prezzo_confezione: 120, pezzi: 12, sconto_clip: 10,
    n_mylav: 3, pezzi_mylav: 2, listino_lav: 30, prezzo_scontato_lav: 20 });
  assert.equal(r.costoClip, 9);
  assert.equal(r.totaleClip, 27);
  assert.equal(r.totaleMylav, 30);
  assert.equal(r.risparmio, -3);
});

test('senza pezzi si assume 1, senza piano si usa il listino', () => {
  const r = calcolaRigaClip({ n_clip: 2, prezzo_confezione: 10, pezzi: '', n_mylav: 1, listino_lav: 15, prezzo_scontato_lav: '' });
  assert.equal(r.costoClip, 10);
  assert.equal(r.totaleClip, 20);
  assert.equal(r.totaleMylav, 15);
  assert.equal(r.risparmio, 5);
});

test('legge i numeri con la virgola', () => {
  const r = calcolaRigaClip({ n_clip: '1', prezzo_confezione: '1.200,50', pezzi: '10', sconto_clip: '',
    n_mylav: '1', listino_lav: '12,50', prezzo_scontato_lav: '' });
  assert.equal(r.costoClip, 120.05);
  assert.equal(r.totaleMylav, 12.5);
});
