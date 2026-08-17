'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const macchine = require('./macchine.js');
const concorrenti = require('./concorrenti.js');

function dbVuoto() {
  const db = new DatabaseSync(':memory:');
  concorrenti.ensureSchema(db);
  macchine.ensureSchema(db);
  return db;
}

const RIGHE = [
  { nome: 'Analizzatore biochimico', prezzo: 8500 },
  { nome: 'Ematologico veterinario', prezzo: 11200 }
];

test('ensureSchema crea la tabella ed e idempotente', () => {
  const db = dbVuoto();
  macchine.ensureSchema(db);
  const tabelle = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tabelle.includes('macchine'));
  db.close();
});

test('upsertMacchine salva le macchine proprie', () => {
  const db = dbVuoto();
  const r = macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  assert.equal(r.salvate, 2);
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].concorrenteId, null);
  db.close();
});

test('la lista e ordinata dal prezzo piu basso', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  const lista = macchine.listaMacchine(db, 1);
  assert.deepEqual(lista.map(m => m.prezzo), [8500, 11200]);
  db.close();
});

test('reimportare lo stesso nome aggiorna il prezzo invece di duplicare', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [{ nome: 'Analizzatore biochimico', prezzo: 7900 }] });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista.find(m => m.nome === 'Analizzatore biochimico').prezzo, 7900);
  db.close();
});

test('la stessa macchina puo esistere come propria e come di un concorrente', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [{ nome: 'Analizzatore biochimico', prezzo: 6900 }] });
  macchine.upsertMacchine(db, { userId: 1, concorrenteId, righe: [{ nome: 'Analizzatore biochimico', prezzo: 8500 }] });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(m => m.prezzo), [6900, 8500]);
  assert.equal(lista.find(m => m.prezzo === 8500).concorrenteNome, 'IDEXX');
  db.close();
});

test('upsertMacchine rifiuta un concorrenteId di un altro account e non scrive nulla', () => {
  // Protegge dalla fuga: un concorrenteId preso da un altro account non deve
  // poter essere agganciato alle proprie macchine, ne' far scrivere righe.
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX RISERVATO', [], 2);
  assert.throws(() => macchine.upsertMacchine(db, { userId: 1, concorrenteId, righe: RIGHE }), /non trovato/i);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('salvaMacchina rifiuta un concorrenteId di un altro account e non scrive nulla', () => {
  // Stessa protezione di upsertMacchine, ma sul percorso di inserimento e
  // modifica manuale di una singola macchina.
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX RISERVATO', [], 2);
  assert.throws(() => macchine.salvaMacchina(db, { userId: 1, concorrenteId, nome: 'Analizzatore', prezzo: 8500 }), /non trovato/i);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('upsertMacchine rifiuta un concorrenteId inesistente', () => {
  // Un id che non corrisponde a nessun concorrente (mai esistito o gia'
  // eliminato) deve essere trattato come non proprio, non ignorato in
  // silenzio.
  const db = dbVuoto();
  assert.throws(() => macchine.upsertMacchine(db, { userId: 1, concorrenteId: 999, righe: RIGHE }), /non trovato/i);
  db.close();
});

test('un concorrente del proprio account viene accettato e il nome compare in listaMacchine', () => {
  // Verifica che il controllo aggiunto non blocchi il caso legittimo: il
  // concorrente appartiene allo stesso account che lo sta usando.
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  macchine.upsertMacchine(db, { userId: 1, concorrenteId, righe: [{ nome: 'Analizzatore biochimico', prezzo: 8500 }] });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].concorrenteNome, 'IDEXX');
  db.close();
});

test('listaMacchine non espone mai il nome di un concorrente di un altro account', () => {
  // Difesa in profondita': anche se una riga in macchine avesse un
  // concorrente_id di un altro account (dato scritto prima che esistesse
  // questo controllo, o scritto in altro modo che bypassa upsertMacchine e
  // salvaMacchina), il JOIN vincolato allo stesso account non deve
  // comunque mai restituire il nome di quel concorrente.
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX RISERVATO', [], 2);
  // Inserimento diretto via SQL, bypassando i controlli applicativi di macchine.js.
  db.prepare(`INSERT INTO macchine (user_id, concorrente_id, nome, prezzo) VALUES (?, ?, ?, ?)`)
    .run(1, concorrenteId, 'Analizzatore infiltrato', 5000);
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 1);
  assert.notEqual(lista[0].concorrenteNome, 'IDEXX RISERVATO');
  assert.equal(lista[0].concorrenteNome, null);
  db.close();
});

test('le macchine di un account non sono visibili a un altro', () => {
  const db = dbVuoto();
  macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: RIGHE });
  assert.equal(macchine.listaMacchine(db, 2).length, 0);
  db.close();
});

test('salvaMacchina inserisce e aggiorna', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300, note: 'usato' });
  assert.ok(id);
  macchine.salvaMacchina(db, { id, userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4100, note: 'ricondizionato' });
  const lista = macchine.listaMacchine(db, 1);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].prezzo, 4100);
  assert.equal(lista[0].note, 'ricondizionato');
  db.close();
});

test('un altro account non puo modificare la macchina altrui', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300 });
  assert.throws(() => macchine.salvaMacchina(db, { id, userId: 2, concorrenteId: null, nome: 'Rubata', prezzo: 1 }), /non trovata/i);
  assert.equal(macchine.listaMacchine(db, 1)[0].nome, 'Analizzatore urine');
  db.close();
});

test('eliminaMacchina rimuove solo la propria', () => {
  const db = dbVuoto();
  const { id } = macchine.salvaMacchina(db, { userId: 1, concorrenteId: null, nome: 'Analizzatore urine', prezzo: 4300 });
  assert.equal(macchine.eliminaMacchina(db, id, 2), false, 'un altro account non deve poterla eliminare');
  assert.equal(macchine.listaMacchine(db, 1).length, 1);
  assert.equal(macchine.eliminaMacchina(db, id, 1), true);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('righe senza nome o con prezzo non valido sono ignorate', () => {
  const db = dbVuoto();
  const r = macchine.upsertMacchine(db, { userId: 1, concorrenteId: null, righe: [
    { nome: 'Buona', prezzo: 100 }, { nome: '', prezzo: 50 }, { nome: 'Senza prezzo', prezzo: null }
  ] });
  assert.equal(r.salvate, 1);
  db.close();
});
