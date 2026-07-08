'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema, upsertConcorrente, listaConcorrenti, dettaglioConcorrente } = require('./concorrenti.js');

function dbVuoto() {
  return new DatabaseSync(':memory:');
}

test('ensureSchema crea le tabelle concorrenti e esami_concorrente', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tables.includes('concorrenti'));
  assert.ok(tables.includes('esami_concorrente'));
  db.close();
});

test('ensureSchema e\' idempotente', () => {
  const db = dbVuoto();
  ensureSchema(db);
  ensureSchema(db);
  db.close();
});

test('upsertConcorrente crea il concorrente e le righe esami', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Istologico standard', prezzo: 30, sconto: 10 },
    { nome_originale: 'Emocromo completo', prezzo: 12, sconto: null }
  ]);
  assert.equal(r.righeSalvate, 2);
  const righe = db.prepare('SELECT * FROM esami_concorrente WHERE concorrente_id = ?').all(r.concorrenteId);
  assert.equal(righe.length, 2);
  assert.equal(righe.find(x => x.nome_originale === 'Istologico standard').prezzo, 30);
  assert.equal(righe.find(x => x.nome_originale === 'Emocromo completo').sconto, null);
  db.close();
});

test('upsertConcorrente su nome concorrente esistente riusa lo stesso concorrente_id (non duplica)', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r1 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame A', prezzo: 10, sconto: null }]);
  const r2 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame B', prezzo: 20, sconto: null }]);
  assert.equal(r1.concorrenteId, r2.concorrenteId);
  const count = db.prepare('SELECT COUNT(*) c FROM concorrenti').get().c;
  assert.equal(count, 1);
  db.close();
});

test('upsertConcorrente re-importato aggiorna prezzo/sconto ma non tocca un mapping gia\' confermato', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r1 = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Istologico standard', prezzo: 30, sconto: 10 }]);
  const rigaId = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ?').get(r1.concorrenteId).id;
  db.prepare('UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ?').run('istologico', rigaId);

  upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Istologico standard', prezzo: 33, sconto: 12 }]);

  const riga = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(rigaId);
  assert.equal(riga.prezzo, 33);
  assert.equal(riga.sconto, 12);
  assert.equal(riga.esame_mylav_nome, 'istologico');
  assert.equal(riga.confermato, 1);
  db.close();
});

test('upsertConcorrente lancia un errore se il nome concorrente e\' vuoto', () => {
  const db = dbVuoto();
  ensureSchema(db);
  assert.throws(() => upsertConcorrente(db, '  ', [{ nome_originale: 'X', prezzo: 1, sconto: null }]));
  db.close();
});

test('listaConcorrenti conta esami totali e mappati', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Esame A', prezzo: 10, sconto: null },
    { nome_originale: 'Esame B', prezzo: 20, sconto: null }
  ]);
  db.prepare('UPDATE esami_concorrente SET esame_mylav_nome = ? WHERE concorrente_id = ? AND nome_originale = ?')
    .run('esame a mylav', r.concorrenteId, 'Esame A');

  const lista = listaConcorrenti(db);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'IDEXX 2026');
  assert.equal(lista[0].n_esami, 2);
  assert.equal(lista[0].n_mappati, 1);
  db.close();
});

test('dettaglioConcorrente ritorna concorrente + righe, null se non esiste', () => {
  const db = dbVuoto();
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [{ nome_originale: 'Esame A', prezzo: 10, sconto: null }]);
  const d = dettaglioConcorrente(db, r.concorrenteId);
  assert.equal(d.concorrente.nome, 'IDEXX 2026');
  assert.equal(d.esami.length, 1);
  assert.equal(dettaglioConcorrente(db, 999999), null);
  db.close();
});
