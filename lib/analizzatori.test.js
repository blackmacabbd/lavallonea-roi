'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const an = require('./analizzatori');

function dbProva() { const db = new DatabaseSync(':memory:'); an.ensureSchema(db); return db; }

test('upsertAnalizzatore salva e rilegge', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000, noleggio: 250 });
  assert.ok(id > 0);
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 12000);
  assert.equal(righe[0].noleggio, 250);
  db.close();
});

// Un analizzatore puo' essere solo venduto o solo noleggiato: entrambi i campi
// sono facoltativi, e "non previsto" non e' la stessa cosa di "costa zero".
test('prezzo e noleggio sono facoltativi e restano distinti da zero', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Solo noleggio', prezzo: null, noleggio: 180 });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.prezzo, null);
  assert.equal(r.noleggio, 180);
  db.close();
});

test('reimportare lo stesso nome aggiorna invece di duplicare', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500 });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 11500);
  db.close();
});

test('gli analizzatori sono isolati per account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'A', prezzo: 2 });
  assert.equal(an.listaAnalizzatori(db, 1).length, 1);
  assert.equal(an.listaAnalizzatori(db, 1)[0].prezzo, 1);
  db.close();
});

test('eliminaAnalizzatore tocca solo il proprio account', () => {
  const db = dbProva();
  const { id } = an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.eliminaAnalizzatore(db, id, 2);
  assert.equal(an.listaAnalizzatori(db, 1).length, 1, 'un altro account non puo cancellarlo');
  an.eliminaAnalizzatore(db, id, 1);
  assert.equal(an.listaAnalizzatori(db, 1).length, 0);
  db.close();
});

test('upsertAnalizzatore salva il file di provenienza e lo rilegge', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000,
    fileOrigine: 'mylav.pdf' });
  assert.equal(an.listaAnalizzatori(db, 1)[0].fileOrigine, 'mylav.pdf');
  db.close();
});

// Le righe entrate prima che si tenesse traccia del file non spariscono e non
// vengono attribuite a nessun PDF: restano in un gruppo loro.
test('gruppiAnalizzatori raccoglie le righe senza provenienza sotto null', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Vecchia', prezzo: 10 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Nuova', prezzo: 20,
    fileOrigine: 'mylav.pdf' });
  const g = an.gruppiAnalizzatori(db, 1);
  assert.equal(g.length, 2);
  const senza = g.find(x => x.fileOrigine == null);
  assert.ok(senza, 'il gruppo senza provenienza esiste');
  assert.equal(senza.n, 1);
  assert.equal(g.find(x => x.fileOrigine === 'mylav.pdf').n, 1);
  db.close();
});

// pezzi e sconto seguono la stessa forma di lib/clip.js: facoltativi, e il
// costo per clip si calcola da questi due piu' il prezzo (vedi public/app.js).
test('upsertAnalizzatore salva pezzi e sconto e li rilegge', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzo: 448.5, pezzi: 12, sconto: 5 });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.pezzi, 12);
  assert.equal(r.sconto, 5);
  db.close();
});

test('pezzi e sconto sono facoltativi e restano distinti da zero', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Senza pezzi', prezzo: 100 });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.pezzi, null);
  assert.equal(r.sconto, null);
  db.close();
});

