'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const clip = require('./clip');
const concorrenti = require('./concorrenti');

function dbProva() {
  // node:sqlite applica le chiavi esterne di default. I test qui sotto usano
  // id di laboratorio arbitrari (10, 20...) per provare l'unicita' per
  // laboratorio, senza bisogno di un vero concorrente in anagrafica: quella
  // relazione la testa lib/concorrenti.test.js.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  // clip.ensureSchema dichiara una chiave esterna verso concorrenti: quella
  // tabella deve esistere prima, come in server.js.
  concorrenti.ensureSchema(db);
  clip.ensureSchema(db);
  return db;
}

// I nomi veri vengono dai PDF dei fornitori e finiscono col codice prodotto
// seguito dal numero di pezzi della confezione. E' il numero su cui poggia
// tutto il calcolo: il prezzo del listino e' per confezione, non per clip.
test('leggiPezzi prende il numero in coda al nome', () => {
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 17 CLIP 98-11003-02 12'), 12);
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 15 CLIP 98-11004-01 12'), 12);
  assert.equal(clip.leggiPezzi('Catalyst™ CORT Cortisolo 99-0020377 6'), 6);
  assert.equal(clip.leggiPezzi('Catalyst™ Lyte 4 CLIP 98-11009-02 12'), 12);
});

test('leggiPezzi torna null quando il numero non c e', () => {
  assert.equal(clip.leggiPezzi('Catalyst™ Chem 17 CLIP'), null);
  assert.equal(clip.leggiPezzi(''), null);
  assert.equal(clip.leggiPezzi(null), null);
});

// Un numero enorme in coda e' un codice, non una confezione: nessuno vende
// clip in scatole da mille.
test('leggiPezzi ignora i numeri troppo grandi per essere una confezione', () => {
  assert.equal(clip.leggiPezzi('Qualcosa 99-0010257 1000'), null);
  assert.equal(clip.leggiPezzi('Qualcosa 12345'), null);
});

test('leggiPezzi ignora lo zero', () => {
  assert.equal(clip.leggiPezzi('Qualcosa 98-11003-02 0'), null);
});

// I codici prodotto finiscono con un trattino e due cifre: quella coda non e'
// una confezione. Il numero dei pezzi e' staccato da uno spazio.
test('leggiPezzi non scambia la coda di un codice per una confezione', () => {
  assert.equal(clip.leggiPezzi('Qualcosa -3'), null);
  assert.equal(clip.leggiPezzi('Codice 98-11003-02'), null);
});

// Il riconoscimento serve a proporre, non a decidere: l'operatore conferma
// sempre. Deve pero' essere abbastanza stretto da non riempire il catalogo di
// esami qualunque, perche' 127 voci su 517 del listino reale hanno un numero
// in coda al nome.
test('sembraClip riconosce le voci dei listini reali', () => {
  assert.equal(clip.sembraClip('Catalyst™ Chem 17 CLIP 98-11003-02 12'), true);
  assert.equal(clip.sembraClip('Catalyst™ Chem 18 Profile 99-0010257 12'), true);
  assert.equal(clip.sembraClip('Catalyst™ Lyte 4 CLIP 98-11009-02 12'), true);
  assert.equal(clip.sembraClip('Menù in costante evoluzione: Catalyst™ Chem 10 CLIP 98-11005-01 12'), true);
});

test('sembraClip non scambia un esame per una clip', () => {
  assert.equal(clip.sembraClip('Profilo zecche 5(cane) Test immunologico 2 ml siero 1 –'), false);
  assert.equal(clip.sembraClip('EMOCROMO COMPLETO'), false);
  assert.equal(clip.sembraClip('Leishmania IFI 2'), false);
  assert.equal(clip.sembraClip(''), false);
});

test('upsertClip salva e rilegge', () => {
  const db = dbProva();
  const { id } = clip.upsertClip(db, {
    userId: 1, nome: 'Catalyst™ Chem 17 CLIP 98-11003-02 12',
    prezzoConfezione: 448.5, pezzi: 12, sconto: null, fonte: 'concorrente'
  });
  assert.ok(id > 0);
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzoConfezione, 448.5);
  assert.equal(righe[0].pezzi, 12);
  db.close();
});

