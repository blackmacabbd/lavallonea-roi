'use strict';
// Lettura degli importi e dei pezzi dalle celle di un listino importato da
// Excel. Sta in un modulo a parte per poterla provare: e' il punto in cui un
// errore sposta un prezzo di un fattore mille senza che nessuno se ne accorga.
//
// La stessa leggiImporto esiste identica in public/app.js, per il conteggio
// dell'anteprima dell'import: se si cambia qui va cambiata la', altrimenti
// l'anteprima direbbe un numero di righe e il server ne importerebbe un altro.

// Un importo come lo scrive un listino italiano. Si tolgono simbolo dell'euro,
// spazi e ogni altro carattere che non sia cifra, punto, virgola o segno. Se
// resta una virgola, i punti sono separatori delle migliaia e la virgola e' il
// decimale ("3.297,54" -> 3297.54, "€ 140,00" -> 140); senza virgola il punto
// e' il decimale ("3297.54" -> 3297.54). Una cella che l'Excel ha gia' letto
// come numero passa com'e'.
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
// "10 pz" -> 10; "2,5", "0", "-3", "" -> null. Un numero di pezzi che non e' un
// intero positivo non e' un dato, e va lasciato vuoto invece di inventarlo.
function leggiPezziCella(v) {
  const n = leggiImporto(v);
  return n != null && Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { leggiImporto, leggiPezziCella };
