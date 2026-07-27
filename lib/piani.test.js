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
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15, 1);
  const r = resolvePrezzo(db, pianoId, 'ESAME NUOVO', 1);
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
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15, 1);
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 18, 1);
  const r = resolvePrezzo(db, pianoId, 'esame nuovo', 1);
  assert.equal(r.prezzo, 18);
  db.close();
});

// ── Isolamento per utente dei prezzi custom ─────────────────────────────────

test('salvaPrezzoCustom: stesso esame/piano per utenti diversi non si sovrascrive a vicenda', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15, 1);
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 99, 2);

  const r1 = resolvePrezzo(db, pianoId, 'esame nuovo', 1);
  const r2 = resolvePrezzo(db, pianoId, 'esame nuovo', 2);
  assert.deepEqual(r1, { prezzo: 15, fonte: 'custom' });
  assert.deepEqual(r2, { prezzo: 99, fonte: 'custom' });
  db.close();
});

test('resolvePrezzo ignora i prezzi custom di un altro utente', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15, 1);
  // user 2 non ha salvato nulla per questo esame -> non deve vedere il custom di user 1
  const r = resolvePrezzo(db, pianoId, 'esame nuovo', 2);
  assert.equal(r.fonte, 'assente');
  db.close();
});

test('resolvePrezzo senza userId (catalogo/ospite) ignora tutti i prezzi custom', () => {
  const db = dbConSeed();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  salvaPrezzoCustom(db, 'Esame Nuovo', pianoId, 15, 1);
  const r = resolvePrezzo(db, pianoId, 'esame nuovo');
  assert.equal(r.fonte, 'assente');
  db.close();
});

// ── Matching tollerante nome esame (bug: nome troncato/parziale non trovava prezzo) ──
function dbConNomiLunghi() {
  const db = dbConTabelle();
  seedFromJson(db, {
    exams_base_price: {
      'esame citologico - 1 organo o 1 nodulo cutaneo': 46,
      'esame citologico - cute lesione multipla': 30,
      'emocromo completo con formula': 12
    },
    plans: { 'DIAMOND SILVER PACK 2026': { 'esame citologico - 1 organo o 1 nodulo cutaneo': 20 } },
    plan_order: ['DIAMOND SILVER PACK 2026']
  });
  return db;
}

test('getPrezzoBase risolve un nome troncato (sottostringa univoca) al canonico', () => {
  const db = dbConNomiLunghi();
  // nome esatto: ok
  assert.equal(getPrezzoBase(db, 'esame citologico - 1 organo o 1 nodulo cutaneo'), 46);
  // nome troncato dall'utente: deve comunque risolvere al canonico
  assert.equal(getPrezzoBase(db, 'esame citologico - 1 organo'), 46);
  db.close();
});

