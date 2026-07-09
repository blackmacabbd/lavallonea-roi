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

const { tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch } = require('./concorrenti.js');

test('tokenizza normalizza, splitta e rimuove le stopword', () => {
  assert.deepEqual(tokenizza('Esame Istologico Standard'), ['istologico', 'standard']);
  assert.deepEqual(tokenizza('Test del Sangue'), ['sangue']);
});

test('jaccard e\' 1 per token identici, 0 se nessuna sovrapposizione', () => {
  assert.equal(jaccard(['istologico', 'standard'], ['istologico', 'standard']), 1);
  assert.equal(jaccard(['istologico'], ['emocromo']), 0);
});

test('jaccard gestisce array vuoti senza dividere per zero', () => {
  assert.equal(jaccard([], []), 0);
  assert.equal(jaccard(['a'], []), 0);
});

function dbConCatalogo() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  const r = upsertConcorrente(db, 'IDEXX 2026', [
    { nome_originale: 'Esame istopatologico completo', prezzo: 35, sconto: 5 },
    { nome_originale: 'Emocromo con formula', prezzo: 12, sconto: null }
  ]);
  return { db, concorrenteId: r.concorrenteId };
}

test('trovaMatch: nessun candidato -> trovato false', () => {
  const { db } = dbConCatalogo();
  assert.equal(trovaMatch(db, 999, 'istologico').trovato, false);
  db.close();
});

test('trovaMatch: score alto -> match sicuro e persiste esame_mylav_nome per i prossimi giri', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const r = trovaMatch(db, concorrenteId, 'Esame istopatologico completo');
  assert.equal(r.trovato, true);
  assert.equal(r.sicuro, true);
  assert.equal(r.nomeOriginale, 'Esame istopatologico completo');

  // Al giro successivo trova subito per match esatto sul nome mylav gia' salvato
  const riga = db.prepare('SELECT esame_mylav_nome FROM esami_concorrente WHERE id = ?').get(r.esameConcorrenteId);
  assert.equal(riga.esame_mylav_nome, require('./piani.js').norm('Esame istopatologico completo'));
  db.close();
});

test('trovaMatch: score basso non trova nulla', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const r = trovaMatch(db, concorrenteId, 'Radiografia torace');
  assert.equal(r.trovato, false);
  db.close();
});

test('trovaMatch: score intermedio -> trovato ma non sicuro, non persiste nulla', () => {
  const { db, concorrenteId } = dbConCatalogo();
  // "Emocromo" da solo condivide un token su piu' totali col candidato "Emocromo con formula"
  const r = trovaMatch(db, concorrenteId, 'Emocromo');
  assert.equal(r.trovato, true);
  assert.equal(r.sicuro, false);
  const riga = db.prepare('SELECT esame_mylav_nome FROM esami_concorrente WHERE id = ?').get(r.esameConcorrenteId);
  assert.equal(riga.esame_mylav_nome, null);
  db.close();
});

test('trovaMatch ignora le righe gia\' mappate ad un altro esame mylav', () => {
  const { db, concorrenteId } = dbConCatalogo();
  trovaMatch(db, concorrenteId, 'Esame istopatologico completo'); // si auto-conferma
  const r = trovaMatch(db, concorrenteId, 'Esame istopatologico completo diverso');
  // la riga e' gia' occupata da 'esame istopatologico completo': la ricerca esatta su questo nome fallisce,
  // e la ricerca fuzzy tra i non mappati non ha piu' candidati validi
  assert.equal(r.trovato, false);
  db.close();
});

test('trovaMatch risolve un nome PARZIALE di una mappatura confermata (tolleranza sottostringa)', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const riga = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ? AND nome_originale = ?')
    .get(concorrenteId, 'Emocromo con formula');
  confermaMatch(db, riga.id, 'emocromo mappato test');
  const r = trovaMatch(db, concorrenteId, 'emocromo mappato'); // parziale del nome mappato
  assert.equal(r.trovato, true);
  assert.equal(r.sicuro, true);
  assert.equal(r.esameConcorrenteId, riga.id);
  assert.equal(r.prezzo, 12);
  db.close();
});

test('confermaMatch imposta esame_mylav_nome e confermato=1', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const riga = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ? AND nome_originale = ?')
    .get(concorrenteId, 'Emocromo con formula');
  confermaMatch(db, riga.id, 'Emocromo Mylav');
  const aggiornata = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(riga.id);
  assert.equal(aggiornata.esame_mylav_nome, 'emocromo mylav');
  assert.equal(aggiornata.confermato, 1);
  db.close();
});

test('rimuoviMatch azzera esame_mylav_nome e confermato', () => {
  const { db, concorrenteId } = dbConCatalogo();
  const riga = db.prepare('SELECT id FROM esami_concorrente WHERE concorrente_id = ? AND nome_originale = ?')
    .get(concorrenteId, 'Emocromo con formula');
  confermaMatch(db, riga.id, 'Emocromo Mylav');
  rimuoviMatch(db, riga.id);
  const aggiornata = db.prepare('SELECT * FROM esami_concorrente WHERE id = ?').get(riga.id);
  assert.equal(aggiornata.esame_mylav_nome, null);
  assert.equal(aggiornata.confermato, 0);
  db.close();
});

const { eliminaConcorrente } = require('./concorrenti.js');

test('eliminaConcorrente rimuove il concorrente e i suoi esami; false se non esiste', () => {
  const { db, concorrenteId } = dbConCatalogo();
  assert.ok(db.prepare('SELECT COUNT(*) c FROM esami_concorrente WHERE concorrente_id = ?').get(concorrenteId).c > 0);

  assert.equal(eliminaConcorrente(db, concorrenteId), true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM concorrenti WHERE id = ?').get(concorrenteId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM esami_concorrente WHERE concorrente_id = ?').get(concorrenteId).c, 0);

  assert.equal(eliminaConcorrente(db, 999999), false);
  db.close();
});
