'use strict';
// Il foglio Excel che il cliente riceve dai due calcolatori. Le colonne sono
// quelle che l'operatore vede a schermo, nello stesso ordine e con gli stessi
// titoli (tradotti dal browser): l'Excel e' una fotografia del calcolo, non un
// formato a parte. Prima le intestazioni erano fisse e vecchie («prezzo vet
// med scontato», «LISTINO LAVALLONEA», «prezzo lav. Platinum»), mancavano
// risparmio, esame concorrente e piano, e non c'erano totali.
//
// I numeri si ricalcolano qui con le stesse formule del salvataggio
// (calcoloesami, calcoloclip): i campi calcolati mandati dal browser non contano.

const { calcolaRigaEsami } = require('./calcoloesami');
const { calcolaRigaClip } = require('./calcoloclip');
const { leggiImporto } = require('./importi');

const num = v => leggiImporto(v) || 0;

// Valore di ogni colonna, per chiave (col.col nel browser). I testi passano
// com'erano; i numeri sono numeri, cosi' l'Excel li somma e li formatta.
function valoriEsami(r) {
  const c = calcolaRigaEsami(r);
  return {
    esame_concorrente: r.esame_concorrente || '', n_concorrenza: c.nConcorrenza,
    listino_concorrenza: c.listinoConcorrenza, sconto_concorrenza: num(r.sconto_concorrenza) || '',
    tot_conc: c.totaleConcorrenza, prezzo_conc: c.prezzoScontatoConcorrenza,
    esame: r.esame || '', n_esami: c.n, listino_lav: c.listinoLav, tot_listino_lav: c.totaleListinoLav,
    prezzo_scontato_lav: c.prezzoScontatoLav || '', tot_prezzo_lav: c.totaleScontatoLav || '',
    risparmio: c.risparmio
  };
}
function valoriClip(r) {
  const c = calcolaRigaClip(r);
  return {
    struttura: r.struttura || '', listino_conc: r.listino_conc || '', laboratorio: r.laboratorio || '',
    clip_nome: r.clip_nome || '', n_clip: c.nClip, prezzo_confezione: c.prezzoConfezione,
    pezzi: c.pezziGrezzi || '', sconto_clip: c.sconto || '', costo_clip: c.costoClip, totale_clip: c.totaleClip,
    listino_mylav: r.listino_mylav || '', profilo_mylav: r.profilo_mylav || '', n_mylav: c.nMylav,
    pezzi_mylav: c.pezziMylavGrezzi || '', listino_lav: c.listinoLav, prezzo_scontato_lav: c.prezzoPiano || '',
    totale_mylav: c.totaleMylav, risparmio: c.risparmio
  };
}

// Le colonne che si sommano nella riga di totale (gli importi, non prezzi
// unitari ne' quantita').
const DA_SOMMARE = {
  esami: ['tot_conc', 'prezzo_conc', 'tot_listino_lav', 'tot_prezzo_lav', 'risparmio'],
  clip: ['totale_clip', 'totale_mylav', 'risparmio']
};
// Le colonne in euro (formato valuta nell'Excel).
const IN_EURO = {
  esami: ['listino_concorrenza', 'tot_conc', 'prezzo_conc', 'listino_lav', 'tot_listino_lav', 'prezzo_scontato_lav', 'tot_prezzo_lav', 'risparmio'],
  clip: ['prezzo_confezione', 'costo_clip', 'totale_clip', 'listino_lav', 'prezzo_scontato_lav', 'totale_mylav', 'risparmio']
};

// tipo: 'esami' | 'clip'. intestazione: [[etichetta, valore], ...] in cima al
// foglio (struttura, piano, laboratorio, data). colonne: [{ chiave, titolo }].
// Ritorna { righe: array di array per aoa_to_sheet, colonneEuro: indici,
// primaRigaDati, ultimaRigaDati } (indici 0-based).
function foglioCalcolo({ tipo, intestazione, colonne, righe, titoloTotale }) {
  if (!DA_SOMMARE[tipo]) throw new Error('Tipo di export sconosciuto');
  const valori = tipo === 'esami' ? valoriEsami : valoriClip;
  const cols = (colonne || []).filter(c => c && c.chiave);
  const out = [];
  for (const [etichetta, valore] of (intestazione || [])) out.push([etichetta, valore == null ? '' : valore]);
  if (out.length) out.push([]);
  out.push(cols.map(c => c.titolo || c.chiave));
  const primaRigaDati = out.length;
  const somme = {};
  for (const r of (righe || [])) {
    const v = valori(r);
    out.push(cols.map(c => v[c.chiave] == null ? '' : v[c.chiave]));
    for (const k of DA_SOMMARE[tipo]) somme[k] = (somme[k] || 0) + (Number(v[k]) || 0);
  }
  const ultimaRigaDati = out.length - 1;
  // Riga di totale: il titolo nella prima colonna, le somme sotto le loro.
  out.push(cols.map((c, i) => DA_SOMMARE[tipo].includes(c.chiave)
    ? Math.round(somme[c.chiave] * 100) / 100
    : (i === 0 ? (titoloTotale || 'Totale') : '')));
  const colonneEuro = cols.map((c, i) => IN_EURO[tipo].includes(c.chiave) ? i : -1).filter(i => i >= 0);
  return { righe: out, colonneEuro, primaRigaDati, ultimaRigaDati };
}

module.exports = { foglioCalcolo };
