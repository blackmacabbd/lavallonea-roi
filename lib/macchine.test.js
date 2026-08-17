'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const macchine = require('./macchine.js');
const concorrenti = require('./concorrenti.js');

function dbVuoto() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  concorrenti.ensureSchema(db);
  macchine.ensureSchema(db);
  return db;
}

const RIGHE = [
  { nome: 'Analizzatore biochimico', prezzo: 8500 },
  { nome: 'Ematologico veterinario', prezzo: 11200 }
];

// Listino proprio con due macchine, la situazione piu' comune.
function conListino(db, userId = 1, concorrenteId = null) {
  const { id } = macchine.creaListino(db, { userId, nome: 'listino-2026.pdf', concorrenteId });
  macchine.upsertMacchine(db, { listinoId: id, userId, righe: RIGHE });
  return id;
}

test('ensureSchema crea le due tabelle ed e idempotente', () => {
  const db = dbVuoto();
  macchine.ensureSchema(db);
  const tabelle = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tabelle.includes('listini_macchine'));
  assert.ok(tabelle.includes('macchine'));
  db.close();
});

test('creaListino e listaListini: nome, provenienza e conteggio', () => {
  const db = dbVuoto();
  conListino(db);
  const lista = macchine.listaListini(db, 1);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'listino-2026.pdf');
  assert.equal(lista[0].concorrenteId, null);
  assert.equal(lista[0].nMacchine, 2);
  assert.ok(lista[0].dataImport);
  db.close();
});

test('un listino di un concorrente riporta il nome del concorrente', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  conListino(db, 1, concorrenteId);
  const lista = macchine.listaListini(db, 1);
  assert.equal(lista[0].concorrenteId, concorrenteId);
  assert.equal(lista[0].concorrenteNome, 'IDEXX');
  db.close();
});

test('creaListino rifiuta il concorrente di un altro account', () => {
  const db = dbVuoto();
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX RISERVATO', [], 2);
  assert.throws(() => macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId }), /non trovato/i);
  assert.equal(macchine.listaListini(db, 1).length, 0);
  db.close();
});

test('i listini di un account non sono visibili a un altro', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.equal(macchine.listaListini(db, 2).length, 0);
  assert.equal(macchine.getListino(db, id, 2), null);
  assert.equal(macchine.macchineDiListino(db, id, 2).length, 0);
  db.close();
});

test('lo stesso nome macchina puo esistere in due listini diversi', () => {
  const db = dbVuoto();
  const mio = conListino(db, 1);
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  const suo = macchine.creaListino(db, { userId: 1, nome: 'idexx.pdf', concorrenteId }).id;
  macchine.upsertMacchine(db, { listinoId: suo, userId: 1, righe: [{ nome: 'Analizzatore biochimico', prezzo: 9900 }] });
  assert.equal(macchine.macchineDiListino(db, mio, 1).find(m => m.nome === 'Analizzatore biochimico').prezzo, 8500);
  assert.equal(macchine.macchineDiListino(db, suo, 1)[0].prezzo, 9900);
  db.close();
});

test('reimportare lo stesso nome nello stesso listino aggiorna il prezzo', () => {
  const db = dbVuoto();
  const id = conListino(db);
  macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [{ nome: 'Analizzatore biochimico', prezzo: 7900 }] });
  const lista = macchine.macchineDiListino(db, id, 1);
  assert.equal(lista.length, 2);
  assert.equal(lista.find(m => m.nome === 'Analizzatore biochimico').prezzo, 7900);
  db.close();
});

test('upsertMacchine rifiuta un listino di un altro account', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.throws(() => macchine.upsertMacchine(db, { listinoId: id, userId: 2, righe: RIGHE }), /non trovato/i);
  db.close();
});

test('prezzo in formato italiano interpretato correttamente', () => {
  const db = dbVuoto();
  const { id } = macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId: null });
  macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [{ nome: 'Pannello', prezzo: '1.234,56' }] });
  assert.equal(macchine.macchineDiListino(db, id, 1)[0].prezzo, 1234.56);
  db.close();
});

