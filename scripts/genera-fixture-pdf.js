// Genera le fixture PDF usate da lib/pdfestrazione.test.js.
// Non serve rieseguirlo: i PDF prodotti sono versionati in lib/fixtures/.
// Rieseguire solo se si cambia il contenuto delle fixture:
//   node scripts/genera-fixture-pdf.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUT = path.join(__dirname, '..', 'lib', 'fixtures');

// Listino a due pagine che imita un vero listino esami: intestazione, tabella
// nome/prezzo, e rumore da scartare (numero di pagina, nota legale).
const LISTINO_HTML = `
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 15mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #26262a; }
  .marchio { font-size: 14pt; font-weight: bold; letter-spacing: 2px; }
  h1 { font-size: 13pt; margin: 6mm 0 4mm; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9pt; border-bottom: 1px solid #0f76bc; padding: 2mm 0; }
  td { padding: 1.6mm 0; }
  td.prezzo { text-align: right; }
  .nota { font-size: 7pt; color: #666; margin-top: 6mm; }
  .piede { font-size: 7pt; color: #999; margin-top: 4mm; }
  .pagina2 { page-break-before: always; }
</style></head><body>
  <div class="marchio">MYLAV - LA VALLONEA</div>
  <h1>Listino Esami di Laboratorio 2026</h1>
  <table>
    <tr><th>Esame</th><th style="text-align:right">Prezzo</th></tr>
    <tr><td>EMOCROMO COMPLETO</td><td class="prezzo">18,50</td></tr>
    <tr><td>PROFILO BIOCHIMICO COMPLETO</td><td class="prezzo">42,00</td></tr>
    <tr><td>ESAME URINE COMPLETO</td><td class="prezzo">15,00</td></tr>
    <tr><td>T4 TOTALE</td><td class="prezzo">22,90</td></tr>
  </table>
  <div class="nota">I prezzi sono espressi in euro e non comprendono IVA. Listino soggetto a variazioni.</div>
  <div class="piede">Pagina 1 di 2</div>

  <div class="pagina2">
    <div class="marchio">MYLAV - LA VALLONEA</div>
    <table>
      <tr><th>Esame</th><th style="text-align:right">Prezzo</th></tr>
      <tr><td>COAGULAZIONE PT APTT</td><td class="prezzo">28,00</td></tr>
      <tr><td>LEISHMANIA IFI</td><td class="prezzo">31,50</td></tr>
    </table>
    <div class="piede">Pagina 2 di 2</div>
  </div>
</body></html>`;

// Righe spezzate in piu frammenti di testo: i PDF prodotti da Chrome emettono
// run interi, i listini reali spezzano le parole a meta. Il cambio di font
// forza frammenti separati adiacenti (da unire senza spazio) mentre il padding
// crea un buco moderato (da rendere con uno spazio solo).
const FRAMMENTI_HTML = `
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; }
  .riga { margin-bottom: 4mm; }
  b { font-weight: bold; }
  .distanziato { padding-left: 6pt; }
</style></head><body>
  <div class="riga"><b>EMOCRO</b>MO COMPLETO</div>
  <div class="riga">ESAME<span class="distanziato">CODICE</span></div>
</body></html>`;

// PDF di sola immagine (nessun testo incorporato): simula uno scansionato.
// PNG 2x2 grigio in data URI, ingrandito a tutta pagina.
const PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4' +
  'AWP4z8DwHwxpAAAAAP//AwDPAgP8h4kUAAAAAElFTkSuQmCC';

const SCANSIONE_HTML = `
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  body { margin: 0; }
  img { width: 100%; height: 100vh; display: block; }
</style></head><body><img src="${PNG_2X2}"></body></html>`;

async function scrivi(browser, html, nomeFile) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await page.close();
  const dest = path.join(OUT, nomeFile);
  fs.writeFileSync(dest, pdf);
  console.log(`  ✓ ${nomeFile} (${pdf.length} byte)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    await scrivi(browser, LISTINO_HTML, 'listino-testo.pdf');
    await scrivi(browser, FRAMMENTI_HTML, 'righe-frammentate.pdf');
    await scrivi(browser, SCANSIONE_HTML, 'listino-scansionato.pdf');
  } finally {
    await browser.close();
  }
  console.log(`Fixture scritte in ${OUT}`);
})().catch(err => {
  console.error('Generazione fixture fallita:', err);
  process.exit(1);
});