// Stesso difetto scoperto per canone/note: un reimport dello STESSO file non
// deve cancellare pezzi e sconto completati a mano nel frattempo. Da task 5
// in poi un file DIVERSO (un altro listino) non e' piu' un reimport dello
// stesso: affianca la riga invece di toccarla, quindi qui il completamento a
// mano usa lo stesso file_origine della riga che sta completando (come farebbe
// PUT /api/analizzatori/:id, che scrive per id, non per nome).
test('reimportare non cancella i pezzi e lo sconto completati a mano', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzo: 448.5,
    fileOrigine: 'listino-A.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzo: 448.5,
    fileOrigine: 'listino-A.pdf', pezzi: 12, sconto: 5 });
  // Il listino 2027 e' un file diverso: da task 5 in poi affianca il 2026
  // invece di sovrascriverlo.
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17 CLIP 12', prezzo: 460,
    fileOrigine: 'listino-A-2027.pdf' });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 2, 'i due listini restano due righe distinte');
  const vecchia = righe.find(r => r.fileOrigine === 'listino-A.pdf');
  assert.equal(vecchia.prezzo, 448.5);
  assert.equal(vecchia.pezzi, 12, 'i pezzi completati a mano restano sulla riga del 2026');
  assert.equal(vecchia.sconto, 5, 'lo sconto completato a mano resta sulla riga del 2026');
  assert.equal(righe.find(r => r.fileOrigine === 'listino-A-2027.pdf').prezzo, 460,
    'il listino nuovo porta il suo prezzo');
  db.close();
});

// listaAnalizzatori(db, userId, fileOrigine): il terzo argomento filtra per
// PDF di provenienza, null incluso per il gruppo senza provenienza. Senza
// terzo argomento il comportamento resta quello di sempre (tutte le righe).
test('listaAnalizzatori filtra per file di provenienza', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1, fileOrigine: 'x.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'B', prezzo: 2, fileOrigine: 'y.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'C', prezzo: 3 });
  assert.equal(an.listaAnalizzatori(db, 1).length, 3, 'senza filtro tornano tutte');
  assert.deepEqual(an.listaAnalizzatori(db, 1, 'x.pdf').map(r => r.nome), ['A']);
  assert.deepEqual(an.listaAnalizzatori(db, 1, null).map(r => r.nome), ['C'],
    'fileOrigine null isola le righe senza provenienza');
  db.close();
});

test('i gruppi sono isolati per account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1, fileOrigine: 'x.pdf' });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'B', prezzo: 1, fileOrigine: 'y.pdf' });
  assert.equal(an.gruppiAnalizzatori(db, 1).length, 1);
  assert.equal(an.gruppiAnalizzatori(db, 1)[0].fileOrigine, 'x.pdf');
  db.close();
});

// Il canone e le note non arrivano dal PDF: l'interfaccia dice di scriverli a
// mano. Un reimport dello STESSO file NON deve azzerarli. Da task 5 in poi un
// file diverso (un altro listino) affianca la riga invece di sovrascriverla,
// quindi il completamento a mano qui usa lo stesso file_origine della riga
// che sta completando (come farebbe PUT /api/analizzatori/:id).
test('reimportare non cancella il canone e le note scritti a mano', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000,
    fileOrigine: 'mylav.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000,
    fileOrigine: 'mylav.pdf', noleggio: 250, note: 'consegna in due settimane' });
  // Il PDF nuovo e' un listino diverso (2027): affianca il primo, non lo
  // sovrascrive.
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500,
    fileOrigine: 'mylav-2027.pdf' });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 2, 'i due listini restano due righe distinte');
  const vecchia = righe.find(r => r.fileOrigine === 'mylav.pdf');
  assert.equal(vecchia.noleggio, 250, 'il canone scritto a mano resta sulla riga vecchia');
  assert.equal(vecchia.note, 'consegna in due settimane', 'le note restano sulla riga vecchia');
  assert.equal(righe.find(r => r.fileOrigine === 'mylav-2027.pdf').prezzo, 11500,
    'il listino nuovo porta il suo prezzo');
  db.close();
});

// eliminaGruppoAnalizzatori: l'unica via per ripulire un listino sbagliato
// senza eliminare riga per riga, con conferma che dice quante righe se ne vanno.
test('eliminaGruppoAnalizzatori toglie solo le righe di quel PDF', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1, fileOrigine: 'uno.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'B', prezzo: 1, fileOrigine: 'due.pdf' });
  const r = an.eliminaGruppoAnalizzatori(db, 'uno.pdf', 1);
  assert.equal(r.eliminate, 1);
  assert.deepEqual(an.listaAnalizzatori(db, 1).map(x => x.nome), ['B']);
  db.close();
});

