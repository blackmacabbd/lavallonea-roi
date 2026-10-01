'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaRigaEsami } = require('./calcoloesami');

// Il caso che ha fatto scrivere questo modulo: a schermo il calcolatore
// diceva concorrenza 150 e risparmio 70, in cronologia finivano 180 e 180.
// Il salvataggio usava uno sconto fisso del 10% invece di quello della riga,
// e senza piano contava Mylav a zero invece che al listino.
test('salva gli stessi numeri che il calcolatore mostra', () => {
  const r = calcolaRigaEsami({ n_esami: 2, listino_concorrenza: 100, sconto_concorrenza: 25,
    listino_lav: 40, prezzo_scontato_lav: 0 });
  assert.equal(r.totaleConcorrenza, 200);
  assert.equal(r.prezzoScontatoConcorrenza, 150);
  assert.equal(r.risparmio, 70, 'senza piano il dottore paga il listino Mylav');
});

test('con il piano il risparmio si misura sul prezzo di piano', () => {
  const r = calcolaRigaEsami({ n_esami: 1, listino_concorrenza: 50, sconto_concorrenza: 10,
    listino_lav: 40, prezzo_scontato_lav: 30 });
  assert.equal(r.prezzoScontatoConcorrenza, 45);
  assert.equal(r.totaleScontatoLav, 30);
  assert.equal(r.risparmio, 15);
});

test('senza sconto la concorrenza costa il suo listino', () => {
  const r = calcolaRigaEsami({ n_esami: 3, listino_concorrenza: 20, sconto_concorrenza: '',
    listino_lav: 0, prezzo_scontato_lav: 0 });
  assert.equal(r.prezzoScontatoConcorrenza, 60);
});

// Senza quantita' propria il lato concorrenza segue quella Mylav, come a schermo.
test('la quantita della concorrenza segue quella Mylav se manca', () => {
  const vuota = calcolaRigaEsami({ n_esami: 4, n_concorrenza: '', listino_concorrenza: 10 });
  assert.equal(vuota.nConcorrenza, 4);
  const propria = calcolaRigaEsami({ n_esami: 4, n_concorrenza: 2, listino_concorrenza: 10 });
  assert.equal(propria.totaleConcorrenza, 20);
});

// I valori arrivano dal browser anche come testo: si leggono come fa lo schermo.
test('accetta numeri scritti come testo', () => {
  const r = calcolaRigaEsami({ n_esami: '2', listino_concorrenza: '100', sconto_concorrenza: '25',
    listino_lav: '40', prezzo_scontato_lav: '' });
  assert.equal(r.risparmio, 70);
});

// Il totale del file ripeteva l'errore per conto suo: sommava i prezzi e
// toglieva il solo prezzo di piano, quindi senza piano il risparmio totale
// era l'intero prezzo della concorrenza. Ora e' la somma dei risparmi delle
// righe, come il «Differenziale totale» a schermo.
test('il risparmio totale e la somma dei risparmi delle righe', () => {
  const { calcolaTotaliEsami } = require('./calcoloesami');
  const t = calcolaTotaliEsami([
    { totale_concorrenza: 200, prezzo_scontato_concorrenza: 150, totale_listino_lav: 80,
      totale_scontato_lav: 0, sconto_concorrenza: 50, sconto_lav: 80, risparmio_dottore: 70 },
    { totale_concorrenza: 50, prezzo_scontato_concorrenza: 45, totale_listino_lav: 40,
      totale_scontato_lav: 30, sconto_concorrenza: 5, sconto_lav: 10, risparmio_dottore: 15 }
  ]);
  assert.equal(t.prezzo_scontato_concorrenza, 195);
  assert.equal(t.risparmio_totale_dottore, 85);
  assert.equal(t.risparmio_pct, 43.6);
});

test('senza righe i totali sono zero', () => {
  const { calcolaTotaliEsami } = require('./calcoloesami');
  const t = calcolaTotaliEsami([]);
  assert.equal(t.risparmio_totale_dottore, 0);
  assert.equal(t.risparmio_pct, 0);
});

// «12,50» scritto nel calcolatore e' 12,5 anche per il salvataggio: con
// parseFloat diventava 12, e la cronologia diceva un numero diverso.
test('il salvataggio legge i numeri con la virgola', () => {
  const r = calcolaRigaEsami({ n_esami: '2', listino_concorrenza: '12,50', sconto_concorrenza: '10',
    listino_lav: '1.234,50', prezzo_scontato_lav: '' });
  assert.equal(r.totaleConcorrenza, 25);
  assert.equal(r.prezzoScontatoConcorrenza, 22.5);
  assert.equal(r.totaleListinoLav, 2469);
});
