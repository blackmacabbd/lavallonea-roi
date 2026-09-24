#!/usr/bin/env node
'use strict';

// Stampa un codice di reset password valido 30 minuti, senza passare dalla
// posta.
//
// PERCHE' ESISTE. L'unico modo di reimpostare una password era un codice
// spedito via email. Quando la consegna si rompe — chiave del provider
// scaduta, mittente non piu' verificato — il proprietario resta chiuso fuori
// dal proprio account e l'applicazione non glielo dice nemmeno: la rotta
// risponde sempre "ok" per non rivelare quali email siano registrate, e
// l'errore di invio viene inghiottito. E' successo davvero.
//
// PERCHE' NON INDEBOLISCE NIENTE. Questo script gira solo dentro il server,
// dove si ha gia' accesso diretto al database: chi puo' lanciarlo puo' gia'
// leggere e cambiare qualunque cosa. Non aggiunge un potere, aggiunge un modo
// di usarlo che non dipende da un servizio esterno.
//
// USO (dalla shell del contenitore, o come comando una tantum su Railway):
//
//   node tools/codice-reset.js utente@esempio.it
//
// Poi, dal sito: «Password dimenticata?» -> email, codice, nuova password.
// Il codice vale 30 minuti e una volta sola, esattamente come quello che
// sarebbe arrivato per email: qui cambia solo il mezzo con cui lo si legge.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const auth = require('../lib/auth');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Uso: node tools/codice-reset.js <email>');
  process.exit(1);
}

// Stesso percorso del server: se DB_PATH non e' impostato si ripiega sul file
// dentro il contenitore, che a ogni deploy riparte vuoto. Lo stampiamo apposta:
// se il percorso non e' quello del volume, e' quella la vera anomalia da
// sistemare, non la password.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'database.sqlite');
console.log('Database letto:', DB_PATH);

const db = new DatabaseSync(DB_PATH);
try {
  const u = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  if (!u) {
    const quanti = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    console.error(`\nNessun account con l'email "${email}".`);
    console.error(`Account presenti in questo database: ${quanti}.`);
    if (quanti === 0) {
      console.error('\nIl database e VUOTO: non e quello vero. Quasi certamente DB_PATH non');
      console.error('punta al volume, e il server sta usando un file che riparte da zero a');
      console.error('ogni deploy. I dati non sono persi: e il server a guardare nel posto');
      console.error('sbagliato. Sistemare DB_PATH prima di qualunque altra cosa.');
    } else {
      console.error('\nEmail presenti:');
      for (const r of db.prepare('SELECT email FROM users ORDER BY id').all()) {
        console.error('  -', r.email);
      }
    }
    process.exit(2);
  }

  const code = auth.genResetCode();
  db.prepare('INSERT INTO reset_codes (user_id, code, expires_at) VALUES (?, ?, ?)')
    .run(u.id, code, Date.now() + 30 * 60 * 1000);

  console.log(`\nAccount: ${u.email}`);
  console.log(`Codice di reset: ${code}`);
  console.log('\nValido 30 minuti e una volta sola.');
  console.log('Usalo dal sito: «Password dimenticata?» -> email, codice, nuova password.');
} finally {
  db.close();
}
