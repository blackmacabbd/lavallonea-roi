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

test('i gruppi sono isolati per account', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'A', prezzo: 1, fileOrigine: 'x.pdf' });
  an.upsertAnalizzatore(db, { userId: 2, nome: 'B', prezzo: 1, fileOrigine: 'y.pdf' });
  assert.equal(an.gruppiAnalizzatori(db, 1).length, 1);
  assert.equal(an.gruppiAnalizzatori(db, 1)[0].fileOrigine, 'x.pdf');
  db.close();
});

// Il canone e le note non arrivano dal PDF: l'interfaccia dice di scriverli a
// mano. Un secondo import NON deve azzerarli.
test('reimportare non cancella il canone e le note scritti a mano', () => {
  const db = dbProva();
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 12000,
    fileOrigine: 'mylav.pdf' });
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', noleggio: 250,
    note: 'consegna in due settimane' });
  // Il PDF nuovo porta solo nome e prezzo, come fa l'import vero.
  an.upsertAnalizzatore(db, { userId: 1, nome: 'Catalyst One', prezzo: 11500,
    fileOrigine: 'mylav-2027.pdf' });
  const r = an.listaAnalizzatori(db, 1)[0];
  assert.equal(r.prezzo, 11500, 'il prezzo si aggiorna');
  assert.equal(r.noleggio, 250, 'il canone scritto a mano resta');
  assert.equal(r.note, 'consegna in due settimane', 'le note restano');
  db.close();
});
