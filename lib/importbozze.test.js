'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const bozze = require('./importbozze.js');

function dbVuoto() {
  const db = new DatabaseSync(':memory:');
  bozze.ensureSchema(db);
  return db;
}

const RIGHE = [
  { nome: 'EMOCROMO COMPLETO', prezzo: 18.5, confidenza: 'alta', pagina: 1, x: 48, y: 100, w: 400, h: 12 },
  { nome: 'GALLS', prezzo: 22.9, confidenza: 'incerta', pagina: 1, x: 48, y: 120, w: 400, h: 12 }
];

const nuova = (db, userId = 1, extra = {}) => bozze.creaBozza(db, {
  userId,
  entita: 'piano',
  nomeFile: 'listino-2026.pdf',
  righe: RIGHE,
  pagine: 2,
  totaliTabellari: 3,
  classificate: 2,
  confidenza: 0.75,
  ...extra
});

test('ensureSchema crea le tabelle ed e idempotente', () => {
  const db = dbVuoto();
  bozze.ensureSchema(db);
  const tabelle = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tabelle.includes('import_bozze'));
  assert.ok(tabelle.includes('import_audit'));
  db.close();
});

test('creaBozza salva righe, conteggi e stato bozza', () => {
  const db = dbVuoto();
  const id = nuova(db).id;
  const b = bozze.getBozza(db, id, 1);
  assert.equal(b.stato, 'bozza');
  assert.equal(b.entita, 'piano');
  assert.equal(b.nomeFile, 'listino-2026.pdf');
  assert.equal(b.pagine, 2);
  assert.equal(b.totaliTabellari, 3);
  assert.equal(b.classificate, 2);
  assert.equal(b.confidenza, 0.75);
  assert.equal(b.righe.length, 2);
  assert.equal(b.righe[0].nome, 'EMOCROMO COMPLETO');
  assert.equal(b.righe[0].x, 48, 'le coordinate devono sopravvivere al giro in JSON');
  assert.ok(b.createdAt, 'data di creazione mancante');
  db.close();
});

test('entita non prevista: rifiutata', () => {
  const db = dbVuoto();
  assert.throws(() => nuova(db, 1, { entita: 'catalogo-segreto' }), /entita/i);
  db.close();
});

test('la bozza di un account non e leggibile da un altro', () => {
  const db = dbVuoto();
  const id = nuova(db, 1).id;
  assert.equal(bozze.getBozza(db, id, 2), null);
  assert.ok(bozze.getBozza(db, id, 1));
  db.close();
});

test('confermaBozza cambia stato e restituisce la bozza', () => {
  const db = dbVuoto();
  const id = nuova(db).id;
  const conf = bozze.confermaBozza(db, id, 1, [{ nome: 'EMOCROMO COMPLETO', prezzo: 18.5 }]);
  assert.ok(conf);
  assert.equal(conf.stato, 'confermato');
  assert.ok(conf.confermatoAt);
  assert.equal(bozze.getBozza(db, id, 1).stato, 'confermato');
  db.close();
});

test('la conferma salva le righe riviste dall operatore, non quelle originali', () => {
  const db = dbVuoto();
  const id = nuova(db).id;
  bozze.confermaBozza(db, id, 1, [{ nome: 'EMOCROMO COMPLETO CORRETTO', prezzo: 19 }]);
  const b = bozze.getBozza(db, id, 1);
  assert.equal(b.righe.length, 1);
  assert.equal(b.righe[0].nome, 'EMOCROMO COMPLETO CORRETTO');
  assert.equal(b.righe[0].prezzo, 19);
  db.close();
});

test('un altro account non puo confermare la bozza altrui', () => {
  const db = dbVuoto();
  const id = nuova(db, 1).id;
  assert.equal(bozze.confermaBozza(db, id, 2, RIGHE), null);
  assert.equal(bozze.getBozza(db, id, 1).stato, 'bozza', 'la bozza non deve essere toccata');
  db.close();
});

test('doppia conferma: la seconda non passa (nessuna doppia scrittura nel catalogo)', () => {
  const db = dbVuoto();
  const id = nuova(db).id;
  assert.ok(bozze.confermaBozza(db, id, 1, RIGHE));
  assert.equal(bozze.confermaBozza(db, id, 1, RIGHE), null);
  db.close();
});