test('resolvePrezzo risolve un nome troncato al prezzo di piano del canonico', () => {
  const db = dbConNomiLunghi();
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'DIAMOND SILVER PACK 2026'`).get().id;
  const r = resolvePrezzo(db, pianoId, 'esame citologico - 1 organo');
  assert.deepEqual(r, { prezzo: 20, fonte: 'piano' });
  db.close();
});

test('il matching tollerante NON indovina quando il frammento e\' ambiguo (piu\' canonici lo contengono)', () => {
  const db = dbConNomiLunghi();
  // "esame citologico" e' contenuto in due canonici diversi -> non deve scegliere a caso
  assert.equal(getPrezzoBase(db, 'esame citologico'), null);
  const pianoId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'DIAMOND SILVER PACK 2026'`).get().id;
  assert.equal(resolvePrezzo(db, pianoId, 'esame citologico').fonte, 'assente');
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
  // Un prezzo custom appartiene a un account, quindi riferisce un piano della SUA
  // copia del catalogo: la fixture la crea, com'e' sempre il caso in produzione.
  require('./piani.js').copiaCatalogoPerUtente(db, 1);
  // 'ESAME B' non ha un prezzo di piano per nessuno dei due piani (solo base=20):
  // un prezzo custom su SILVER per quell'esame deve competere col base_fallback di GOLD (20)
  const silverId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'SILVER PACK 2026' AND user_id = 1`).get().id;
  salvaPrezzoCustom(db, 'esame b', silverId, 5, 1);
  const r = pianoMigliorePerEsame(db, 'esame b', 1);
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

const { pianoMiglioreTotale } = require('./piani.js');

test('pianoMiglioreTotale sceglie il piano col totale minimo su piu esami (non solo il primo)', () => {
  const db = dbConDuePiani();
  // ESAME A: GOLD 8, SILVER 9. ESAME B: nessun piano lo prezza -> base_fallback 20 per entrambi.
  // GOLD tot = 8+20=28 ; SILVER tot = 9+20=29 -> GOLD
  const r = pianoMiglioreTotale(db, [{ nome: 'esame a', n: 1 }, { nome: 'esame b', n: 1 }]);
  assert.equal(r.pianoNome, 'GOLD PACK 2026');
  assert.equal(r.totale, 28);
  assert.equal(r.nEsami, 2);
  assert.equal(r.nSaltati, 0);
  db.close();
});

test('pianoMiglioreTotale rispetta la quantita (n)', () => {
  const db = dbConDuePiani();
  const r = pianoMiglioreTotale(db, [{ nome: 'esame a', n: 3 }]);
  assert.equal(r.pianoNome, 'GOLD PACK 2026');
  assert.equal(r.totale, 24); // 8 * 3
  db.close();
});

test('pianoMiglioreTotale salta gli esami sconosciuti e li conta in nSaltati', () => {
  const db = dbConDuePiani();
  const r = pianoMiglioreTotale(db, [{ nome: 'esame a', n: 1 }, { nome: 'boh mai sentito', n: 1 }]);
  assert.equal(r.totale, 8);
  assert.equal(r.nEsami, 1);
  assert.equal(r.nSaltati, 1);
  db.close();
});

test('pianoMiglioreTotale ritorna null se nessun esame valido', () => {
  const db = dbConDuePiani();
  assert.equal(pianoMiglioreTotale(db, []), null);
  assert.equal(pianoMiglioreTotale(db, [{ nome: 'boh', n: 1 }]), null);
  db.close();
});

test('pianoMiglioreTotale ignora i piani disattivati', () => {
  const db = dbConDuePiani();
  const goldId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  db.prepare(`UPDATE piani_sconto SET attivo = 0 WHERE id = ?`).run(goldId);
  const r = pianoMiglioreTotale(db, [{ nome: 'esame a', n: 1 }]);
  assert.equal(r.pianoNome, 'SILVER PACK 2026');
  assert.equal(r.totale, 9);
  db.close();
});

const { pianiClassifica } = require('./piani.js');

test('pianiClassifica ordina i piani per totale crescente', () => {
  const db = dbConDuePiani();
  // ESAME A: GOLD 8, SILVER 9 -> GOLD prima di SILVER
  const r = pianiClassifica(db, [{ nome: 'esame a', n: 1 }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].pianoNome, 'GOLD PACK 2026');
  assert.equal(r[0].totale, 8);
  assert.equal(r[1].pianoNome, 'SILVER PACK 2026');
  assert.equal(r[1].totale, 9);
  db.close();
});

test('pianiClassifica conta gli esami saltati per piano', () => {
  const db = dbConDuePiani();
  const r = pianiClassifica(db, [{ nome: 'esame a', n: 1 }, { nome: 'boh mai sentito', n: 1 }]);
  assert.equal(r[0].nEsami, 1);
  assert.equal(r[0].nSaltati, 1);
  db.close();
});

test('pianiClassifica esclude i piani disattivati', () => {
  const db = dbConDuePiani();
  const goldId = db.prepare(`SELECT id FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().id;
  db.prepare(`UPDATE piani_sconto SET attivo = 0 WHERE id = ?`).run(goldId);
  const r = pianiClassifica(db, [{ nome: 'esame a', n: 1 }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].pianoNome, 'SILVER PACK 2026');
  db.close();
});

