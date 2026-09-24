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

test('upsertClip salva il file di provenienza e lo rilegge', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.50, pezzi: 12, sconto: null, fonte: 'pdf',
    fileOrigine: 'listino-A.pdf' });
  assert.equal(clip.listaClip(db, 1)[0].fileOrigine, 'listino-A.pdf');
  db.close();
});

// Le righe entrate prima che si tenesse traccia del file non spariscono e non
// vengono attribuite a nessun PDF: restano in un gruppo loro.
test('gruppiClip raccoglie le righe senza provenienza sotto null', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Vecchia',
    prezzoConfezione: 10, pezzi: 1, sconto: null, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Nuova',
    prezzoConfezione: 20, pezzi: 2, sconto: null, fonte: 'pdf',
    fileOrigine: 'listino-A.pdf' });
  const g = clip.gruppiClip(db, 1);
  assert.equal(g.length, 2);
  const senza = g.find(x => x.fileOrigine == null);
  assert.ok(senza, 'il gruppo senza provenienza esiste');
  assert.equal(senza.n, 1);
  assert.equal(g.find(x => x.fileOrigine === 'listino-A.pdf').n, 1);
  db.close();
});

test('i gruppi sono isolati per account', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'x.pdf' });
  clip.upsertClip(db, { userId: 2, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'y.pdf' });
  assert.equal(clip.gruppiClip(db, 1).length, 1);
  assert.equal(clip.gruppiClip(db, 1)[0].fileOrigine, 'x.pdf');
  db.close();
});

// Un reimport dello STESSO file non deve azzerare i pezzi e lo sconto
// completati a mano (stesso difetto scoperto per canone/note in
// analizzatori). Da task 5 in poi un file diverso (un altro listino) affianca
// la riga invece di sovrascriverla, quindi il completamento a mano qui usa lo
// stesso file_origine della riga che sta completando (come farebbe
// PUT /api/clip/:id, che scrive per id, non per nome+file).
test('reimportare non cancella i pezzi e lo sconto completati a mano', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.5, fileOrigine: 'listino-A.pdf' });
  // Completamento a mano sulla stessa riga (stesso file_origine).
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.5, fileOrigine: 'listino-A.pdf', pezzi: 12, sconto: 5 });
  // Il PDF nuovo e' un listino diverso (2027): affianca il primo, non lo
  // sovrascrive.
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 460, fileOrigine: 'listino-A-2027.pdf' });
  const righe = clip.listaClip(db, 1);
  assert.equal(righe.length, 2, 'i due listini restano due righe distinte');
  const vecchia = righe.find(r => r.fileOrigine === 'listino-A.pdf');
  assert.equal(vecchia.prezzoConfezione, 448.5);
  assert.equal(vecchia.pezzi, 12, 'i pezzi completati a mano restano sulla riga vecchia');
  assert.equal(vecchia.sconto, 5, 'lo sconto completato a mano resta sulla riga vecchia');
  assert.equal(righe.find(r => r.fileOrigine === 'listino-A-2027.pdf').prezzoConfezione, 460,
    'il listino nuovo porta il suo prezzo');
  db.close();
});

// eliminaGruppoClip: l'unica via per ripulire un listino sbagliato senza
// eliminare riga per riga, con conferma che dice quante righe se ne vanno.
test('eliminaGruppoClip toglie solo le righe di quel PDF', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'due.pdf' });
  const r = clip.eliminaGruppoClip(db, 'uno.pdf', 1);
  assert.equal(r.eliminate, 1);
  assert.deepEqual(clip.listaClip(db, 1).map(c => c.nome), ['B']);
  db.close();
});

// Il gruppo senza provenienza si elimina come gli altri: e' l'unica via per
// ripulire cio' che e' entrato prima che si tenesse traccia del file.
test('eliminaGruppoClip sa eliminare il gruppo senza provenienza', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf' });
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'B', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'due.pdf' });
  assert.equal(clip.eliminaGruppoClip(db, null, 1).eliminate, 1);
  assert.deepEqual(clip.listaClip(db, 1).map(c => c.nome), ['B']);
  db.close();
});

test('eliminaGruppoClip non tocca gli altri account', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  clip.upsertClip(db, { userId: 2, concorrenteId: null, nome: 'A', prezzoConfezione: 1,
    pezzi: 1, sconto: null, fonte: 'pdf', fileOrigine: 'uno.pdf' });
  assert.equal(clip.eliminaGruppoClip(db, 'uno.pdf', 1).eliminate, 1);
  assert.equal(clip.listaClip(db, 2).length, 1, 'l\'altro account non si tocca');
  db.close();
});

