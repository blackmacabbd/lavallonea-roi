/* Ricerca tollerante per gli elenchi dell'applicazione.
 *
 * Sta qui e non in lib/ perche' gira nel browser, ma e' logica pura e i suoi
 * test (lib/ricerca.test.js) caricano questo stesso file in una sandbox.
 *
 * Regole, decise sui nomi dei listini reali:
 * - accenti e maiuscole ignorati;
 * - le parole cercate possono comparire in qualsiasi ordine, ma devono
 *   comparire tutte;
 * - si tollera un errore di battitura, e la tolleranza cresce con la lunghezza
 *   della parola. Sotto i 4 caratteri non si tollera nulla: su "TSH" a distanza
 *   1 si troverebbe mezzo listino.
 */
(function () {
  'use strict';

  const SOGLIA_TOLLERANZA = 4;   // sotto questa lunghezza, solo corrispondenza esatta
  const LUNGHEZZA_DUE_ERRORI = 7; // da qui in su si tollerano due errori

  function normalizza(testo) {
    return String(testo == null ? '' : testo)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // via i segni diacritici
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function erroriTollerati(lunghezza) {
    if (lunghezza < SOGLIA_TOLLERANZA) return 0;
    return lunghezza >= LUNGHEZZA_DUE_ERRORI ? 2 : 1;
  }

  // Distanza di modifica con uscita anticipata: non serve il valore esatto, solo
  // sapere se sta entro il massimo. Due righe invece della matrice intera.
  function entroDistanza(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    if (a === b) return true;
    let precedente = new Array(b.length + 1);
    let corrente = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) precedente[j] = j;
    for (let i = 1; i <= a.length; i++) {
      corrente[0] = i;
      let minimoRiga = corrente[0];
      for (let j = 1; j <= b.length; j++) {
        const costo = a[i - 1] === b[j - 1] ? 0 : 1;
        corrente[j] = Math.min(
          precedente[j] + 1,        // cancellazione
          corrente[j - 1] + 1,      // inserimento
          precedente[j - 1] + costo // sostituzione
        );
        if (corrente[j] < minimoRiga) minimoRiga = corrente[j];
      }
      // Se l'intera riga ha superato il massimo, nessun percorso puo' rientrare.
      if (minimoRiga > max) return false;
      const scambio = precedente; precedente = corrente; corrente = scambio;
    }
    return precedente[b.length] <= max;
  }

  function parolaCorrisponde(paroleTesto, testoIntero, parola) {
    if (testoIntero.includes(parola)) return true;
    const max = erroriTollerati(parola.length);
    if (!max) return false;
    return paroleTesto.some(p => entroDistanza(p, parola, max));
  }

  function corrisponde(testo, query) {
    const q = normalizza(query);
    if (!q) return true;
    const t = normalizza(testo);
    if (!t) return false;
    const paroleTesto = t.split(/[^a-z0-9]+/).filter(Boolean);
    return q.split(' ').every(parola => parolaCorrisponde(paroleTesto, t, parola));
  }

  window.Ricerca = { normalizza, corrisponde };
})();
