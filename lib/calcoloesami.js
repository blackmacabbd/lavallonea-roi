'use strict';
// Il conto di una riga del calcolatore esami, come lo fa il salvataggio.
// DEVE restare identico a calcolaRigaRoi in public/app.js: quello decide cosa
// l'operatore vede, questo cosa finisce in cronologia. Quando erano diversi,
// a schermo si leggeva un risparmio di 70 e in cronologia ne finiva uno di 180.

const { leggiImporto } = require('./importi');

// Con la regola dei listini italiani: «12,50» e' 12,5 (parseFloat dava 12).
const num = v => leggiImporto(v) || 0;
const due = v => parseFloat(v.toFixed(2));

function calcolaRigaEsami(r) {
  const n = num(r.n_esami) || 1;
  // Senza quantita' propria il lato concorrenza segue quella Mylav.
  const nConcorrenza = num(r.n_concorrenza) || n;
  const listinoConcorrenza = num(r.listino_concorrenza);
  const sconto = num(r.sconto_concorrenza);
  const listinoLav = num(r.listino_lav);
  const prezzoScontatoLav = num(r.prezzo_scontato_lav);

  const totaleConcorrenza = listinoConcorrenza * nConcorrenza;
  const prezzoScontatoConcorrenza = due(totaleConcorrenza * (sconto > 0 ? 1 - sconto / 100 : 1));
  const totaleListinoLav = listinoLav * n;
  const totaleScontatoLav = prezzoScontatoLav * n;
  // Senza piano il dottore paga il listino: contare Mylav a zero darebbe un
  // risparmio pari all'intero prezzo della concorrenza.
  const costoMylav = totaleScontatoLav > 0 ? totaleScontatoLav : totaleListinoLav;

  return {
    n, nConcorrenza, listinoConcorrenza, listinoLav, prezzoScontatoLav,
    totaleConcorrenza, prezzoScontatoConcorrenza, totaleListinoLav, totaleScontatoLav,
    risparmio: prezzoScontatoConcorrenza - costoMylav
  };
}

// I totali di un file salvato. Il risparmio e' la somma di quelli delle
// righe, gia' calcolati al salvataggio: rifarlo qui come «concorrenza meno
// prezzo di piano» ripeteva l'errore di prima, e senza piano dava come
// risparmio l'intero prezzo della concorrenza.
function calcolaTotaliEsami(dati) {
  const t = dati.reduce((acc, d) => {
    acc.totale_concorrenza          += d.totale_concorrenza          || 0;
    acc.prezzo_scontato_concorrenza += d.prezzo_scontato_concorrenza || 0;
    acc.totale_listino_lav          += d.totale_listino_lav          || 0;
    acc.totale_scontato_lav         += d.totale_scontato_lav         || 0;
    acc.sconto_totale_concorrenza   += d.sconto_concorrenza          || 0;
    acc.sconto_totale_lav           += d.sconto_lav                  || 0;
    acc.risparmio_totale_dottore    += d.risparmio_dottore           || 0;
    return acc;
  }, {
    totale_concorrenza: 0,
    prezzo_scontato_concorrenza: 0,
    totale_listino_lav: 0,
    totale_scontato_lav: 0,
    sconto_totale_concorrenza: 0,
    sconto_totale_lav: 0,
    risparmio_totale_dottore: 0
  });

  t.risparmio_pct = t.prezzo_scontato_concorrenza > 0
    ? +((t.risparmio_totale_dottore / t.prezzo_scontato_concorrenza) * 100).toFixed(1)
    : 0;
  return t;
}

module.exports = { calcolaRigaEsami, calcolaTotaliEsami };