// Il gruppo senza provenienza si elimina come gli altri: e' l'unica via per
// ripulire cio' che e' entrato prima che si tenesse traccia del file.
test('eliminaGruppoAnalizzatori sa eliminare il gruppo senza provenienza', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'B', prezzo: 1, fileOrigine: 'due.pdf' });
  assert.equal(an.eliminaGruppoAnalizzatori(db, null, 1).eliminate, 1);
  assert.deepEqual(an.listaAnalizzatori(db, 1).map(x => x.nome), ['B']);
  db.close();
});

test('eliminaGruppoAnalizzatori non tocca gli altri account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1, fileOrigine: 'uno.pdf' });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'A', prezzo: 1, fileOrigine: 'uno.pdf' });
  assert.equal(an.eliminaGruppoAnalizzatori(db, 'uno.pdf', 1).eliminate, 1);
  assert.equal(an.listaAnalizzatori(db, 2).length, 1, 'l\'altro account non si tocca');
  db.close();
});

// ── L'unicita' passa da (user_id, nome) a (user_id, nome, file_origine) ──
// Una voce puo' stare in due listini diversi (task 5): importare il 2026 e
// poi il 2027 non deve piu' far sparire la voce del 2026.
test('la stessa voce puo stare in due listini diversi', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 448.50,
    fileOrigine: 'mylav-2026.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 500,
    fileOrigine: 'mylav-2027.pdf' });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 2, 'le due righe convivono');
  assert.equal(righe.find(r => r.fileOrigine === 'mylav-2026.pdf').prezzo, 448.50,
    'il listino vecchio conserva il suo prezzo');
  assert.equal(righe.find(r => r.fileOrigine === 'mylav-2027.pdf').prezzo, 500);
  db.close();
});

test('reimportare lo STESSO listino aggiorna invece di duplicare', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 448.50,
    fileOrigine: 'mylav-2026.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 460,
    fileOrigine: 'mylav-2026.pdf' });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].prezzo, 460);
  db.close();
});

// Le righe entrate prima che si tenesse traccia del file hanno file_origine
// nullo, e in SQLite due NULL sono DISTINTI dentro un UNIQUE: senza indice
// parziale nascerebbero doppioni proprio li' dove non c'e' un PDF a
// distinguerli.
test('senza provenienza lo stesso nome resta una riga sola', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 448.50 });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 460 });
  const righe = an.listaAnalizzatori(db, 1);
  assert.equal(righe.length, 1, 'niente doppioni nel gruppo senza provenienza');
  assert.equal(righe[0].prezzo, 460);
  db.close();
});

test('la migrazione non perde righe ne cambia gli id', () => {
  const db = new DatabaseSync(':memory:');
  // La tabella com'e' adesso, con l'unicita' vecchia.
  db.exec(`
    CREATE TABLE analizzatori_mylav (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      nome        TEXT NOT NULL,
      prezzo      REAL, noleggio REAL, note TEXT,
      data_import DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_origine TEXT, pezzi INTEGER, sconto REAL,
      UNIQUE(user_id, nome)
    );
  `);
  const r = db.prepare('INSERT INTO analizzatori_mylav (user_id, nome, prezzo) VALUES (?, ?, ?)')
    .run(1, 'Chem 17', 448.50);
  an.ensureSchema(db);
  const righe = db.prepare('SELECT id, nome, prezzo FROM analizzatori_mylav').all();
  assert.equal(righe.length, 1);
  assert.equal(righe[0].id, Number(r.lastInsertRowid), 'gli id non cambiano');
  assert.equal(righe[0].prezzo, 448.50);
  // E ora la voce omonima di un altro listino ci sta.
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Chem 17', prezzo: 500,
    fileOrigine: 'altro.pdf' });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM analizzatori_mylav').get().c, 2);
  db.close();
});
