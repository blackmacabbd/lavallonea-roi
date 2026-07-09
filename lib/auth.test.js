'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const auth = require('./auth.js');

test('ensureSchema crea users/sessions/reset_codes ed è idempotente', () => {
  const db = new DatabaseSync(':memory:');
  auth.ensureSchema(db); auth.ensureSchema(db);
  const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  assert.ok(t.includes('users') && t.includes('sessions') && t.includes('reset_codes'));
  db.close();
});

test('validaPassword applica lunghezza, cifra e speciale', () => {
  assert.equal(auth.validaPassword('abcdefgh').ok, false);      // no cifra/speciale
  assert.equal(auth.validaPassword('abcdefg1').ok, false);      // no speciale
  assert.equal(auth.validaPassword('Ab1!').ok, false);          // troppo corta
  assert.equal(auth.validaPassword('abcdef1!').ok, true);
});

test('normEmail normalizza lowercase e trim', () => {
  assert.equal(auth.normEmail('  Mario.Rossi@Example.COM '), 'mario.rossi@example.com');
});

test('hashPassword/verifyPassword', () => {
  const h = auth.hashPassword('abcdef1!');
  assert.ok(h.includes(':'));
  assert.equal(auth.verifyPassword('abcdef1!', h), true);
  assert.equal(auth.verifyPassword('sbagliata9!', h), false);
});

test('genToken e genRecoveryCode sono ad alta entropia e distinti', () => {
  const a = auth.genToken(), b = auth.genToken();
  assert.equal(a.length, 64); assert.notEqual(a, b);
  const r = auth.genRecoveryCode();
  assert.match(r, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('lookupHash è stabile e ignora trattini/case', () => {
  const code = 'K7M4-Q2XR-9T5P';
  assert.equal(auth.lookupHash(code), auth.lookupHash('k7m4q2xr9t5p'));
  assert.equal(auth.lookupHash(code).length, 64);
});

test('genResetCode sono 6 cifre', () => {
  assert.match(auth.genResetCode(), /^[0-9]{6}$/);
});