test('pianiClassifica ritorna [] senza esami', () => {
  const db = dbConDuePiani();
  assert.deepEqual(pianiClassifica(db, []), []);
  assert.deepEqual(pianiClassifica(db, [{ nome: '', n: 1 }]), []);
  db.close();
});

// ─── Catalogo per-utente: copia privata dal template ufficiale ──────────────
// Convenzione: user_id IS NULL = template ufficiale (dal seed JSON), non di
// nessun utente; user_id = N = copia privata dell'utente N.
const { copiaCatalogoPerUtente } = require('./piani.js');

function dbConTemplate() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE dati_foglio (id INTEGER PRIMARY KEY, esame TEXT)`);
  ensureSchema(db);
  require('./piani.js').seedFromJson(db, {
    exams_base_price: { 'ESAME A': 10, 'ESAME B': 20 },
    plans: { 'GOLD PACK 2026': { 'ESAME A': 8 }, 'SILVER PACK 2026': { 'ESAME A': 9, 'ESAME B': 18 } },
    plan_order: ['GOLD PACK 2026', 'SILVER PACK 2026']
  });
  return db;
}

test('ensureSchema aggiunge user_id a piani_sconto e esami_riferimento', () => {
  const db = dbConTemplate();
  const pianiCols = db.prepare(`PRAGMA table_info(piani_sconto)`).all().map(c => c.name);
  const esamiCols = db.prepare(`PRAGMA table_info(esami_riferimento)`).all().map(c => c.name);
  assert.ok(pianiCols.includes('user_id'), 'piani_sconto.user_id mancante');
  assert.ok(esamiCols.includes('user_id'), 'esami_riferimento.user_id mancante');
  db.close();
});

test('il seed popola il TEMPLATE (user_id IS NULL), non un utente', () => {
  const db = dbConTemplate();
  const template = db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NULL`).get().c;
  const diUtenti = db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NOT NULL`).get().c;
  assert.equal(template, 2);
  assert.equal(diUtenti, 0);
  db.close();
});

test('nessun UNIQUE globale sul nome: due utenti possono avere lo stesso nome piano', () => {
  const db = dbConTemplate();
  copiaCatalogoPerUtente(db, 1);
  copiaCatalogoPerUtente(db, 2);
  const n = db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE nome = 'GOLD PACK 2026'`).get().c;
  assert.equal(n, 3); // template + utente 1 + utente 2
  db.close();
});

test('copiaCatalogoPerUtente copia piani, esami e prezzi con id rimappati', () => {
  const db = dbConTemplate();
  const r = copiaCatalogoPerUtente(db, 1);
  assert.equal(r.copiato, true);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id = 1`).get().c, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM esami_riferimento WHERE user_id = 1`).get().c, 2);
  // i prezzi della copia puntano ai NUOVI id, non a quelli del template
  const prezzi = db.prepare(`
    SELECT p.nome AS piano, e.nome AS esame, pp.prezzo
    FROM prezzi_piano_esame pp
    JOIN piani_sconto p ON p.id = pp.piano_id
    JOIN esami_riferimento e ON e.id = pp.esame_id
    WHERE p.user_id = 1 AND e.user_id = 1
    ORDER BY p.nome, e.nome
  `).all();
  assert.equal(prezzi.length, 3);
  const gold = prezzi.find(x => x.piano === 'GOLD PACK 2026');
  assert.equal(gold.esame, 'esame a');
  assert.equal(gold.prezzo, 8);
  db.close();
});

test('copiaCatalogoPerUtente e\' idempotente: seconda chiamata non duplica', () => {
  const db = dbConTemplate();
  copiaCatalogoPerUtente(db, 1);
  const r2 = copiaCatalogoPerUtente(db, 1);
  assert.equal(r2.copiato, false);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id = 1`).get().c, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM prezzi_piano_esame`).get().c, 3 + 3); // template + 1 copia
  db.close();
});

