'use strict';
// Il conto di una riga del calcolatore macchinari, come lo fanno salvataggio
// ed export. DEVE restare identico a calcolaRigaClip in public/app.js: quello
// decide cosa l'operatore vede, questo cosa finisce in cronologia e nell'Excel.
// Prima stava scritto dentro la rotta di salvataggio: l'export non poteva
// usarlo, e nessun test lo copriva.
//
// Il prezzo di listino e' della confezione, il costo di una clip si ottiene
// dividendo per i pezzi. Deciso dal cliente (due volte, sapendo la
// conseguenza): senza pezzi si assume 1 — un costo sbagliato di un fattore
// dodici ma visibile, mai un campo silenzioso. Stessa regola per i pezzi Mylav.

const { leggiImporto } = require('./importi');

function calcolaRigaClip(r) {
  const pezziGrezzi = leggiImporto(r.pezzi) || 0;
  const prezzoConfezione = leggiImporto(r.prezzo_confezione) || 0;
  const sconto = leggiImporto(r.sconto_clip) || 0;
  const pezzi = pezziGrezzi > 0 ? pezziGrezzi : 1;
  const costoClip = parseFloat((prezzoConfezione / pezzi * (1 - sconto / 100)).toFixed(2));
  const nClip = leggiImporto(r.n_clip) || 1;
  const totaleClip = costoClip * nClip;

  const nMylav = leggiImporto(r.n_mylav) || 1;
  const listinoLav = leggiImporto(r.listino_lav) || 0;
  const prezzoPiano = leggiImporto(r.prezzo_scontato_lav) || 0;
  const pezziMylavGrezzi = leggiImporto(r.pezzi_mylav) || 0;
  const pezziMylav = pezziMylavGrezzi > 0 ? pezziMylavGrezzi : 1;
  // Senza piano il veterinario paga il listino.
  const totaleMylav = (prezzoPiano > 0 ? prezzoPiano : listinoLav) / pezziMylav * nMylav;

  // Segno invertito rispetto al calcolatore esami: qui positivo vuol dire che
  // la clip costa piu' di Mylav, cioe' conviene Mylav (per chi legge il senso
  // resta lo stesso: positivo = conviene Mylav).
  return {
    pezziGrezzi, prezzoConfezione, sconto, costoClip, nClip, totaleClip,
    nMylav, listinoLav, prezzoPiano, pezziMylavGrezzi, totaleMylav,
    risparmio: totaleClip - totaleMylav
  };
}

module.exports = { calcolaRigaClip };
