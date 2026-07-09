'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

// Regressione: la tabella "strutture" NON deve avere un vincolo UNIQUE globale
// su "nome". Prima della fix, "nome TEXT UNIQUE NOT NULL" faceva fallire con
// "UNIQUE constraint failed: strutture.nome" (500) il secondo utente che
// salvava una struttura con lo stesso nome del primo, anche su DB nuovo.
// L'unicita' va garantita a livello applicativo per utente (WHERE nome=? AND
// user_id=?), non con un vincolo globale.
function dbVuoto() {
  return new DatabaseSync(':memory:');
}

// Stesso DDL usato in server.js dopo la fix.
const STRUTTURE_DDL = `
  CREATE TABLE strutture (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nome    TEXT NOT NULL,
    user_id INTEGER
  );
`;

test('strutture: due utenti diversi possono salvare lo stesso nome senza collisione UNIQUE', () => {
  const db = dbVuoto();
  db.exec(STRUTTURE_DDL);

  const ins = db.prepare('INSERT INTO strutture (nome, user_id) VALUES (?, ?)');

  assert.doesNotThrow(() => ins.run('Clinica Veterinaria Roma', 1));
  assert.doesNotThrow(() => ins.run('Clinica Veterinaria Roma', 2));

  const count = db.prepare('SELECT COUNT(*) c FROM strutture').get().c;
  assert.equal(count, 2);

  const perUtente1 = db.prepare('SELECT * FROM strutture WHERE user_id = ?').all(1);
  const perUtente2 = db.prepare('SELECT * FROM strutture WHERE user_id = ?').all(2);
  assert.equal(perUtente1.length, 1);
  assert.equal(perUtente2.length, 1);
  assert.equal(perUtente1[0].nome, 'Clinica Veterinaria Roma');
  assert.equal(perUtente2[0].nome, 'Clinica Veterinaria Roma');

  db.close();
});

test('strutture: nessun indice UNIQUE su nome nello schema corrente', () => {
  const db = dbVuoto();
  db.exec(STRUTTURE_DDL);

  const indici = db.prepare(`PRAGMA index_list('strutture')`).all();
  const haUniqueSuNome = indici.some(idx => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
    return cols.length === 1 && cols[0].name === 'nome';
  });
  assert.equal(haUniqueSuNome, false);

  db.close();
});
