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

  // file_origine: il nome del PDF da cui la riga e' stata importata l'ultima
  // volta. pezzi/sconto: additive, stessa forma del catalogo clip. Additivo:
  // le righe gia' in tabella restano con queste colonne a NULL, che vuol dire
  // "non si sa" (file_origine) o "non applicabile" (pezzi/sconto), non un errore.
  const colonne = db.prepare(`PRAGMA table_info(analizzatori_mylav)`).all().map(c => c.name);
  if (!colonne.includes('file_origine')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN file_origine TEXT`);
  if (!colonne.includes('pezzi')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN pezzi INTEGER`);
  if (!colonne.includes('sconto')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN sconto REAL`);
}

function daRiga(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nome: row.nome,
    prezzo: row.prezzo,
    noleggio: row.noleggio,
    note: row.note,
    fileOrigine: row.file_origine == null ? null : row.file_origine,
    dataImport: row.data_import
  };
}

// v === '' (campo svuotato in un form) conta come "non lo so", non come zero.
function numeroONull(v) {
  return (v === '' || v == null) ? null : Number(v);
}

function upsertAnalizzatore(db, dati) {
  const { userId, nome, prezzo, noleggio, note, fileOrigine } = dati || {};
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
  const fileOrigineOk = fileOrigine == null ? null : String(fileOrigine);

  // COALESCE su ogni campo tranne l'id: il canone e le note non arrivano mai
  // dal PDF (l'interfaccia dice di scriverli a mano), e un secondo import che
  // porta solo nome e prezzo non deve piu' azzerarli. COALESCE tiene il
  // valore vecchio quando il nuovo e' nullo. Effetto collaterale voluto: da
  // qui non si puo' piu' svuotare un campo passando null. Lo svuotamento
  // resta possibile solo da PUT /api/analizzatori/:id, che scrive con un
  // UPDATE diretto invece di passare da upsertAnalizzatore, perche' e' l'unico
  // punto che sa distinguere "campo assente dalla richiesta" da "campo
  // presente e vuoto" (vedi server.js). file_origine segue la stessa regola:
  // non e' un caso speciale, e' che l'import lo passa sempre, quindi in
  // pratica il PDF piu' recente vince sempre.
  db.prepare(`
    INSERT INTO analizzatori_mylav (user_id, nome, prezzo, noleggio, note, file_origine)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, nome) DO UPDATE SET
      prezzo       = COALESCE(excluded.prezzo, prezzo),
      noleggio     = COALESCE(excluded.noleggio, noleggio),
      note         = COALESCE(excluded.note, note),
      file_origine = COALESCE(excluded.file_origine, file_origine)
  `).run(Number(userId), nomeOk, prezzoOk, noleggioOk, noteOk, fileOrigineOk);

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

// Una riga per PDF di provenienza, piu' una per le righe senza provenienza
// (fileOrigine: null). Stessa logica di gruppiClip (lib/clip.js): GROUP BY
// mette tutti i NULL in un unico gruppo in SQLite, a differenza di UNIQUE.
function gruppiAnalizzatori(db, userId) {
  return db.prepare(`
    SELECT file_origine AS fileOrigine, COUNT(*) AS n, MAX(data_import) AS dataUltimo
    FROM analizzatori_mylav WHERE user_id = ?
    GROUP BY file_origine
    ORDER BY dataUltimo DESC
  `).all(Number(userId));
}

module.exports = {
  ensureSchema, upsertAnalizzatore, listaAnalizzatori, eliminaAnalizzatore, gruppiAnalizzatori
};