test('bozza inesistente: null, non eccezione', () => {
  const db = dbVuoto();
  assert.equal(bozze.getBozza(db, 999, 1), null);
  assert.equal(bozze.confermaBozza(db, 999, 1, RIGHE), null);
  db.close();
});

test('normalizzaRighe tiene le righe valide e conta quelle ignorate', () => {
  const r = bozze.normalizzaRighe([
    { nome: '  EMOCROMO COMPLETO  ', prezzo: 18.5 },
    { nome: '', prezzo: 10 },
    { nome: 'SENZA PREZZO', prezzo: null },
    { nome: 'PREZZO NEGATIVO', prezzo: -3 },
    { nome: 'PREZZO TESTO', prezzo: 'tanto' }
  ]);
  assert.equal(r.valide.length, 1);
  assert.equal(r.valide[0].nome, 'EMOCROMO COMPLETO');
  assert.equal(r.valide[0].prezzo, 18.5);
  assert.equal(r.ignorate, 4);
});

test('normalizzaRighe accetta il prezzo scritto a mano con la virgola', () => {
  const r = bozze.normalizzaRighe([{ nome: 'T4 TOTALE', prezzo: '22,90' }]);
  assert.equal(r.valide[0].prezzo, 22.9);
  assert.equal(r.ignorate, 0);
});

test('normalizzaRighe accetta prezzo zero (esame incluso nel pacchetto)', () => {
  const r = bozze.normalizzaRighe([{ nome: 'ESAME INCLUSO', prezzo: 0 }]);
  assert.equal(r.valide.length, 1);
  assert.equal(r.valide[0].prezzo, 0);
});

test('normalizzaRighe: input non array o vuoto', () => {
  assert.equal(bozze.normalizzaRighe(null).valide.length, 0);
  assert.equal(bozze.normalizzaRighe([]).ignorate, 0);
});

test('registraAudit annota file, account, esito e data', () => {
  const db = dbVuoto();
  bozze.registraAudit(db, {
    userId: 1, entita: 'piano', nomeFile: 'listino.pdf',
    esito: 'analizzato', nRighe: 6, dettaglio: '6 su 6 righe'
  });
  const log = bozze.listaAudit(db, 1);
  assert.equal(log.length, 1);
  assert.equal(log[0].nomeFile, 'listino.pdf');
  assert.equal(log[0].esito, 'analizzato');
  assert.equal(log[0].nRighe, 6);
  assert.ok(log[0].data);
  db.close();
});

test('ogni account vede solo il proprio audit', () => {
  const db = dbVuoto();
  bozze.registraAudit(db, { userId: 1, entita: 'piano', nomeFile: 'mio.pdf', esito: 'confermato' });
  bozze.registraAudit(db, { userId: 2, entita: 'piano', nomeFile: 'altrui.pdf', esito: 'confermato' });
  const log = bozze.listaAudit(db, 1);
  assert.equal(log.length, 1);
  assert.equal(log[0].nomeFile, 'mio.pdf');
  db.close();
});

test('l audit registra anche i fallimenti, con il motivo', () => {
  const db = dbVuoto();
  bozze.registraAudit(db, {
    userId: 1, entita: 'concorrente', nomeFile: 'scansione.pdf',
    esito: 'errore', dettaglio: 'PDF_SENZA_TESTO'
  });
  const log = bozze.listaAudit(db, 1);
  assert.equal(log[0].esito, 'errore');
  assert.match(log[0].dettaglio, /SENZA_TESTO/);
  db.close();
});

test('listaAudit mostra prima le voci piu recenti', () => {
  const db = dbVuoto();
  for (const f of ['primo.pdf', 'secondo.pdf', 'terzo.pdf']) {
    bozze.registraAudit(db, { userId: 1, entita: 'piano', nomeFile: f, esito: 'analizzato' });
  }
  const log = bozze.listaAudit(db, 1);
  assert.deepEqual(log.map(l => l.nomeFile), ['terzo.pdf', 'secondo.pdf', 'primo.pdf']);
  db.close();
});
