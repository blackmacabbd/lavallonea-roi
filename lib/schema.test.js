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

// Regressione: righe_calcolo_clip.laboratorio (fetta 6, colonna laboratorio
// nel calcolatore macchinari) deve arrivare con la stessa migrazione additiva
// usata nel resto del progetto (addColIfMissing, vedi server.js): su un DB
// gia' popolato con lo schema precedente (senza la colonna) l'ALTER TABLE non
// deve toccare le righe gia' salvate, deve essere idempotente, e le righe
// nuove devono poter portare il proprio laboratorio.
const CALCOLI_CLIP_DDL_PRE_LABORATORIO = `
  CREATE TABLE calcoli_clip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    struttura_nome TEXT,
    nome_file TEXT,
    piano_id INTEGER,
    data DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE righe_calcolo_clip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calcolo_id INTEGER NOT NULL REFERENCES calcoli_clip(id),
    clip_nome TEXT, n_clip INTEGER,
    prezzo_confezione REAL, pezzi INTEGER, sconto_clip REAL,
    costo_clip REAL, totale_clip REAL,
    profilo_mylav TEXT, n_mylav INTEGER,
    listino_lav REAL, prezzo_scontato_lav REAL, totale_mylav REAL,
    risparmio REAL
  );
`;

// Stessa funzione di server.js, replicata qui perche' server.js non e' un
// modulo require-abile (avvia l'app): la logica e' due righe, e testarla qui
// e' l'unico modo di provarla senza avviare l'intero server.
function addColIfMissing(db, table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

test('righe_calcolo_clip: la colonna laboratorio si aggiunge in modo additivo', () => {
  const db = dbVuoto();
  db.exec(CALCOLI_CLIP_DDL_PRE_LABORATORIO);

  db.prepare('INSERT INTO calcoli_clip (id, user_id, struttura_nome) VALUES (1, 1, ?)').run('Clinica Vecchia');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip) VALUES (1, ?, 1)').run('Chem10 12');

  addColIfMissing(db, 'righe_calcolo_clip', 'laboratorio', 'TEXT');
  // Idempotente: una seconda chiamata (come al riavvio del server) non deve
  // fallire ne' duplicare la colonna.
  assert.doesNotThrow(() => addColIfMissing(db, 'righe_calcolo_clip', 'laboratorio', 'TEXT'));

  const cols = db.prepare(`PRAGMA table_info(righe_calcolo_clip)`).all().map(c => c.name);
  assert.ok(cols.includes('laboratorio'));
  assert.equal(cols.filter(c => c === 'laboratorio').length, 1);

  // La riga salvata prima della migrazione resta intatta, solo con
  // laboratorio NULL: nessuna migrazione a ritroso, nessun dato perso.
  const vecchia = db.prepare('SELECT clip_nome, n_clip, laboratorio FROM righe_calcolo_clip WHERE calcolo_id = 1').get();
  assert.equal(vecchia.clip_nome, 'Chem10 12');
  assert.equal(vecchia.n_clip, 1);
  assert.equal(vecchia.laboratorio, null);

  // Una riga nuova puo' portare il proprio laboratorio, per riga: due righe
  // dello stesso calcolo con due laboratori diversi sono il caso normale che
  // questa colonna serve a rendere possibile.
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, laboratorio) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'Idexx');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, laboratorio) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'Zoetis');

  const righe = db.prepare('SELECT laboratorio FROM righe_calcolo_clip WHERE calcolo_id = 1 ORDER BY id').all();
  assert.deepEqual(righe.map(r => r.laboratorio), [null, 'Idexx', 'Zoetis']);

  db.close();
});

