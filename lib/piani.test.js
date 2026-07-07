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

const { categoriaDiPiano, annoDiPiano, upsertFromJson, seedFromJson } = require('./piani.js');

test('categoriaDiPiano classifica i piani noti, fallback ad Altro', () => {
  assert.equal(categoriaDiPiano('GOLD PACK 2026'), 'Pacchetti standard');
  assert.equal(categoriaDiPiano('TITANIUM SILVER PACK _ LEISHMANIA 2026'), 'Titanium');
  assert.equal(categoriaDiPiano('PIANO INESISTENTE 2099'), 'Altro');
});

test('annoDiPiano estrae l\'anno finale dal nome', () => {
  assert.equal(annoDiPiano('GOLD PACK 2026'), 2026);
  assert.equal(annoDiPiano('Nessun anno qui'), null);
});

function dbConTabelle() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  return db;
}

test('seedFromJson popola le tabelle ed e\' idempotente', () => {
  const db = dbConTabelle();
  const data = {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: {
      'GOLD PACK 2026': { 'ESAME A': 8 },
      'SILVER PACK 2026': { 'ESAME A': 9, 'ESAME B': 18 }
    },
    plan_order: ['GOLD PACK 2026', 'SILVER PACK 2026']
  };

  const r1 = seedFromJson(db, data);
  assert.equal(r1.seeded, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM esami_riferimento').get().c, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM prezzi_piano_esame').get().c, 3);

  const r2 = seedFromJson(db, data);
  assert.equal(r2.seeded, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 2);
  db.close();
});

test('upsertFromJson aggiorna i prezzi su import ripetuto', () => {
  const db = dbConTabelle();
  const dataV1 = {
    exams_base_price: { 'ESAME A': 10 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 8 } },
    plan_order: ['GOLD PACK 2026']
  };
  upsertFromJson(db, dataV1);

  const dataV2 = {
    exams_base_price: { 'ESAME A': 11 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 7 } },
    plan_order: ['GOLD PACK 2026']
  };
  upsertFromJson(db, dataV2);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM piani_sconto').get().c, 1);
  assert.equal(db.prepare('SELECT prezzo_base FROM esami_riferimento WHERE nome = ?').get('esame a').prezzo_base, 11);
  const prezzo = db.prepare(`
    SELECT pp.prezzo FROM prezzi_piano_esame pp
    JOIN piani_sconto p ON p.id = pp.piano_id
    WHERE p.nome = 'GOLD PACK 2026'
  `).get();
  assert.equal(prezzo.prezzo, 7);
  db.close();
});
