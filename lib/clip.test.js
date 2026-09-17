'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const clip = require('./clip');

function dbProva() {
  const db = new DatabaseSync(':memory:');
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
