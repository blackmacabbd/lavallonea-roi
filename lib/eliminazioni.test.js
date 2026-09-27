'use strict';
// Cosa cancella «Elimina» in ciascuna delle due sezioni esterne. Ogni sezione
// toglie solo il suo; un laboratorio vuoto in entrambe sparisce da solo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const concorrenti = require('./concorrenti');
const clip = require('./clip');

// Chiavi esterne ATTIVE, come in produzione.
function dbProva() {
  const db = new DatabaseSync(':memory:');
  concorrenti.ensureSchema(db);
  clip.ensureSchema(db);
  return db;
}
const lab = (db, nome, userId = 1) => concorrenti.trovaOCreaConcorrente(db, nome, userId).id;
const esame = (db, cid, nome) => db.prepare(
  'INSERT INTO esami_concorrente (concorrente_id, nome_originale, prezzo) VALUES (?, ?, ?)').run(cid, nome, 10);
const unaClip = (db, cid, nome, file, userId = 1) => clip.upsertClip(db, {
  userId, concorrenteId: cid, nome, prezzoConfezione: 100, pezzi: 10, sconto: null, fonte: 'pdf', fileOrigine: file });
const nClip = (db, cid) => db.prepare('SELECT COUNT(*) AS n FROM clip WHERE concorrente_id IS ?').get(cid).n;
const esiste = (db, cid) => !!db.prepare('SELECT 1 FROM concorrenti WHERE id = ?').get(cid);

test('eliminaGruppoClip toglie solo quel file di quel laboratorio', () => {
  const db = dbProva();
  const a = lab(db, 'IVET'), b = lab(db, 'ivet');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  unaClip(db, b, 'cPL', 'listino.xlsx');   // stesso file, altro laboratorio
  unaClip(db, a, 'cTSH', 'altro.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'listino.xlsx', 1);
  assert.equal(r.eliminate, 1);
  assert.equal(nClip(db, b), 1, 'lo stesso file dell\'altro laboratorio resta');
  assert.equal(nClip(db, a), 1, 'l\'altro listino dello stesso laboratorio resta');
  db.close();
});

test('eliminaGruppoClip toglie il laboratorio se resta vuoto in entrambe le sezioni', () => {
  const db = dbProva();
  const a = lab(db, 'Solo macchinari');
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(esiste(db, a), false);
  db.close();
});

test('eliminaGruppoClip lascia il laboratorio se ha ancora esami', () => {
  const db = dbProva();
  const a = lab(db, 'Esami e macchinari');
  esame(db, a, 'EMOCROMO');
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, false);
  assert.equal(esiste(db, a), true);
  db.close();
});

// In SQL "= NULL" non e' mai vero: senza il ramo IS NULL questa cancellazione
// toglierebbe zero righe dicendo che e' andata bene.
test('eliminaGruppoClip sa eliminare le clip senza laboratorio e senza file', () => {
  const db = dbProva();
  unaClip(db, null, 'vecchia', null);
  const a = lab(db, 'IVET');
  unaClip(db, a, 'nuova', null);
  const r = clip.eliminaGruppoClip(db, null, null, 1);
  assert.equal(r.eliminate, 1);
  assert.equal(nClip(db, a), 1, 'le clip senza file ma con laboratorio restano');
  db.close();
});

test('eliminaEsamiConcorrente toglie solo gli esami: le clip restano', () => {
  const db = dbProva();
  const a = lab(db, 'cdvet');
  esame(db, a, 'EMOCROMO');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  const r = concorrenti.eliminaEsamiConcorrente(db, a, 1);
  assert.deepEqual(r, { trovato: true, eliminati: 1, laboratorioRimosso: false });
  assert.equal(nClip(db, a), 1, 'il listino macchinari resta');
  assert.equal(esiste(db, a), true);
  db.close();
});

test('eliminaEsamiConcorrente toglie il laboratorio se non ha clip', () => {
  const db = dbProva();
  const a = lab(db, 'Solo esami');
  esame(db, a, 'EMOCROMO');
  const r = concorrenti.eliminaEsamiConcorrente(db, a, 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(esiste(db, a), false);
  db.close();
});

test('eliminaEsamiConcorrente non tocca un laboratorio di un altro account', () => {
  const db = dbProva();
  const a = lab(db, 'IVET', 1);
  esame(db, a, 'EMOCROMO');
  assert.deepEqual(concorrenti.eliminaEsamiConcorrente(db, a, 2),
    { trovato: false, eliminati: 0, laboratorioRimosso: false });
  assert.equal(esiste(db, a), true);
  db.close();
});

test('eliminaGruppoClip non tocca le clip di un altro account', () => {
  const db = dbProva();
  const a = lab(db, 'IVET', 1), b = lab(db, 'IVET', 2);
  unaClip(db, a, 'cPL', 'listino.xlsx', 1);
  unaClip(db, b, 'cPL', 'listino.xlsx', 2);
  clip.eliminaGruppoClip(db, b, 'listino.xlsx', 1);   // account sbagliato
  assert.equal(nClip(db, b), 1);
  assert.equal(esiste(db, b), true, 'eliminaSeVuoto non deve toccare il laboratorio di un altro');
  db.close();
});

// Le vecchie tabelle dei macchinari non le legge piu' nessuno: un laboratorio
// che ha solo righe li' e' vuoto, e sparendo se le porta via (hanno una chiave
// esterna verso di lui, quindi vanno tolte PRIMA della sua riga).
test('le vecchie tabelle dei macchinari non contano e se ne vanno col laboratorio', () => {
  const db = dbProva();
  db.exec(`
    CREATE TABLE listini_macchine (id INTEGER PRIMARY KEY, concorrente_id INTEGER REFERENCES concorrenti(id));
    CREATE TABLE macchine (id INTEGER PRIMARY KEY, listino_id INTEGER REFERENCES listini_macchine(id));
  `);
  const a = lab(db, 'Vecchio');
  const l = db.prepare('INSERT INTO listini_macchine (concorrente_id) VALUES (?)').run(a).lastInsertRowid;
  db.prepare('INSERT INTO macchine (listino_id) VALUES (?)').run(l);
  unaClip(db, a, 'cPL', 'unico.pdf');
  const r = clip.eliminaGruppoClip(db, a, 'unico.pdf', 1);
  assert.equal(r.laboratorioRimosso, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listini_macchine').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM macchine').get().n, 0);
  db.close();
});

test('gruppiClip raggruppa per laboratorio e file', () => {
  const db = dbProva();
  const a = lab(db, 'IVET'), b = lab(db, 'ivet');
  unaClip(db, a, 'cPL', 'listino.xlsx');
  unaClip(db, a, 'cTSH', 'listino.xlsx');
  unaClip(db, b, 'cPL', 'listino.xlsx');
  const g = clip.gruppiClip(db, 1);
  assert.equal(g.length, 2, 'stesso file, due laboratori: due listini');
  assert.equal(g.find(x => x.concorrenteId === a).n, 2);
  assert.equal(g.find(x => x.concorrenteId === b).n, 1);
  db.close();
});