test('isolamento: modificare la copia di un utente non tocca template ne\' altri utenti', () => {
  const db = dbConTemplate();
  copiaCatalogoPerUtente(db, 1);
  copiaCatalogoPerUtente(db, 2);

  const pianoU1 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 1 AND nome = 'GOLD PACK 2026'`).get().id;
  const esameU1 = db.prepare(`SELECT id FROM esami_riferimento WHERE user_id = 1 AND nome = 'esame a'`).get().id;
  db.prepare(`UPDATE prezzi_piano_esame SET prezzo = 999 WHERE piano_id = ? AND esame_id = ?`).run(pianoU1, esameU1);
  db.prepare(`UPDATE piani_sconto SET attivo = 0 WHERE id = ?`).run(pianoU1);

  const leggiPrezzo = (uid) => db.prepare(`
    SELECT pp.prezzo FROM prezzi_piano_esame pp
    JOIN piani_sconto p ON p.id = pp.piano_id
    JOIN esami_riferimento e ON e.id = pp.esame_id
    WHERE p.nome = 'GOLD PACK 2026' AND e.nome = 'esame a'
      AND ${uid === null ? 'p.user_id IS NULL' : 'p.user_id = ' + uid}
  `).get().prezzo;

  assert.equal(leggiPrezzo(1), 999);   // modificato
  assert.equal(leggiPrezzo(2), 8);     // utente 2 intatto
  assert.equal(leggiPrezzo(null), 8);  // template intatto
  assert.equal(db.prepare(`SELECT attivo FROM piani_sconto WHERE user_id = 2 AND nome = 'GOLD PACK 2026'`).get().attivo, 1);
  db.close();
});

// ─── Scoping del catalogo per account ───────────────────────────────────────
// Regola: userId fornito -> si legge SOLO la copia di quell'account;
// userId assente (ospite) -> si legge il template ufficiale.
const P = require('./piani.js');

function dbConDueCopie() {
  const db = dbConTemplate();          // template: GOLD(esame a=8), SILVER(a=9, b=18)
  P.copiaCatalogoPerUtente(db, 1);
  P.copiaCatalogoPerUtente(db, 2);
  return db;
}

test('scoping: pianiClassifica non mescola template e copie di altri account', () => {
  const db = dbConDueCopie();
  const esami = [{ nome: 'esame a', n: 1 }];
  assert.equal(P.pianiClassifica(db, esami, 1).length, 2, 'utente 1 deve vedere solo i suoi 2 piani');
  assert.equal(P.pianiClassifica(db, esami, 2).length, 2, 'utente 2 deve vedere solo i suoi 2 piani');
  assert.equal(P.pianiClassifica(db, esami).length, 2, 'ospite deve vedere solo i 2 del template');
  db.close();
});

test('scoping: i piani di un account puntano ai SUOI id, non a quelli del template', () => {
  const db = dbConDueCopie();
  const idsU1 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 1`).all().map(r => r.id);
  const classifica = P.pianiClassifica(db, [{ nome: 'esame a', n: 1 }], 1);
  classifica.forEach(c => assert.ok(idsU1.includes(c.pianoId), `pianoId ${c.pianoId} non appartiene all'utente 1`));
  db.close();
});

test('scoping: modificare un prezzo nella propria copia non altera gli altri', () => {
  const db = dbConDueCopie();
  const pianoU1 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 1 AND nome = 'GOLD PACK 2026'`).get().id;
  const esameU1 = db.prepare(`SELECT id FROM esami_riferimento WHERE user_id = 1 AND nome = 'esame a'`).get().id;
  db.prepare(`UPDATE prezzi_piano_esame SET prezzo = 3 WHERE piano_id = ? AND esame_id = ?`).run(pianoU1, esameU1);

  const pianoU2 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 2 AND nome = 'GOLD PACK 2026'`).get().id;
  const pianoTpl = db.prepare(`SELECT id FROM piani_sconto WHERE user_id IS NULL AND nome = 'GOLD PACK 2026'`).get().id;

  assert.equal(P.resolvePrezzo(db, pianoU1, 'esame a', 1).prezzo, 3, 'utente 1 vede il prezzo modificato');
  assert.equal(P.resolvePrezzo(db, pianoU2, 'esame a', 2).prezzo, 8, 'utente 2 non deve essere toccato');
  assert.equal(P.resolvePrezzo(db, pianoTpl, 'esame a').prezzo, 8, 'template non deve essere toccato');
  db.close();
});