test('righe senza nome o con prezzo non valido sono ignorate', () => {
  const db = dbVuoto();
  const { id } = macchine.creaListino(db, { userId: 1, nome: 'x.pdf', concorrenteId: null });
  const r = macchine.upsertMacchine(db, { listinoId: id, userId: 1, righe: [
    { nome: 'Buona', prezzo: 100 }, { nome: '', prezzo: 50 }, { nome: 'Senza prezzo', prezzo: null }
  ] });
  assert.equal(r.salvate, 1);
  db.close();
});

test('listaMacchine restituisce tutte le macchine con listino e provenienza', () => {
  const db = dbVuoto();
  conListino(db, 1);
  const { concorrenteId } = concorrenti.upsertConcorrente(db, 'IDEXX', [], 1);
  const suo = macchine.creaListino(db, { userId: 1, nome: 'idexx.pdf', concorrenteId }).id;
  macchine.upsertMacchine(db, { listinoId: suo, userId: 1, righe: [{ nome: 'Suo analizzatore', prezzo: 9900 }] });
  const tutte = macchine.listaMacchine(db, 1);
  assert.equal(tutte.length, 3);
  const suoRecord = tutte.find(m => m.nome === 'Suo analizzatore');
  assert.equal(suoRecord.concorrenteNome, 'IDEXX');
  assert.equal(suoRecord.listinoNome, 'idexx.pdf');
  assert.equal(tutte.filter(m => !m.concorrenteId).length, 2);
  db.close();
});

test('listaMacchine non mostra le macchine di un altro account', () => {
  const db = dbVuoto();
  conListino(db, 1);
  assert.equal(macchine.listaMacchine(db, 2).length, 0);
  db.close();
});

test('eliminaListino porta via le sue macchine', () => {
  const db = dbVuoto();
  const id = conListino(db);
  assert.equal(macchine.eliminaListino(db, id, 1), true);
  assert.equal(macchine.listaListini(db, 1).length, 0);
  assert.equal(macchine.listaMacchine(db, 1).length, 0);
  db.close();
});

test('un altro account non puo eliminare il listino altrui', () => {
  const db = dbVuoto();
  const id = conListino(db, 1);
  assert.equal(macchine.eliminaListino(db, id, 2), false);
  assert.equal(macchine.listaListini(db, 1).length, 1);
  db.close();
});

test('salvaMacchina inserisce dentro il listino e aggiorna', () => {
  const db = dbVuoto();
  const listinoId = conListino(db);
  const { id } = macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Aggiunta a mano', prezzo: 4300 });
  assert.ok(id);
  macchine.salvaMacchina(db, { id, listinoId, userId: 1, nome: 'Aggiunta a mano', prezzo: 4100, note: 'ricondizionato' });
  const m = macchine.macchineDiListino(db, listinoId, 1).find(x => x.id === id);
  assert.equal(m.prezzo, 4100);
  assert.equal(m.note, 'ricondizionato');
  db.close();
});

test('salvaMacchina rifiuta un nome duplicato nello stesso listino, in inserimento e in modifica', () => {
  const db = dbVuoto();
  const listinoId = conListino(db);
  assert.throws(() => macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Analizzatore biochimico', prezzo: 1 }), /esiste gia/i);
  const { id } = macchine.salvaMacchina(db, { listinoId, userId: 1, nome: 'Terza', prezzo: 1 });
  assert.throws(() => macchine.salvaMacchina(db, { id, listinoId, userId: 1, nome: 'Analizzatore biochimico', prezzo: 1 }), /esiste gia/i);
  db.close();
});

test('un altro account non puo modificare la macchina altrui', () => {
  const db = dbVuoto();
  const listinoId = conListino(db, 1);
  const id = macchine.macchineDiListino(db, listinoId, 1)[0].id;
  assert.throws(() => macchine.salvaMacchina(db, { id, listinoId, userId: 2, nome: 'Rubata', prezzo: 1 }), /non trovat/i);
  assert.equal(macchine.macchineDiListino(db, listinoId, 1)[0].nome, 'Analizzatore biochimico');
  db.close();
});

test('eliminaMacchina rimuove solo la propria', () => {
  const db = dbVuoto();
  const listinoId = conListino(db, 1);
  const id = macchine.macchineDiListino(db, listinoId, 1)[0].id;
  assert.equal(macchine.eliminaMacchina(db, id, 2), false);
  assert.equal(macchine.eliminaMacchina(db, id, 1), true);
  assert.equal(macchine.macchineDiListino(db, listinoId, 1).length, 1);
  db.close();
});
