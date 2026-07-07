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

const { getPrezzoBase, resolvePrezzo, salvaPrezzoCustom } = require('./piani.js');

function dbConSeed() {
  const db = dbConTabelle();
  seedFromJson(db, {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 8 } },
    plan_order: ['GOLD PACK 2026']
  });
  return db;
}

test('getPrezzoBase restituisce il prezzo base per esame noto, null per sconosciuto', () => {
  const db = dbConSeed();
  assert.equal(getPrezzoBase(db, 'Esame A'), 10);
  assert.equal(getPrezzoBase(db, 'Non Esiste'), null);
  db.close();
});

test('resolvePrezzo trova il prezzo dal piano quando presente', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'esame a');
  assert.deepEqual(r, { prezzo: 8, fonte: 'piano' });
  db.close();
});

test('resolvePrezzo cade sul custom se il piano non ha quell\'esame', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15);
  const r = resolvePrezzo(db, pianoId, 'ESAME NUOVO');
  assert.deepEqual(r, { prezzo: 15, fonte: 'custom' });
  db.close();
});

test('resolvePrezzo cade sul prezzo base se l\'esame e\' noto ma manca nel listino di quel piano (dato incompleto)', () => {
  const db = dbConSeed();
  // 'ESAME B' esiste in exams_base_price ma non e' stato prezzato per GOLD PACK 2026 nel seed di test
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'esame b');
  assert.deepEqual(r, { prezzo: 20, fonte: 'base_fallback' });
  db.close();
});

test('resolvePrezzo restituisce assente solo se l\'esame e\' del tutto sconosciuto (mai visto ne\' come base ne\' come custom)', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'boh mai sentito');
  assert.deepEqual(r, { prezzo: null, fonte: 'assente' });
  db.close();
});

test('salvaPrezzoCustom aggiorna se richiamata due volte sulla stessa combinazione', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15);
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 18);
  const r = resolvePrezzo(db, pianoId, 'esame nuovo');
  assert.equal(r.prezzo, 18);
  db.close();
});

const { pianoMigliorePerEsame } = require('./piani.js');

function dbConDuePiani() {
  const db = dbConTabelle();
  seedFromJson(db, {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: {
      'GOLD PACK 2026': { 'ESAME A': 8 },
      'SILVER PACK 2026': { 'ESAME A': 9 }
    },
    plan_order: ['GOLD PACK 2026', 'SILVER PACK 2026']
  });
  return db;
}

test('pianoMigliorePerEsame restituisce null per esame del tutto sconosciuto', () => {
  const db = dbConDuePiani();
  assert.equal(pianoMigliorePerEsame(db, 'boh mai sentito'), null);
  db.close();
});

test('pianoMigliorePerEsame sceglie il piano col prezzo piu\' basso tra quelli con prezzo di piano', () => {
  const db = dbConDuePiani();
  const r = pianoMigliorePerEsame(db, 'esame a');
  assert.equal(r.pianoNome, 'GOLD PACK 2026'); // 8 < 9
  assert.equal(r.prezzo, 8);
  assert.equal(r.fonte, 'piano');
  db.close();
});

test('pianoMigliorePerEsame considera anche i prezzi custom nel confronto', () => {
  const db = dbConDuePiani();
  // 'ESAME B' non ha un prezzo di piano per nessuno dei due piani (solo base=20):
  // un prezzo custom su SILVER per quell'esame deve competere col base_fallback di GOLD (20)
  const silverId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'SILVER PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'esame b', silverId, 5);
  const r = pianoMigliorePerEsame(db, 'esame b');
  assert.equal(r.pianoNome, 'SILVER PACK 2026');
  assert.equal(r.prezzo, 5);
  assert.equal(r.fonte, 'custom');
  db.close();
});

test('pianoMigliorePerEsame considera il fallback al prezzo base quando nessun piano ha un prezzo specifico', () => {
  const db = dbConDuePiani();
  // 'ESAME B' non e' prezzato da nessuno dei due piani, ma esiste come base a 20
  const r = pianoMigliorePerEsame(db, 'esame b');
  assert.equal(r.prezzo, 20);
  assert.equal(r.fonte, 'base_fallback');
  db.close();
});

test('pianoMigliorePerEsame ignora i piani disattivati', () => {
  const db = dbConDuePiani();
  const goldId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  db.prepare(`UPDATE piani_sconto SET attivo = 0 WHERE id = ?`).run(goldId);
  const r = pianoMigliorePerEsame(db, 'esame a');
  assert.equal(r.pianoNome, 'SILVER PACK 2026'); // GOLD (8, il piu' economico) e' disattivato
  assert.equal(r.prezzo, 9);
  db.close();
});
