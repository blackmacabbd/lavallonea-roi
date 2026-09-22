'use strict';
// Catalogo macchinari interni: gli analizzatori che Mylav vende o noleggia.
//
// Vendita e noleggio (prezzo/noleggio) restano una trattativa a se', fuori da
// ogni confronto di prezzo. Le clip Mylav (nome/prezzo/pezzi/sconto/file_origine),
// pero', SONO il lato blu del calcolatore macchinari: la colonna "Listino
// Mylav" (public/app.js, docs/superpowers/plans/2026-09-22-listini-per-pdf.md,
// fetta 4) filtra proprio questa tabella per file_origine, con la stessa
// formula costo-per-unita' della clip concorrente.
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
      data_import DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // file_origine: il nome del PDF da cui la riga e' stata importata l'ultima
  // volta. pezzi/sconto: additive, stessa forma del catalogo clip. Additivo:
  // le righe gia' in tabella restano con queste colonne a NULL, che vuol dire
  // "non si sa" (file_origine) o "non applicabile" (pezzi/sconto), non un errore.
  // Vanno aggiunte PRIMA della migrazione qui sotto: la ricostruzione le
  // ricopia, e devono gia' esistere sulla tabella vecchia per poterlo fare.
  const colonne = db.prepare(`PRAGMA table_info(analizzatori_mylav)`).all().map(c => c.name);
  if (!colonne.includes('file_origine')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN file_origine TEXT`);
  if (!colonne.includes('pezzi')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN pezzi INTEGER`);
  if (!colonne.includes('sconto')) db.exec(`ALTER TABLE analizzatori_mylav ADD COLUMN sconto REAL`);

  // L'unicita' passa da (user_id, nome) a (user_id, nome, file_origine): una
  // voce puo' stare in due listini diversi (2026 e 2027), e importare il
  // secondo non deve piu' far sparire la voce del primo. Il vincolo vecchio
  // era scritto dentro la CREATE TABLE (non un indice a parte, come invece e'
  // gia' concorrente_id in lib/clip.js), quindi rimuoverlo richiede
  // ricostruire la tabella. Il riconoscimento e' sul testo esatto in
  // sqlite_master, e la ricostruzione gira solo se serve davvero.
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='analizzatori_mylav'`).get();
  const daRicostruire = sql && /UNIQUE\s*\(\s*user_id\s*,\s*nome\s*\)/i.test(sql.sql);

  // La ricostruzione (se serve) e la creazione dei due indici parziali vanno
  // nella STESSA transazione. Prima stavano separate: la ricostruzione
  // committava da sola e gli indici si creavano dopo, fuori da qualunque
  // transazione. Un guasto proprio li' in mezzo (un lock, il disco pieno, un
  // interrupt all'avvio) lascerebbe la tabella ricostruita ma SENZA alcuna
  // unicita': il prossimo import duplicherebbe ogni riga in silenzio. Con
  // tutto dentro un solo BEGIN/COMMIT, un fallimento in qualunque punto fa
  // ROLLBACK dell'intera sequenza, mai uno stato a meta'.
  //
  // In node:sqlite le chiavi esterne sono ATTIVE di default, a differenza
  // della riga di comando sqlite3. PRAGMA foreign_keys non e' transazionale
  // e dentro una transazione non fa niente: va spento PRIMA del BEGIN e
  // riacceso in un finally, altrimenti un errore lascerebbe la sessione
  // senza controllo delle chiavi esterne per tutto il resto del processo.
  // Il toggle serve solo quando si ricostruisce davvero: creare gli indici
  // da soli non tocca le chiavi esterne.
  const fkEraAttivo = daRicostruire && db.prepare(`PRAGMA foreign_keys`).get().foreign_keys === 1;
  if (fkEraAttivo) db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    if (daRicostruire) {
      db.exec(`
        CREATE TABLE analizzatori_nuova (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          nome        TEXT NOT NULL,
          prezzo      REAL,
          noleggio    REAL,
          note        TEXT,
          data_import DATETIME DEFAULT CURRENT_TIMESTAMP,
          file_origine TEXT,
          pezzi       INTEGER,
          sconto      REAL
        );
        INSERT INTO analizzatori_nuova
          (id, user_id, nome, prezzo, noleggio, note, data_import, file_origine, pezzi, sconto)
          SELECT id, user_id, nome, prezzo, noleggio, note, data_import, file_origine, pezzi, sconto
          FROM analizzatori_mylav;
        DROP TABLE analizzatori_mylav;
        ALTER TABLE analizzatori_nuova RENAME TO analizzatori_mylav;
      `);
      // DROP TABLE porta via anche la riga di sqlite_sequence della tabella
      // vecchia: senza ripristinarla il contatore AUTOINCREMENT ripartirebbe
      // da MAX(id), e id gia' usati e poi liberati (righe cancellate)
      // potrebbero essere riassegnati. Oggi nulla ha una chiave esterna verso
      // analizzatori_mylav, quindi non romperebbe riferimenti, ma il contratto
      // dichiarato della migrazione e' che gli id non cambiano ne' si
      // riusano: si ripristina il contatore al MAX(id) reale della tabella
      // appena ricostruita (solo se non e' vuota: una tabella vuota non ha
      // bisogno di una riga in sqlite_sequence).
      db.exec(`DELETE FROM sqlite_sequence WHERE name = 'analizzatori_mylav'`);
      db.exec(`
        INSERT INTO sqlite_sequence (name, seq)
          SELECT 'analizzatori_mylav', MAX(id) FROM analizzatori_mylav
          WHERE EXISTS (SELECT 1 FROM analizzatori_mylav)
      `);
    }

    // L'unicita' nuova sta in due indici parziali, per la stessa ragione
    // gia' incontrata su clip/concorrenti: in SQLite due NULL sono distinti
    // dentro un UNIQUE, quindi UNIQUE(user_id, nome, file_origine) non
    // impedirebbe due righe omonime nel gruppo senza provenienza, che e'
    // proprio dove non c'e' un PDF a distinguerle. Gli indici si creano DOPO
    // l'eventuale ricostruzione (dentro lo stesso BEGIN): il DROP TABLE porta
    // via quelli della tabella vecchia.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS analiz_per_listino
        ON analizzatori_mylav(user_id, nome, file_origine) WHERE file_origine IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS analiz_senza_listino
        ON analizzatori_mylav(user_id, nome) WHERE file_origine IS NULL;
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    if (fkEraAttivo) db.exec('PRAGMA foreign_keys = ON');
  }
}

function daRiga(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nome: row.nome,
    prezzo: row.prezzo,
    pezzi: row.pezzi,
    sconto: row.sconto,
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
  const { userId, nome, prezzo, noleggio, note, fileOrigine, pezzi, sconto } = dati || {};
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
  // Stessa forma del catalogo clip (lib/clip.js): il prezzo e' per confezione,
  // pezzi e sconto sono i due dati in piu' che servono per calcolare il costo
  // per clip. Facoltativi come tutto il resto: v === '' conta come "non lo so".
  const pezziOk = numeroONull(pezzi);
  const scontoOk = numeroONull(sconto);

  // COALESCE su ogni campo tranne l'id: il canone e le note non arrivano mai
  // dal PDF (l'interfaccia dice di scriverli a mano), e un secondo import che
  // porta solo nome e prezzo non deve piu' azzerarli. COALESCE tiene il
  // valore vecchio quando il nuovo e' nullo. Effetto collaterale voluto: da
  // qui non si puo' piu' svuotare un campo passando null. Lo svuotamento
  // resta possibile solo da PUT /api/analizzatori/:id, che scrive con un
  // UPDATE diretto invece di passare da upsertAnalizzatore, perche' e' l'unico
  // punto che sa distinguere "campo assente dalla richiesta" da "campo
  // presente e vuoto" (vedi server.js). pezzi e sconto seguono la stessa
  // regola di canone/note: dal PDF arrivano di rado (il listino Mylav non li
  // elenca sempre come le clip concorrenti), e un reimport che non li porta
  // non deve cancellare un valore completato a mano in precedenza.
  //
  // Due indici unici parziali (vedi ensureSchema), uno per le righe con
  // provenienza e uno per quelle senza: l'ON CONFLICT deve nominare le
  // colonne e il WHERE dell'indice giusto, altrimenti SQLite non lo
  // riconosce e l'insert fallisce invece di aggiornare (stessa struttura di
  // lib/clip.js per concorrente_id). file_origine non e' nel SET perche' e'
  // parte della chiave su cui si fa match: un secondo import con lo stesso
  // file aggiorna sempre lo stesso valore, non serve riscriverlo.
  if (fileOrigineOk == null) {
    db.prepare(`
      INSERT INTO analizzatori_mylav (user_id, nome, prezzo, noleggio, note, file_origine, pezzi, sconto)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(user_id, nome) WHERE file_origine IS NULL DO UPDATE SET
        prezzo   = COALESCE(excluded.prezzo, prezzo),
        noleggio = COALESCE(excluded.noleggio, noleggio),
        note     = COALESCE(excluded.note, note),
        pezzi    = COALESCE(excluded.pezzi, pezzi),
        sconto   = COALESCE(excluded.sconto, sconto)
    `).run(Number(userId), nomeOk, prezzoOk, noleggioOk, noteOk, pezziOk, scontoOk);
  } else {
    db.prepare(`
      INSERT INTO analizzatori_mylav (user_id, nome, prezzo, noleggio, note, file_origine, pezzi, sconto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, nome, file_origine) WHERE file_origine IS NOT NULL DO UPDATE SET
        prezzo   = COALESCE(excluded.prezzo, prezzo),
        noleggio = COALESCE(excluded.noleggio, noleggio),
        note     = COALESCE(excluded.note, note),
        pezzi    = COALESCE(excluded.pezzi, pezzi),
        sconto   = COALESCE(excluded.sconto, sconto)
    `).run(Number(userId), nomeOk, prezzoOk, noleggioOk, noteOk, fileOrigineOk, pezziOk, scontoOk);
  }

  // ON CONFLICT DO UPDATE non aggiorna lastInsertRowid quando prende la strada
  // dell'update: si rilegge l'id dalla chiave univoca (user_id, nome,
  // file_origine). "file_origine IS ?" invece di "= ?": in SQLite "= NULL"
  // non e' mai vero, IS confronta NULL con NULL correttamente.
  const row = db.prepare(`SELECT id FROM analizzatori_mylav WHERE user_id = ? AND nome = ? AND file_origine IS ?`)
    .get(Number(userId), nomeOk, fileOrigineOk);
  return { id: row.id };
}

// fileOrigine assente (parametro non passato) -> tutti gli analizzatori
// dell'account. fileOrigine passato (anche null) -> solo le righe di quel PDF
// (null vuol dire "senza provenienza"). Stessa distinzione di listaClip
// (lib/clip.js): il filtro si attiva col terzo argomento, riconosciuto per
// valore e non per quanti ne sono stati passati.
// "file_origine IS ?" invece di "= ?": in SQLite "= NULL" non e' mai vero,
// IS invece confronta NULL con NULL correttamente (e funziona identico
// quando il parametro e' una stringa).
const TUTTI = Symbol('tutti gli analizzatori');
function listaAnalizzatori(db, userId, fileOrigine = TUTTI) {
  if (fileOrigine === TUTTI) {
    return db.prepare(`SELECT * FROM analizzatori_mylav WHERE user_id = ? ORDER BY nome`)
      .all(Number(userId)).map(daRiga);
  }
  const fileOk = fileOrigine == null ? null : String(fileOrigine);
  return db.prepare(`SELECT * FROM analizzatori_mylav WHERE user_id = ? AND file_origine IS ? ORDER BY nome`)
    .all(Number(userId), fileOk).map(daRiga);
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

// Elimina tutti gli analizzatori di un PDF in blocco: l'unica via per ripulire
// un listino sbagliato senza passare riga per riga (vedi eliminaAnalizzatore).
// fileOrigine puo' essere null (il gruppo senza provenienza): in SQL "= NULL"
// non e' mai vero, quindi va cercato con IS NULL. Un solo WHERE per entrambi i
// casi, stessa forma di eliminaGruppoClip (lib/clip.js).
function eliminaGruppoAnalizzatori(db, fileOrigine, userId) {
  const fileOk = fileOrigine == null ? null : String(fileOrigine);
  const info = db.prepare(`
    DELETE FROM analizzatori_mylav
    WHERE user_id = ? AND (file_origine = ? OR (? IS NULL AND file_origine IS NULL))
  `).run(Number(userId), fileOk, fileOk);
  return { eliminate: info.changes };
}

module.exports = {
  ensureSchema, upsertAnalizzatore, listaAnalizzatori, eliminaAnalizzatore, gruppiAnalizzatori,
  eliminaGruppoAnalizzatori
};
