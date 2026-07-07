'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema, norm } = require('./piani.js');

test('norm lowercases, trims, collapses spaces', () => {
  assert.equal(norm('  Profilo   MYLAV  Base '), 'profilo mylav base');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});

test('ensureSchema creates the four new tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tables.includes('piani_sconto'));
  assert.ok(tables.includes('esami_riferimento'));
  assert.ok(tables.includes('prezzi_piano_esame'));
  assert.ok(tables.includes('prezzi_esami_custom'));
  db.close();
});

test('ensureSchema adds piano_id to dati_foglio and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  ensureSchema(db); // seconda chiamata non deve lanciare errori
  const cols = db.prepare(`PRAGMA table_info(dati_foglio)`).all().map(c => c.name);
  assert.ok(cols.includes('piano_id'));
  db.close();
});