// ── L'unicita' passa da (user_id, concorrente_id, nome) a
// (user_id, concorrente_id, nome, file_origine) ── Due PDF dello stesso
// laboratorio con una clip omonima (task 5): il secondo non deve piu'
// sovrascrivere il primo.
test('la stessa clip puo stare in due listini diversi dello stesso laboratorio', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.50, pezzi: 12, fonte: 'concorrente', fileOrigine: 'idexx-2026.pdf' });
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 500, pezzi: 12, fonte: 'concorrente', fileOrigine: 'idexx-2027.pdf' });
  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 2, 'le due righe convivono');
  assert.equal(righe.find(r => r.fileOrigine === 'idexx-2026.pdf').prezzoConfezione, 448.50,
    'il listino vecchio conserva il suo prezzo');
  assert.equal(righe.find(r => r.fileOrigine === 'idexx-2027.pdf').prezzoConfezione, 500);
  db.close();
});

test('reimportare lo STESSO listino di clip aggiorna invece di duplicare', () => {
  const db = dbProva();
  const d = { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12', pezzi: 12,
    fonte: 'concorrente', fileOrigine: 'idexx-2026.pdf' };
  clip.upsertClip(db, { ...d, prezzoConfezione: 448.50 });
  clip.upsertClip(db, { ...d, prezzoConfezione: 460 });
  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzoConfezione, 460);
  db.close();
});

// Le clip di un laboratorio importate prima che si tenesse traccia del file
// hanno file_origine nullo, e in SQLite due NULL sono DISTINTI dentro un
// UNIQUE: senza indice parziale nascerebbero doppioni proprio li'.
test('senza provenienza, lo stesso nome nello stesso laboratorio resta una riga sola', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.50, pezzi: 12, fonte: 'concorrente' });
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 460, pezzi: 12, fonte: 'concorrente' });
  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 1, 'niente doppioni nel gruppo senza provenienza');
  assert.equal(righe[0].prezzoConfezione, 460);
  db.close();
});

// Due laboratori diversi non devono pestarsi i piedi nemmeno quando pescano
// dallo stesso file (stesso PDF di listino, due laboratori diversi): l'asse
// del laboratorio resta indipendente da quello del file.
test('due laboratori diversi continuano a non pestarsi i piedi anche con lo stesso file di provenienza', () => {
  const db = dbProva();
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 448.50, pezzi: 12, fonte: 'concorrente', fileOrigine: 'listino-comune.pdf' });
  clip.upsertClip(db, { userId: 1, concorrenteId: 20, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 500, pezzi: 12, fonte: 'concorrente', fileOrigine: 'listino-comune.pdf' });
  assert.equal(clip.listaClip(db, 1, 10)[0].prezzoConfezione, 448.50);
  assert.equal(clip.listaClip(db, 1, 20)[0].prezzoConfezione, 500);
  db.close();
});

// La migrazione gira su un database che ha gia' concorrente_id (task 2) ma
// ancora l'unicita' vecchia (due indici parziali senza file_origine nella
// chiave): deve conservare righe e id, e aggiungere l'asse del file senza
// toccare la tabella.
test('la migrazione della clip per il file di provenienza non perde righe ne cambia gli id', () => {
  const db = new DatabaseSync(':memory:');
  concorrenti.ensureSchema(db);
  // Il laboratorio deve esistere davvero: concorrente_id ha una chiave
  // esterna verso concorrenti, e node:sqlite la applica di default.
  db.prepare(`INSERT INTO concorrenti (id, nome) VALUES (10, 'Idexx')`).run();
  db.exec(`
    CREATE TABLE clip (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      concorrente_id    INTEGER REFERENCES concorrenti(id),
      nome              TEXT NOT NULL,
      prezzo_confezione REAL,
      pezzi             INTEGER,
      sconto            REAL,
      fonte             TEXT,
      data_import       DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_origine      TEXT
    );
    CREATE UNIQUE INDEX clip_per_laboratorio
      ON clip(user_id, concorrente_id, nome) WHERE concorrente_id IS NOT NULL;
    CREATE UNIQUE INDEX clip_senza_laboratorio
      ON clip(user_id, nome) WHERE concorrente_id IS NULL;
  `);
  const r = db.prepare(`
    INSERT INTO clip (user_id, concorrente_id, nome, prezzo_confezione)
    VALUES (1, 10, 'Chem 17 CLIP 12', 448.50)
  `).run();

  clip.ensureSchema(db);
  clip.ensureSchema(db); // due volte: deve essere idempotente

  const righe = clip.listaClip(db, 1, 10);
  assert.equal(righe.length, 1, 'la riga non si perde');
  assert.equal(righe[0].id, Number(r.lastInsertRowid), 'gli id non cambiano');
  assert.equal(righe[0].prezzoConfezione, 448.50);

  // E ora la voce omonima di un altro listino dello stesso laboratorio ci sta.
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17 CLIP 12',
    prezzoConfezione: 500, fileOrigine: 'altro.pdf' });
  assert.equal(clip.listaClip(db, 1, 10).length, 2);
  db.close();
});