test('scoping: resolvePrezzo risolve l\'esame nella copia dell\'account (join id coerenti)', () => {
  const db = dbConDueCopie();
  const pianoU1 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 1 AND nome = 'SILVER PACK 2026'`).get().id;
  const r = P.resolvePrezzo(db, pianoU1, 'esame b', 1);
  assert.equal(r.fonte, 'piano', 'deve trovare il prezzo di piano, non cadere sul fallback');
  assert.equal(r.prezzo, 18);
  db.close();
});

test('scoping: un piano creato da un account non compare agli altri ne\' al template', () => {
  const db = dbConDueCopie();
  db.prepare(`INSERT INTO piani_sconto (nome, categoria, anno, ordine, attivo, user_id) VALUES (?, 'Altro', 2026, 99, 1, 1)`)
    .run('PIANO PRIVATO U1');
  const nomi = (uid) => P.pianiClassifica(db, [{ nome: 'esame a', n: 1 }], uid).map(c => c.pianoNome);
  assert.ok(nomi(1).includes('PIANO PRIVATO U1'));
  assert.ok(!nomi(2).includes('PIANO PRIVATO U1'));
  assert.ok(!P.pianiClassifica(db, [{ nome: 'esame a', n: 1 }]).map(c => c.pianoNome).includes('PIANO PRIVATO U1'));
  db.close();
});

test('scoping: getPrezzoBase e pianoMiglioreTotale rispettano l\'account', () => {
  const db = dbConDueCopie();
  const esameU1 = db.prepare(`SELECT id FROM esami_riferimento WHERE user_id = 1 AND nome = 'esame a'`).get().id;
  db.prepare(`UPDATE esami_riferimento SET prezzo_base = 99 WHERE id = ?`).run(esameU1);
  assert.equal(P.getPrezzoBase(db, 'esame a', 1), 99);
  assert.equal(P.getPrezzoBase(db, 'esame a', 2), 10);
  assert.equal(P.getPrezzoBase(db, 'esame a'), 10, 'ospite legge il template');

  const bestU1 = P.pianoMiglioreTotale(db, [{ nome: 'esame a', n: 1 }], 1);
  const idsU1 = db.prepare(`SELECT id FROM piani_sconto WHERE user_id = 1`).all().map(r => r.id);
  assert.ok(idsU1.includes(bestU1.pianoId));
  db.close();
});

test('upsertFromJson con userId scrive nella copia dell\'account, non nel template', () => {
  const db = dbConDueCopie();
  P.upsertFromJson(db, {
    exams_base_price: { 'ESAME NUOVO': 50 },
    plans: { 'PIANO IMPORTATO': { 'ESAME NUOVO': 40 } },
    plan_order: ['PIANO IMPORTATO']
  }, 1);

  const nomiU1 = db.prepare(`SELECT nome FROM piani_sconto WHERE user_id = 1`).all().map(r => r.nome);
  assert.ok(nomiU1.includes('PIANO IMPORTATO'), 'il piano importato deve stare nella copia di U1');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NULL AND nome = 'PIANO IMPORTATO'`).get().c, 0, 'template non toccato');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id = 2 AND nome = 'PIANO IMPORTATO'`).get().c, 0, 'altro account non toccato');
  assert.equal(P.getPrezzoBase(db, 'esame nuovo', 1), 50);
  assert.equal(P.getPrezzoBase(db, 'esame nuovo', 2), null, 'l\'esame importato non esiste per U2');
  db.close();
});

test('upsertFromJson senza userId continua a popolare il template (seed al boot)', () => {
  const db = dbConTemplate();
  P.upsertFromJson(db, {
    exams_base_price: { 'ESAME C': 30 },
    plans: { 'PIANO TEMPLATE': { 'ESAME C': 25 } },
    plan_order: ['PIANO TEMPLATE']
  });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM piani_sconto WHERE user_id IS NULL AND nome = 'PIANO TEMPLATE'`).get().c, 1);
  db.close();
});
