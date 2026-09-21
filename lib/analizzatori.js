'use strict';
// Catalogo macchinari interni: gli analizzatori che Mylav vende o noleggia.
//
// E' un catalogo, non un calcolatore: non entra in nessun confronto di prezzo.
// Nel calcolatore macchinari il lato Mylav e' il piano di scontistica sugli
// esami, la vendita o il noleggio di un analizzatore e' una trattativa a se'.
//
// Un analizzatore puo' essere solo venduto, solo noleggiato, o entrambi:
// prezzo e noleggio sono colonne indipendenti e facoltative. null vuol dire
// "non previsto", 0 vuol dire "gratis": sono due fatti diversi e la
// conversione riga->oggetto non deve confonderli.
//
// Stesso stile del resto del catalogo: snake_case nel database, camelCase in
// uscita, ogni lettura e ogni scrittura filtrate per user_id.

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analizzatori_mylav (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      nome        TEXT NOT NULL,
      prezzo      REAL,
      noleggio    REAL,
      note        TEXT,
      data_import DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, nome)
    );
  `);
}

function daRiga(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nome: row.nome,
    prezzo: row.prezzo == null ? null : row.prezzo,
    noleggio: row.noleggio == null ? null : row.noleggio,
    note: row.note == null ? null : row.note,
    dataImport: row.data_import
  };
}

// v === '' (campo svuotato in un form) conta come "non lo so", non come zero.
function numeroONull(v) {
  return (v === '' || v == null) ? null : Number(v);
}

function upsertAnalizzatore(db, dati) {
  const { userId, nome, prezzo, noleggio, note } = dati || {};
  if (userId == null) throw new Error('userId mancante');

  const nomeOk = String(nome == null ? '' : nome).trim();
  if (!nomeOk) {
    const err = new Error('Nome mancante');
    err.codice = 'NOME_NON_VALIDO';
    throw err;
  }
  const prezzoOk = numeroONull(prezzo);
  const noleggioOk = numeroONull(noleggio);
  const noteOk = note == null || note === '' ? null : String(note);

  db.prepare(`
    INSERT INTO analizzatori_mylav (user_id, nome, prezzo, noleggio, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, nome) DO UPDATE SET
      prezzo   = excluded.prezzo,
      noleggio = excluded.noleggio,
      note     = excluded.note
  `).run(Number(userId), nomeOk, prezzoOk, noleggioOk, noteOk);

  // ON CONFLICT DO UPDATE non aggiorna lastInsertRowid quando prende la strada
  // dell'update: si rilegge l'id dalla chiave univoca (user_id, nome).
  const row = db.prepare(`SELECT id FROM analizzatori_mylav WHERE user_id = ? AND nome = ?`)
    .get(Number(userId), nomeOk);
  return { id: row.id };
}

function listaAnalizzatori(db, userId) {
  return db.prepare(`SELECT * FROM analizzatori_mylav WHERE user_id = ? ORDER BY nome`)
    .all(Number(userId)).map(daRiga);
}

// Elimina un analizzatore del proprio account. Ritorna true se esisteva ed e'
// stato rimosso, false se non esisteva o apparteneva a un altro account
// (stesso comportamento di eliminaClip/eliminaConcorrente: nessuna riga
// toccata, nessun errore).
function eliminaAnalizzatore(db, id, userId) {
  const info = db.prepare(`DELETE FROM analizzatori_mylav WHERE id = ? AND user_id = ?`)
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = { ensureSchema, upsertAnalizzatore, listaAnalizzatori, eliminaAnalizzatore };