// ── Le clip scritte a mano in un calcolo entrano nel listino al salvataggio ──

function seminaListino(db) {
  clip.upsertClip(db, { userId: 1, concorrenteId: 10, nome: 'Chem 17',
    prezzoConfezione: 448.50, pezzi: 12, sconto: null, fonte: 'pdf',
    fileOrigine: 'idexx-2026.pdf' });
}

test('aggiungiClipMancanti aggiunge solo cio che il listino non ha', () => {
  const db = dbProva();
  seminaListino(db);
  const r = clip.aggiungiClipMancanti(db, {
    userId: 1, fileOrigine: 'idexx-2026.pdf',
    righe: [
      { nome: 'Chem 17', prezzoConfezione: 999, pezzi: 1 },
      { nome: 'Lyte 4', prezzoConfezione: 200, pezzi: 10 }
    ]
  });
  assert.equal(r.aggiunte, 1, 'solo la clip che mancava');
  const elenco = clip.listaClip(db, 1);
  assert.equal(elenco.length, 2);
  const vecchia = elenco.find(c => c.nome === 'Chem 17');
  assert.equal(vecchia.prezzoConfezione, 448.50,
    'il listino importato resta la fonte: il prezzo del calcolo non lo riscrive');
  const nuova = elenco.find(c => c.nome === 'Lyte 4');
  assert.equal(nuova.prezzoConfezione, 200);
  assert.equal(nuova.pezzi, 10);
  assert.equal(nuova.fileOrigine, 'idexx-2026.pdf');
  assert.equal(nuova.concorrenteId, 10, 'eredita il laboratorio del listino');
  db.close();
});

// Senza un listino scritto non c'e' nessun posto dove mettere la clip, e
// inventarne uno sarebbe peggio del non fare niente.
test('aggiungiClipMancanti non fa niente senza listino', () => {
  const db = dbProva();
  seminaListino(db);
  for (const f of [null, '', '   ']) {
    assert.equal(clip.aggiungiClipMancanti(db, {
      userId: 1, fileOrigine: f, righe: [{ nome: 'Nuova', prezzoConfezione: 10, pezzi: 1 }]
    }).aggiunte, 0);
  }
  assert.equal(clip.listaClip(db, 1).length, 1);
  db.close();
});

// Un listino che non esiste (un nome scritto male) non si crea dal nulla: si
// ignora. Creare un listino per un errore di battitura lo renderebbe poi
// indistinguibile da uno vero nella tendina.
test('aggiungiClipMancanti ignora un listino che non esiste', () => {
  const db = dbProva();
  seminaListino(db);
  assert.equal(clip.aggiungiClipMancanti(db, {
    userId: 1, fileOrigine: 'idexx-2027.pdf',
    righe: [{ nome: 'Nuova', prezzoConfezione: 10, pezzi: 1 }]
  }).aggiunte, 0);
  assert.equal(clip.listaClip(db, 1).length, 1);
  db.close();
});

test('aggiungiClipMancanti salta le righe senza nome o senza prezzo', () => {
  const db = dbProva();
  seminaListino(db);
  const r = clip.aggiungiClipMancanti(db, {
    userId: 1, fileOrigine: 'idexx-2026.pdf',
    righe: [
      { nome: '', prezzoConfezione: 10, pezzi: 1 },
      { nome: 'Senza prezzo', prezzoConfezione: '', pezzi: 1 },
      { nome: 'Buona', prezzoConfezione: 10, pezzi: 1 }
    ]
  });
  assert.equal(r.aggiunte, 1);
  assert.deepEqual(clip.listaClip(db, 1).map(c => c.nome).sort(), ['Buona', 'Chem 17']);
  db.close();
});