// Regressione: righe_calcolo_clip.listino_mylav (fetta 4 del piano
// 2026-09-22-listini-per-pdf.md, colonna "Listino Mylav" a specchio di
// laboratorio ma sul lato blu) deve arrivare con la stessa migrazione
// additiva. Stessa prova di quella sopra, sull'asse Mylav invece che
// laboratorio: nessuna riga persa, idempotente, per riga e non per calcolo.
test('righe_calcolo_clip: la colonna listino_mylav si aggiunge in modo additivo', () => {
  const db = dbVuoto();
  db.exec(CALCOLI_CLIP_DDL_PRE_LABORATORIO);
  addColIfMissing(db, 'righe_calcolo_clip', 'laboratorio', 'TEXT');

  db.prepare('INSERT INTO calcoli_clip (id, user_id, struttura_nome) VALUES (1, 1, ?)').run('Clinica Vecchia');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip) VALUES (1, ?, 1)').run('Chem10 12');

  addColIfMissing(db, 'righe_calcolo_clip', 'listino_mylav', 'TEXT');
  assert.doesNotThrow(() => addColIfMissing(db, 'righe_calcolo_clip', 'listino_mylav', 'TEXT'));

  const cols = db.prepare(`PRAGMA table_info(righe_calcolo_clip)`).all().map(c => c.name);
  assert.ok(cols.includes('listino_mylav'));
  assert.equal(cols.filter(c => c === 'listino_mylav').length, 1);

  // La riga salvata prima della migrazione resta intatta, solo con
  // listino_mylav NULL.
  const vecchia = db.prepare('SELECT clip_nome, n_clip, listino_mylav FROM righe_calcolo_clip WHERE calcolo_id = 1').get();
  assert.equal(vecchia.clip_nome, 'Chem10 12');
  assert.equal(vecchia.listino_mylav, null);

  // Due righe dello stesso calcolo possono pescare da due listini Mylav
  // diversi: il caso normale che questa colonna serve a rendere possibile.
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, listino_mylav) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'mylav-2026.pdf');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, listino_mylav) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'mylav-2027.pdf');

  const righe = db.prepare('SELECT listino_mylav FROM righe_calcolo_clip WHERE calcolo_id = 1 ORDER BY id').all();
  assert.deepEqual(righe.map(r => r.listino_mylav), [null, 'mylav-2026.pdf', 'mylav-2027.pdf']);

  db.close();
});

// Regressione: righe_calcolo_clip.listino_conc (task 5, colonna «Listino
// conc.» accanto al laboratorio) deve arrivare con la stessa migrazione
// additiva delle due colonne sopra. Stessa prova, sull'asse del listino del
// concorrente invece che Mylav.
test('righe_calcolo_clip: la colonna listino_conc si aggiunge in modo additivo', () => {
  const db = dbVuoto();
  db.exec(CALCOLI_CLIP_DDL_PRE_LABORATORIO);
  addColIfMissing(db, 'righe_calcolo_clip', 'laboratorio', 'TEXT');
  addColIfMissing(db, 'righe_calcolo_clip', 'listino_mylav', 'TEXT');

  db.prepare('INSERT INTO calcoli_clip (id, user_id, struttura_nome) VALUES (1, 1, ?)').run('Clinica Vecchia');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip) VALUES (1, ?, 1)').run('Chem10 12');

  addColIfMissing(db, 'righe_calcolo_clip', 'listino_conc', 'TEXT');
  assert.doesNotThrow(() => addColIfMissing(db, 'righe_calcolo_clip', 'listino_conc', 'TEXT'));

  const cols = db.prepare(`PRAGMA table_info(righe_calcolo_clip)`).all().map(c => c.name);
  assert.ok(cols.includes('listino_conc'));
  assert.equal(cols.filter(c => c === 'listino_conc').length, 1);

  // La riga salvata prima della migrazione resta intatta, solo con
  // listino_conc NULL.
  const vecchia = db.prepare('SELECT clip_nome, n_clip, listino_conc FROM righe_calcolo_clip WHERE calcolo_id = 1').get();
  assert.equal(vecchia.clip_nome, 'Chem10 12');
  assert.equal(vecchia.listino_conc, null);

  // Due righe dello stesso calcolo possono confrontare due listini del
  // concorrente diversi: il caso normale che questa colonna serve a rendere
  // possibile.
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, listino_conc) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'idexx-2026.pdf');
  db.prepare('INSERT INTO righe_calcolo_clip (calcolo_id, clip_nome, n_clip, listino_conc) VALUES (1, ?, 1, ?)')
    .run('Chem10 12', 'idexx-2027.pdf');

  const righe = db.prepare('SELECT listino_conc FROM righe_calcolo_clip WHERE calcolo_id = 1 ORDER BY id').all();
  assert.deepEqual(righe.map(r => r.listino_conc), [null, 'idexx-2026.pdf', 'idexx-2027.pdf']);

  db.close();
});
