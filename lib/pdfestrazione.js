// Stadio 1 dell'import PDF: estrazione grezza posizionale.
//
// Restituisce le righe di testo del PDF con il loro bounding box, senza
// interpretare il contenuto: nessun filtro su intestazioni, note o numeri di
// pagina. L'interpretazione avviene nello stadio 2 (lib/pdfclassifica.js).
// Le coordinate servono a evidenziare sul PDF cio che e stato riconosciuto.

const path = require('path');

// pdfjs, in Node, tenta di importare `canvas` per il rendering e logga due
// warning quando manca. Qui non si rende nulla (solo getTextContent), quindi
// si dichiarano gli stub prima del require per non sporcare i log ad ogni boot.
// Il rendering avviene nel browser, dove DOMMatrix e Path2D sono nativi.
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class DOMMatrix {};
if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class Path2D {};

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const STANDARD_FONTS = path.join(
  path.dirname(require.resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
);

// Tolleranza verticale per considerare due frammenti sulla stessa riga:
// frazione dell'altezza del carattere. Sotto il 60% del corpo, due baseline
// diverse appartengono alla stessa riga tipografica (apici, font misti).
const TOLLERANZA_RIGA = 0.6;

// Spazio implicito: se il buco orizzontale tra due frammenti supera questa
// frazione del corpo, i frammenti sono parole distinte.
const SOGLIA_SPAZIO = 0.25;

function erroreEstrazione(codice, messaggio, dettaglio) {
  const err = new Error(messaggio);
  err.codice = codice;
  // Causa tecnica separata dal messaggio, cosi' il client puo' tradurre la
  // frase attorno a un segnaposto senza perdere il dettaglio (es. il motivo
  // esatto per cui pdfjs non ha aperto il file).
  if (dettaglio != null) err.dettaglio = dettaglio;
  return err;
}

async function apriDocumento(buffer) {
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: STANDARD_FONTS,
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw erroreEstrazione('PDF_PROTETTO',
        'Il PDF e protetto da password: rimuovi la protezione e ricarica il file.');
    }
    const dettaglioTecnico = err && err.message ? err.message : 'formato non riconosciuto';
    throw erroreEstrazione('PDF_NON_VALIDO',
      `Il file non e un PDF leggibile: ${dettaglioTecnico}`, dettaglioTecnico);
  }
}

// Frammenti di testo di una pagina, con box in coordinate top-down (punti).
function frammentiDiPagina(textContent, viewport) {
  const out = [];
  for (const item of textContent.items) {
    if (typeof item.str !== 'string' || item.str.trim() === '') continue;
    // Composizione con la matrice del viewport: porta l'origine in alto a
    // sinistra, come nel canvas del browser a scala 1.
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const corpo = Math.hypot(t[2], t[3]) || Math.abs(item.height) || 0;
    const larghezza = Math.abs(item.width);
    if (!(corpo > 0) || !(larghezza > 0)) continue;
    out.push({
      testo: item.str,
      x: t[4],
      yBase: t[5],       // baseline, top-down
      yTop: t[5] - corpo, // bordo superiore approssimato col corpo del carattere
      w: larghezza,
      h: corpo
    });
  }
  return out;
}

// Raggruppa i frammenti in righe tipografiche e ne unisce testo e box.
function raggruppaInRighe(frammenti, pagina) {
  const ordinati = frammenti.slice().sort((a, b) => a.yBase - b.yBase || a.x - b.x);
  const gruppi = [];
  for (const f of ordinati) {
    const ultimo = gruppi[gruppi.length - 1];
    const tol = TOLLERANZA_RIGA * Math.max(f.h, ultimo ? ultimo.h : 0);
    if (ultimo && Math.abs(f.yBase - ultimo.yBase) <= tol) {
      ultimo.items.push(f);
      ultimo.h = Math.max(ultimo.h, f.h);
    } else {
      gruppi.push({ yBase: f.yBase, h: f.h, items: [f] });
    }
  }

  return gruppi.map(g => {
    const items = g.items.slice().sort((a, b) => a.x - b.x);
    let testo = '';
    let prec = null;
    for (const it of items) {
      if (prec) {
        const buco = it.x - (prec.x + prec.w);
        const serveSpazio = buco > SOGLIA_SPAZIO * Math.max(it.h, prec.h);
        if (serveSpazio) testo += ' ';
      }
      testo += it.testo;
      prec = it;
    }
    // Normalizza gli spazi: i buchi di una tabella diventano un separatore solo.
    testo = testo.replace(/\s+/g, ' ').trim();

    const x = Math.min(...items.map(i => i.x));
    const y = Math.min(...items.map(i => i.yTop));
    const destra = Math.max(...items.map(i => i.x + i.w));
    const basso = Math.max(...items.map(i => i.yTop + i.h));
    return { pagina, testo, x, y, w: destra - x, h: basso - y };
  }).filter(r => r.testo !== '');
}

/**
 * Estrae le righe di testo posizionate di un PDF.
 *
 * @param {Buffer|Uint8Array} buffer contenuto del file
 * @returns {Promise<{
 *   pagine: number,
 *   dimensioni: Array<{pagina:number,width:number,height:number}>,
 *   righe: Array<{pagina:number,testo:string,x:number,y:number,w:number,h:number}>
 * }>} coordinate in punti PDF, origine in alto a sinistra (y top-down)
 * @throws errore con `.codice`: PDF_VUOTO, PDF_NON_VALIDO, PDF_PROTETTO, PDF_SENZA_TESTO
 */
async function estraiRigheGrezze(buffer) {
  if (!buffer || !buffer.length) {
    throw erroreEstrazione('PDF_VUOTO', 'File vuoto.');
  }
  const doc = await apriDocumento(buffer);
  const dimensioni = [];
  const righe = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      dimensioni.push({ pagina: n, width: viewport.width, height: viewport.height });
      const contenuto = await page.getTextContent();
      righe.push(...raggruppaInRighe(frammentiDiPagina(contenuto, viewport), n));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  if (righe.length === 0) {
    throw erroreEstrazione('PDF_SENZA_TESTO',
      'Il PDF non contiene testo incorporato: sembra scansionato. Serve un PDF non scansionato.');
  }

  righe.sort((a, b) => a.pagina - b.pagina || a.y - b.y || a.x - b.x);
  return { pagine: doc.numPages, dimensioni, righe };
}

module.exports = { estraiRigheGrezze };