// Reimportare lo stesso listino non deve creare doppioni: aggiorna il prezzo.
test('upsertClip sullo stesso nome aggiorna invece di duplicare', () => {
  const db = dbProva();
  const dati = { userId: 1, nome: 'Chem 17 CLIP 12', pezzi: 12, sconto: null, fonte: 'pdf' };
  clip.upsertClip(db, { ...dati, prezzoConfezione: 448.5 });
  clip.upsertClip(db, { ...dati, prezzoConfezione: 460 });
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'una sola riga');
  assert.equal(righe[0].prezzoConfezione, 460, 'col prezzo aggiornato');
  db.close();
});

// Ogni account vede solo le sue clip: e' lo stesso isolamento del resto del
// progetto, dove un difetto di questo tipo aveva gia' fatto vedere a un account
// i dati di un altro.
test('le clip sono isolate per account', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, nome: 'Clip di uno 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, nome: 'Clip di due 12', prezzoConfezione: 200, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1).length, 1);
  assert.equal(clip.listaClip(db, 1)[0].nome, 'Clip di uno 12');
  assert.equal(clip.listaClip(db, 2).length, 1);
  db.close();
});

test('due account possono avere una clip con lo stesso nome', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzoConfezione: 448.5, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, nome: 'Chem 17 CLIP 12', prezzoConfezione: 500, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1)[0].prezzoConfezione, 448.5);
  assert.equal(clip.listaClip(db, 2)[0].prezzoConfezione, 500);
  db.close();
});

test('eliminaClip tocca solo le clip del proprio account', () => {
  const db = dbProva();
  const a = clip.upsertClip(db, { userId: 1, nome: 'Mia 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.eliminaClip(db, a.id, 2);
  assert.equal(clip.listaClip(db, 1).length, 1, 'un altro account non puo cancellarla');
  clip.eliminaClip(db, a.id, 1);
  assert.equal(clip.listaClip(db, 1).length, 0);
  db.close();
});

// Il limite serve a non scambiare un codice per una confezione: nessuno vende
// clip in scatole da duecento, e sopra quella soglia il numero e' altro.
test('leggiPezzi rispetta il limite della confezione ai bordi', () => {
  assert.equal(clip.leggiPezzi('Catalyst CLIP 98-11003-02 200'), 200);
  assert.equal(clip.leggiPezzi('Catalyst CLIP 98-11003-02 201'), null);
  assert.equal(clip.leggiPezzi('Catalyst CLIP 98-11003-02 1'), 1);
});

// I codici prodotto finiscono con un trattino e una o due cifre. Il test
// esistente copriva solo il caso a una cifra: due cifre e' la forma reale.
test('leggiPezzi non scambia una coda di codice a due cifre per pezzi', () => {
  assert.equal(clip.leggiPezzi('Catalyst Chem 17 CLIP 98-11003-02'), null);
  assert.equal(clip.leggiPezzi('Qualcosa -12'), null);
  assert.equal(clip.sembraClip('Catalyst Chem 17 CLIP 98-11003-02'), false,
    'senza pezzi non e una clip riconoscibile, per quanto il nome lo dica');
});

// Il separatore puo' essere uno spazio qualunque: i nomi vengono da PDF.
test('leggiPezzi accetta gli spazi che arrivano dai PDF', () => {
  assert.equal(clip.leggiPezzi('Catalyst CLIP 98-11003-02\t12'), 12);
  assert.equal(clip.leggiPezzi('Catalyst CLIP 98-11003-02 12   '), 12);
});

// Due laboratori possono vendere una clip con lo stesso nome: e' il caso
// normale, non l'eccezione. Il vincolo di unicita' vecchio lo impediva, e la
// seconda avrebbe sovrascritto la prima in silenzio.
test('due laboratori possono avere una clip con lo stesso nome', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12', prezzoConfezione: 448.5, pezzi: 12, fonte: 'concorrente' });
  clip.upsertClip(db, { userId: 1, concorrenteId: 20, nome: 'Chem 17 CLIP 12', prezzoConfezione: 500, pezzi: 12, fonte: 'concorrente' });
  const tutte = clip.listaClip(db, 1);
  assert.equal(tutte.length, 2, 'restano due righe distinte');
  assert.equal(clip.listaClip(db, 1, 10)[0].prezzoConfezione, 448.5);
  assert.equal(clip.listaClip(db, 1, 20)[0].prezzoConfezione, 500);
  db.close();
});

// Reimportare lo stesso listino dello stesso laboratorio aggiorna, non duplica.
test('upsertClip sullo stesso laboratorio e nome aggiorna', () => {
  const db = dbProva();
  const d = { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12', pezzi: 12, fonte: 'concorrente' };
  clip.upsertClip(db, { ...d, prezzoConfezione: 448.5 });
  clip.upsertClip(db, { ...d, prezzoConfezione: 460 });
  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzoConfezione, 460);
  db.close();
});

// Le clip salvate prima di questa modifica non hanno un laboratorio: restano
// dove sono, visibili, e si assegnano a mano. Attribuirle d'ufficio a un
// laboratorio che l'operatore non ha scelto sarebbe inventare un dato.
test('una clip senza laboratorio resta leggibile e non si perde', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Vecchia CLIP 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  const tutte = clip.listaClip(db, 1);
  assert.equal(tutte.length, 1);
  assert.equal(tutte[0].concorrenteId, null);
  assert.equal(clip.listaClip(db, 1, 10).length, 0, 'non compare sotto un laboratorio a caso');
  db.close();
});

