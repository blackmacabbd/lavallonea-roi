'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { foglioCalcolo } = require('./esporta');

const colonneEsami = [
  { chiave: 'esame_concorrente', titolo: 'Esame conc.' }, { chiave: 'n_concorrenza', titolo: 'N.' },
  { chiave: 'listino_concorrenza', titolo: 'Listino conc.' }, { chiave: 'sconto_concorrenza', titolo: 'Sconto%' },
  { chiave: 'prezzo_conc', titolo: 'Scontato conc.' }, { chiave: 'esame', titolo: 'Esame Mylav' },
  { chiave: 'n_esami', titolo: 'N.' }, { chiave: 'listino_lav', titolo: 'Listino Myl' },
  { chiave: 'tot_prezzo_lav', titolo: 'Tot. sc. Myl' }, { chiave: 'risparmio', titolo: 'Risparmio' }
];

// Il caso del difetto: l'Excel diceva «prezzo vet med scontato» e
// «LISTINO LAVALLONEA», senza risparmio ne' esame concorrente. Ora le colonne
// sono quelle dello schermo, e i numeri quelli del salvataggio.
test('il foglio esami ha le colonne dello schermo, i numeri del salvataggio e il totale', () => {
  const f = foglioCalcolo({
    tipo: 'esami', titoloTotale: 'TOTALE',
    intestazione: [['Struttura', 'Clinica X'], ['Piano', 'GOLD PACK 2026']],
    colonne: colonneEsami,
    righe: [
      { esame_concorrente: 'EMOCROMO', listino_concorrenza: '100', sconto_concorrenza: '25', esame: 'tt4', n_esami: 2, listino_lav: 40, prezzo_scontato_lav: 30 },
      { esame_concorrente: 'ALTRO', listino_concorrenza: 50, esame: 'urine', n_esami: 1, listino_lav: 20, prezzo_scontato_lav: '' }
    ]
  });
  assert.deepEqual(f.righe[0], ['Struttura', 'Clinica X']);
  assert.deepEqual(f.righe[1], ['Piano', 'GOLD PACK 2026']);
  assert.deepEqual(f.righe[3], colonneEsami.map(c => c.titolo));
  // riga 1: conc 100*2=200 -25% = 150; Mylav 30*2 = 60; risparmio 90
  assert.deepEqual(f.righe[4], ['EMOCROMO', 2, 100, 25, 150, 'tt4', 2, 40, 60, 90]);
  // riga 2: conc 50; senza piano Mylav paga il listino 20; risparmio 30
  assert.deepEqual(f.righe[5], ['ALTRO', 1, 50, '', 50, 'urine', 1, 20, '', 30]);
  assert.deepEqual(f.righe[6], ['TOTALE', '', '', '', 200, '', '', '', 60, 120]);
  assert.equal(f.primaRigaDati, 4);
  assert.equal(f.ultimaRigaDati, 5);
  assert.deepEqual(f.colonneEuro, [2, 4, 7, 8, 9]);
});

test('il foglio macchinari usa la formula del salvataggio', () => {
  const f = foglioCalcolo({
    tipo: 'clip',
    colonne: [{ chiave: 'clip_nome', titolo: 'Clip' }, { chiave: 'costo_clip', titolo: 'Costo/clip' },
      { chiave: 'totale_clip', titolo: 'Tot. clip' }, { chiave: 'totale_mylav', titolo: 'Tot. Mylav' }, { chiave: 'risparmio', titolo: 'Diff.' }],
    righe: [{ clip_nome: 'Chem 10', n_clip: 3, prezzo_confezione: 120, pezzi: 12, sconto_clip: 10, n_mylav: 3, pezzi_mylav: 2, listino_lav: 30, prezzo_scontato_lav: 20 }]
  });
  assert.deepEqual(f.righe[0], ['Clip', 'Costo/clip', 'Tot. clip', 'Tot. Mylav', 'Diff.']);
  assert.deepEqual(f.righe[1], ['Chem 10', 9, 27, 30, -3]);
  assert.deepEqual(f.righe[2], ['Totale', '', 27, 30, -3]);
});

test('un tipo sconosciuto e\' un errore', () => {
  assert.throws(() => foglioCalcolo({ tipo: 'altro', colonne: [], righe: [] }));
});
