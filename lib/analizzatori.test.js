'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const an = require('./analizzatori');

function dbProva() { const db = new DatabaseSync(':memory:'); an.ensureSchema(db); return db; }

test('upsertAnalizzatore salva e rilegge', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000, noleggio: 250 });
  assert.ok(id > 0);
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 12000);
  assert.equal(righe[0].noleggio, 250);
  db.close();
});

// Un analizzatore puo' essere solo venduto o solo noleggiato: entrambi i campi
// sono facoltativi, e "non previsto" non e' la stessa cosa di "costa zero".
test('prezzo e noleggio sono facoltativi e restano distinti da zero', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Solo noleggio', prezzo: null, noleggio: 180 });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.prezzo, null);
  assert.equal(r.noleggio, 180);
  db.close();
});

test('reimportare lo stesso nome aggiorna invece di duplicare', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500 });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 11500);
  db.close();
});

test('gli analizzatori sono isolati per account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'A', prezzo: 2 });
  assert.equal(an.listaAnalizzatori(db, 1).length, 1);
  assert.equal(an.listaAnalizzatori(db, 1)[0].prezzo, 1);
  db.close();
});

test('eliminaAnalizzatore tocca solo il proprio account', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.eliminaAnalizzatore(db, id, 2);
  assert.equal(an.listaAnalizzatori(db, 1).length, 1, 'un altro account non puo cancellarlo');
  an.eliminaAnalizzatore(db, id, 1);
  assert.equal(an.listaAnalizzatori(db, 1).length, 0);
  db.close();
});