// Con concorrente_id NULL, SQLite considera distinte due righe uguali: senza
// una difesa esplicita lo stesso nome potrebbe entrare due volte.
test('senza laboratorio, lo stesso nome non entra due volte', () => {
  const db = dbProva();
  const d = { userId: 1, concorrenteId: null, nome: 'Senza lab 12', pezzi: 12, fonte: 'pdf' };
  clip.upsertClip(db, { ...d, prezzoConfezione: 100 });
  clip.upsertClip(db, { ...d, prezzoConfezione: 120 });
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'una sola riga');
  assert.equal(righe[0].prezzoConfezione, 120);
  db.close();
});

test('le clip restano isolate per account anche con lo stesso laboratorio', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'X 12', prezzoConfezione: 100, pezzi: 12, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 2, concorrenteId: 10, nome: 'X 12', prezzoConfezione: 200, pezzi: 12, fonte: 'pdf' });
  assert.equal(clip.listaClip(db, 1).length, 1);
  assert.equal(clip.listaClip(db, 1)[0].prezzoConfezione, 100);
  db.close();
});

// La migrazione gira su database veri: deve conservare le righe e gli id, e
// deve poter girare due volte senza fare danni.
test('la migrazione conserva le clip gia salvate e i loro id', () => {
  const db = new DatabaseSync(':memory:');
  // schema vecchio: nessun concorrente_id, unicita' su (user_id, nome)
  db.exec(`
    CREATE TABLE clip (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, nome TEXT NOT NULL,
      prezzo_confezione REAL, pezzi INTEGER, sconto REAL, fonte TEXT,
      data_import DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, nome));
  `);
  db.prepare(`INSERT INTO clip (id, user_id, nome, prezzo_confezione, pezzi, fonte)
              VALUES (7, 1, 'Chem 17 CLIP 12', 448.5, 12, 'concorrente')`).run();

  clip.ensureSchema(db);
  clip.ensureSchema(db);   // due volte: deve essere idempotente

  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 1, 'la riga non si perde');
  assert.equal(righe[0].id, 7, 'e mantiene il suo id');
  assert.equal(righe[0].prezzoConfezione, 448.5);
  assert.equal(righe[0].concorrenteId, null, 'senza laboratorio, da assegnare');
  const cols = db.prepare(`PRAGMA table_info(clip)`).all().map(c => c.name);
  assert.ok(cols.includes('concorrente_id'));
  db.close();
});
