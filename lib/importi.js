// Lettura degli importi: dalle celle di un listino importato da Excel e dai
// campi che l'operatore scrive a mano. Sta in un modulo a parte per poterla
// provare: e' il punto in cui un errore sposta un prezzo di un fattore mille
// senza che nessuno se ne accorga.
//
// Lo stesso file gira sul server (require) e nel browser (servito come
// /importi.js, espone window.Importi): una regola sola, cosi' cio' che lo
// schermo mostra e cio' che il server salva non possono piu' divergere. Prima
// il browser ne aveva una copia e in molti punti usava parseFloat, che si
// ferma alla virgola: «12,50» diventava 12.
(function (radice, fabbrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabbrica();
  else radice.Importi = fabbrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Un importo come lo scrive un listino italiano. Si tolgono simbolo
  // dell'euro, spazi e ogni altro carattere che non sia cifra, punto, virgola
  // o segno. Se resta una virgola, i punti sono separatori delle migliaia e la
  // virgola e' il decimale ("3.297,54" -> 3297.54, "€ 140,00" -> 140); senza
  // virgola il punto e' il decimale ("3297.54" -> 3297.54). Una cella che
  // l'Excel ha gia' letto come numero passa com'e'.
  //
  // Unico caso ambiguo: "1.234" senza virgola si legge 1,234 e non
  // milleduecentotrentaquattro. Un listino che scrive cosi' le migliaia senza
  // decimali va corretto nel file.
  function leggiImporto(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).replace(/[^\d.,-]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // I pezzi di una confezione: solo un intero positivo, altrimenti niente.
  // "10 pz" -> 10; "2,5", "0", "-3", "" -> null. Un numero di pezzi che non e'
  // un intero positivo non e' un dato, e va lasciato vuoto invece di inventarlo.
  function leggiPezziCella(v) {
    const n = leggiImporto(v);
    return n != null && Number.isInteger(n) && n > 0 ? n : null;
  }

  // Limiti di buon senso per cio' che l'operatore scrive. Prima il server
  // accettava prezzi negativi, sconti del 150% (prezzo finale negativo) e un
  // miliardo di esami, e trasformava in 0 senza dirlo il testo scritto al
  // posto di un numero.
  const LIMITI = {
    prezzo:   { min: 0, max: 10000000, intero: false },
    sconto:   { min: 0, max: 100,      intero: false },
    quantita: { min: 1, max: 100000,   intero: true },
    pezzi:    { min: 1, max: 100000,   intero: true }
  };

  // Il limite di una colonna dal suo nome, uguale per i due calcolatori e per
  // il server: n_* e' una quantita', pezzi* sono pezzi, sconto* e' uno sconto,
  // tutto il resto e' un prezzo.
  function tipoCampo(colonna) {
    const c = String(colonna || '');
    if (/^n_/.test(c)) return 'quantita';
    if (/^pezzi/.test(c)) return 'pezzi';
    if (/^sconto/.test(c)) return 'sconto';
    return 'prezzo';
  }

  // Un campo scritto a mano: { vuoto: true } se lasciato vuoto, { valore } se
  // e' un numero accettabile, { errore: true } altrimenti. Vuoto e sbagliato
  // vanno distinti: un campo vuoto e' una scelta (prende il valore di
  // ripiego), uno sbagliato va fatto correggere.
  function leggiCampo(v, tipo) {
    if (v == null || String(v).trim() === '') return { vuoto: true };
    const n = leggiImporto(v);
    const lim = LIMITI[tipo] || LIMITI.prezzo;
    if (n == null || n < lim.min || n > lim.max || (lim.intero && !Number.isInteger(n))) return { errore: true };
    return { valore: n };
  }

  // Le colonne di una riga che hanno un valore sbagliato (non quelle vuote).
  // La usano il salvataggio dei calcolatori nel browser, per dire all'operatore
  // cosa correggere, e il server, che rifiuta la riga se il browser non l'ha fatto.
  function campiNonValidi(riga, colonne) {
    return colonne.filter(c => leggiCampo(riga && riga[c], tipoCampo(c)).errore);
  }

  return { leggiImporto, leggiPezziCella, leggiCampo, tipoCampo, campiNonValidi, LIMITI };
});