test('aggiungiClipMancanti non tocca gli altri account', () => {
  const db = dbProva();
  seminaListino(db);
  assert.equal(clip.aggiungiClipMancanti(db, {
    userId: 2, fileOrigine: 'idexx-2026.pdf',
    righe: [{ nome: 'Nuova', prezzoConfezione: 10, pezzi: 1 }]
  }).aggiunte, 0, 'il listino e di un altro account: qui non esiste');
  assert.equal(clip.listaClip(db, 1).length, 1);
  assert.equal(clip.listaClip(db, 2).length, 0);
  db.close();
});

// ══════════════════════════════════════════════════
// importaListinoExcel — import Excel di un listino macchinari (mirror di
// upsertConcorrente per il catalogo clip, vedi lib/concorrenti.js)
// ══════════════════════════════════════════════════

test('importaListinoExcel trova o crea il laboratorio e scrive le clip valide', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'IDEXX 2026', fileOrigine: 'listino.xlsx',
    righe: [
      { nome: 'Chem 17', prezzoConfezione: 448.50, pezzi: 12 },
      { nome: 'Lyte 4', prezzoConfezione: 200, pezzi: null }
    ]
  });
  assert.equal(r.importate, 2);
  assert.equal(r.scartate, 0);

  const lab = concorrenti.listaConcorrenti(db, 1).find(c => c.nome === 'IDEXX 2026');
  assert.ok(lab, 'il laboratorio e stato creato');
  assert.equal(r.concorrenteId, lab.id);

  const elenco = clip.listaClip(db, 1, lab.id).sort((a, b) => a.nome.localeCompare(b.nome));
  assert.equal(elenco.length, 2);
  assert.equal(elenco[0].nome, 'Chem 17');
  assert.equal(elenco[0].prezzoConfezione, 448.50);
  assert.equal(elenco[0].pezzi, 12);
  assert.equal(elenco[0].fileOrigine, 'listino.xlsx');
  assert.equal(elenco[0].fonte, 'excel');
  db.close();
});

// Decisione esplicita del task: i pezzi si salvano come letti dal file. Una
// riga senza pezzi deve restare NULL nel catalogo, mai diventare 1 (quell'uno
// e' un'assunzione del calcolatore, non un fatto del catalogo).
test('importaListinoExcel: pezzi assente resta NULL, mai forzato a 1', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'Lab', fileOrigine: null,
    righe: [{ nome: 'Senza pezzi', prezzoConfezione: 10, pezzi: null }]
  });
  assert.equal(r.importate, 1);
  const [riga] = clip.listaClip(db, 1, r.concorrenteId);
  assert.equal(riga.pezzi, null);
  db.close();
});

// Decisione esplicita del task: un prezzo di confezione senza pezzi resta
// comunque una clip valida, non va scartata.
test('importaListinoExcel non scarta una riga con prezzo ma senza pezzi', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'Lab', fileOrigine: null,
    righe: [{ nome: 'Solo prezzo', prezzoConfezione: 55, pezzi: null }]
  });
  assert.equal(r.importate, 1);
  assert.equal(r.scartate, 0);
  db.close();
});

test('importaListinoExcel scarta le righe senza nome o senza un prezzo valido', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'Lab', fileOrigine: null,
    righe: [
      { nome: '', prezzoConfezione: 10, pezzi: 1 },
      { nome: 'Senza prezzo', prezzoConfezione: null, pezzi: 1 },
      { nome: 'Prezzo negativo', prezzoConfezione: -5, pezzi: 1 },
      { nome: 'Buona', prezzoConfezione: 10, pezzi: 1 }
    ]
  });
  assert.equal(r.importate, 1);
  assert.equal(r.scartate, 3);
  const elenco = clip.listaClip(db, 1, r.concorrenteId);
  assert.deepEqual(elenco.map(c => c.nome), ['Buona']);
  db.close();
});

// Un prezzo a zero e' un prezzo valido (listino promozionale, omaggio...): non
// va confuso con un prezzo mancante.
test('importaListinoExcel accetta un prezzo zero', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'Lab', fileOrigine: null,
    righe: [{ nome: 'Gratis', prezzoConfezione: 0, pezzi: 1 }]
  });
  assert.equal(r.importate, 1);
  assert.equal(r.scartate, 0);
  db.close();
});

test('importaListinoExcel lancia un errore tradotto se manca il nome del laboratorio', () => {
  const db = dbProva();
  assert.throws(
    () => clip.importaListinoExcel(db, { userId: 1, nomeLaboratorio: '  ', righe: [] }),
    err => err.codice === 'NOME_LABORATORIO_MANCANTE'
  );
  db.close();
});

