const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { estraiRigheGrezze } = require('./pdfestrazione');

const FIX = path.join(__dirname, 'fixtures');
const listino = () => fs.readFileSync(path.join(FIX, 'listino-testo.pdf'));
const frammentate = () => fs.readFileSync(path.join(FIX, 'righe-frammentate.pdf'));
const scansionato = () => fs.readFileSync(path.join(FIX, 'listino-scansionato.pdf'));

// Cache: aprire il PDF una volta sola, i test leggono lo stesso risultato.
let _estratto = null;
async function estratto() {
  if (!_estratto) _estratto = await estraiRigheGrezze(listino());
  return _estratto;
}

const rigaCon = (righe, frammento) =>
  righe.find(r => r.testo.includes(frammento));

test('estrae tutte le pagine del PDF', async () => {
  const res = await estratto();
  assert.strictEqual(res.pagine, 2);
});

test('restituisce le dimensioni di ogni pagina in punti', async () => {
  const res = await estratto();
  assert.strictEqual(res.dimensioni.length, 2);
  const p1 = res.dimensioni[0];
  assert.strictEqual(p1.pagina, 1);
  // A4 = 595x842 pt circa
  assert.ok(p1.width > 580 && p1.width < 610, `width inattesa: ${p1.width}`);
  assert.ok(p1.height > 830 && p1.height < 850, `height inattesa: ${p1.height}`);
});

test('raggruppa nome esame e prezzo nella stessa riga', async () => {
  const { righe } = await estratto();
  const r = rigaCon(righe, 'EMOCROMO COMPLETO');
  assert.ok(r, 'riga EMOCROMO non trovata');
  assert.ok(r.testo.includes('18,50'), `prezzo non sulla stessa riga: "${r.testo}"`);
  assert.strictEqual(r.pagina, 1);
});

test('non spezza le parole e non lascia spazi doppi', async () => {
  const { righe } = await estratto();
  const r = rigaCon(righe, 'PROFILO BIOCHIMICO');
  assert.ok(r, 'riga PROFILO BIOCHIMICO non trovata');
  assert.ok(r.testo.includes('PROFILO BIOCHIMICO COMPLETO'),
    `parole spezzate o spaziate male: "${r.testo}"`);
  assert.ok(!/ {2}/.test(r.testo), `spazi doppi in: "${r.testo}"`);
});

test('ogni riga ha un bounding box valido dentro la pagina', async () => {
  const { righe, dimensioni } = await estratto();
  assert.ok(righe.length > 0);
  for (const r of righe) {
    const dim = dimensioni[r.pagina - 1];
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Number.isFinite(r[k]), `${k} non finito in "${r.testo}"`);
    }
    assert.ok(r.w > 0, `w non positiva in "${r.testo}"`);
    assert.ok(r.h > 0, `h non positiva in "${r.testo}"`);
    assert.ok(r.x >= -1 && r.x + r.w <= dim.width + 1,
      `box fuori pagina in x: "${r.testo}" x=${r.x} w=${r.w}`);
    assert.ok(r.y >= -1 && r.y + r.h <= dim.height + 1,
      `box fuori pagina in y: "${r.testo}" y=${r.y} h=${r.h}`);
  }
});

test('y e top-down: titolo sopra il piede di pagina', async () => {
  const { righe } = await estratto();
  const p1 = righe.filter(r => r.pagina === 1);
  const titolo = rigaCon(p1, 'Listino Esami di Laboratorio');
  const piede = rigaCon(p1, 'Pagina 1 di 2');
  assert.ok(titolo && piede);
  assert.ok(titolo.y < piede.y,
    `y non top-down: titolo=${titolo.y} piede=${piede.y}`);
});

// Limite noto, documentato per non riscoprirlo: pdfjs rende il letter-spacing
// come spazi dentro la stringa, quindi un titolo distanziato torna sillabato.
// Non e correggibile a questo stadio e non danneggia l'import: i titoli sono
// rumore che lo stadio 2 scarta comunque.
test('titolo con letter-spacing: testo sillabato ma box integro', async () => {
  const { righe, dimensioni } = await estratto();
  const marchio = righe.find(r => /^M ?Y ?L/.test(r.testo) && r.pagina === 1);
  assert.ok(marchio, 'riga del marchio non trovata');
  assert.ok(marchio.w > 100, 'il box del marchio deve coprire tutto il titolo');
  assert.ok(marchio.y < dimensioni[0].height / 2, 'il marchio sta in cima');
});

test('unisce i frammenti di una parola spezzata senza spazio spurio', async () => {
  const { righe } = await estraiRigheGrezze(frammentate());
  assert.ok(rigaCon(righe, 'EMOCROMO COMPLETO'),
    `parola spezzata non ricomposta: ${JSON.stringify(righe.map(r => r.testo))}`);
});

test('un buco orizzontale moderato diventa un solo spazio', async () => {
  const { righe } = await estraiRigheGrezze(frammentate());
  const r = rigaCon(righe, 'ESAME');
  assert.ok(r);
  assert.strictEqual(r.testo, 'ESAME CODICE');
});

test('le righe sono ordinate per pagina e poi dall alto in basso', async () => {
  const { righe } = await estratto();
  for (let i = 1; i < righe.length; i++) {
    const prec = righe[i - 1], cur = righe[i];
    assert.ok(cur.pagina >= prec.pagina, 'pagine non ordinate');
    if (cur.pagina === prec.pagina) {
      assert.ok(cur.y >= prec.y - 0.5,
        `righe non ordinate in y: ${prec.y} -> ${cur.y}`);
    }
  }
});

test('lo stadio 1 non interpreta: conserva anche il rumore', async () => {
  const { righe } = await estratto();
  assert.ok(rigaCon(righe, 'Pagina 1 di 2'), 'numero di pagina scartato');
  assert.ok(rigaCon(righe, 'non comprendono IVA'), 'nota legale scartata');
  assert.ok(rigaCon(righe, 'Esame'), 'intestazione tabella scartata');
});

test('estrae anche le righe della seconda pagina', async () => {
  const { righe } = await estratto();
  const r = rigaCon(righe, 'LEISHMANIA IFI');
  assert.ok(r, 'riga di pagina 2 non trovata');
  assert.strictEqual(r.pagina, 2);
  assert.ok(r.testo.includes('31,50'));
});

test('PDF di sola immagine: errore PDF_SENZA_TESTO', async () => {
  await assert.rejects(
    () => estraiRigheGrezze(scansionato()),
    err => {
      assert.strictEqual(err.codice, 'PDF_SENZA_TESTO');
      assert.match(err.message, /scansionat|senza testo/i);
      return true;
    }
  );
});

test('buffer non PDF: errore PDF_NON_VALIDO', async () => {
  await assert.rejects(
    () => estraiRigheGrezze(Buffer.from('questo non e un pdf')),
    err => {
      assert.strictEqual(err.codice, 'PDF_NON_VALIDO');
      return true;
    }
  );
});
