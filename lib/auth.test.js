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

// I motivi di password non valida sono l'errore piu' probabile del percorso di
// reset: senza un codice arriverebbero in italiano a chi ha l'interfaccia in
// un'altra lingua, e sono proprio le istruzioni per rientrare nell'account.
test('validaPassword: ogni motivo porta il suo codice', () => {
  const casi = [
    ['corta1!', 'PASSWORD_CORTA'],
    ['soloLettere!', 'PASSWORD_SENZA_NUMERO'],
    ['senzaSpeciale1', 'PASSWORD_SENZA_SPECIALE']
  ];
  for (const [pw, codice] of casi) {
    const esito = auth.validaPassword(pw);
    assert.strictEqual(esito.ok, false, `"${pw}" deve essere rifiutata`);
    assert.strictEqual(esito.codice, codice);
    assert.ok(esito.motivo, 'il motivo italiano resta, e la ricaduta con lui');
  }
  const buona = auth.validaPassword('Prova!2345678');
  assert.strictEqual(buona.ok, true);
  assert.strictEqual(buona.codice, undefined, 'una password valida non ha codice d errore');
});