// Tutto o niente: un errore a meta' listino non deve lasciare scritte solo le
// righe viste prima del guasto. Si simula il guasto facendo fallire il
// SECONDO INSERT/UPDATE su clip (il primo va a buon fine): se la transazione
// funziona, il ROLLBACK toglie anche la prima riga gia' scritta.
test('importaListinoExcel scrive tutto o niente: un errore a meta lista fa rollback', () => {
  const db = dbProva();
  const prepareOriginale = db.prepare.bind(db);
  let scritture = 0;
  db.prepare = (sql) => {
    if (/INSERT INTO clip/.test(sql)) {
      scritture++;
      if (scritture === 2) throw new Error('guasto simulato');
    }
    return prepareOriginale(sql);
  };
  try {
    assert.throws(() => clip.importaListinoExcel(db, {
      userId: 1, nomeLaboratorio: 'Lab Rollback', fileOrigine: 'f.xlsx',
      righe: [
        { nome: 'Prima', prezzoConfezione: 1, pezzi: null },
        { nome: 'Seconda', prezzoConfezione: 2, pezzi: null }
      ]
    }), /guasto simulato/);
  } finally {
    db.prepare = prepareOriginale;
  }
  assert.equal(clip.listaClip(db, 1).length, 0, 'il rollback toglie anche la prima riga gia scritta');
  db.close();
});

// ── Correzioni della revisione dell'import Excel ─────────────────────────

// Un file dalle colonne sbagliate scarta tutte le righe. Prima il laboratorio
// veniva creato comunque, fuori dalla transazione, e restava vuoto: poi
// compariva fra i concorrenti degli esami senza nessun esame.
test('importaListinoExcel senza righe valide non crea il laboratorio', () => {
  const db = dbProva();
  assert.throws(
    () => clip.importaListinoExcel(db, {
      userId: 1, nomeLaboratorio: 'Laboratorio Vuoto', fileOrigine: 'sbagliato.xlsx',
      righe: [{ nome: '', prezzoConfezione: 10 }, { nome: 'Senza prezzo', prezzoConfezione: null }]
    }),
    err => err.codice === 'NESSUNA_RIGA_IMPORTABILE'
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM concorrenti WHERE nome = 'Laboratorio Vuoto'`).get().c, 0,
    'nessun laboratorio fantasma');
  assert.equal(clip.listaClip(db, 1).length, 0);
  db.close();
});

// Lo stesso nome due volte nello stesso file finirebbe sulla stessa riga del
// catalogo: si tiene la prima e si conta il doppione, cosi' il numero di clip
// dichiarato e' quello vero.
test('importaListinoExcel conta i doppioni invece di sovrascrivere in silenzio', () => {
  const db = dbProva();
  const r = clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'IVET', fileOrigine: 'ivet.xlsx',
    righe: [
      { nome: 'cPL Lipasi', prezzoConfezione: 140, pezzi: 10 },
      { nome: 'cPL Lipasi', prezzoConfezione: 999, pezzi: 1 },
      { nome: 'cTSH', prezzoConfezione: 160, pezzi: 10 }
    ]
  });
  assert.equal(r.importate, 2);
  assert.equal(r.doppioni, 1);
  const cpl = clip.listaClip(db, 1).find(c => c.nome === 'cPL Lipasi');
  assert.equal(cpl.prezzoConfezione, 140, 'resta la prima occorrenza');
  db.close();
});

test('importaListinoExcel lascia vuoti i pezzi che non sono un intero positivo', () => {
  const db = dbProva();
  clip.importaListinoExcel(db, {
    userId: 1, nomeLaboratorio: 'IVET', fileOrigine: 'ivet.xlsx',
    righe: [
      { nome: 'Zero', prezzoConfezione: 10, pezzi: 0 },
      { nome: 'Negativo', prezzoConfezione: 10, pezzi: -2 },
      { nome: 'Decimale', prezzoConfezione: 10, pezzi: 2.5 },
      { nome: 'Buono', prezzoConfezione: 10, pezzi: 20 }
    ]
  });
  const per = Object.fromEntries(clip.listaClip(db, 1).map(c => [c.nome, c.pezzi]));
  assert.equal(per.Zero, null);
  assert.equal(per.Negativo, null);
  assert.equal(per.Decimale, null);
  assert.equal(per.Buono, 20);
  db.close();
});
