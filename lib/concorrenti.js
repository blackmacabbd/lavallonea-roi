'use strict';
const { norm } = require('./piani.js');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concorrenti (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nome         TEXT NOT NULL,
      user_id      INTEGER,
      data_import  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS esami_concorrente (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      concorrente_id    INTEGER NOT NULL REFERENCES concorrenti(id),
      nome_originale    TEXT NOT NULL,
      prezzo            REAL NOT NULL,
      sconto            REAL,
      esame_mylav_nome  TEXT,
      confermato        INTEGER NOT NULL DEFAULT 0,
      UNIQUE(concorrente_id, nome_originale)
    );
  `);

  // La tabella nata prima di user_id ha UNIQUE sul solo nome: due account non
  // potevano avere un laboratorio con lo stesso nome, e il secondo import
  // falliva con un errore di vincolo incomprensibile. Si ricostruisce solo se
  // serve davvero.
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='concorrenti'`).get();
  // Il controllo e' sul testo esatto della tabella in archivio, che e' uno
  // solo e lo conosciamo: 'nome TEXT UNIQUE NOT NULL'. Una scrittura diversa
  // (per esempio 'nome TEXT NOT NULL UNIQUE') non verrebbe riconosciuta. Va
  // bene qui perche' la tabella da migrare e' quella e nessun'altra, ma se
  // questo modo di riconoscere uno schema vecchio venisse riusato altrove
  // andrebbe reso meno legato all'ordine delle parole.
  const daRicostruire = sql && /nome\s+TEXT\s+UNIQUE/i.test(sql.sql);
  if (daRicostruire) {
    // In node:sqlite le chiavi esterne sono ATTIVE di default, a differenza
    // della riga di comando sqlite3: esami_concorrente punta a concorrenti, e
    // senza sospenderle la ricostruzione fallisce. PRAGMA foreign_keys non e'
    // transazionale e dentro una transazione non fa niente: va spento PRIMA
    // del BEGIN e riacceso in un finally, altrimenti un errore lascerebbe il
    // database senza controllo delle chiavi esterne per tutto il resto della
    // sessione.
    const fkEraAttivo = db.prepare(`PRAGMA foreign_keys`).get().foreign_keys === 1;
    if (fkEraAttivo) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE concorrenti_nuova (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          nome         TEXT NOT NULL,
          user_id      INTEGER,
          data_import  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO concorrenti_nuova (id, nome, user_id, data_import)
          SELECT id, nome, user_id, data_import FROM concorrenti;
        DROP TABLE concorrenti;
        ALTER TABLE concorrenti_nuova RENAME TO concorrenti;
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (fkEraAttivo) db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // L'unicita' nuova non sta nella CREATE TABLE ma in un indice parziale, per
  // la stessa ragione gia' incontrata sulle clip: in SQLite due NULL sono
  // considerati diversi dentro un UNIQUE, quindi UNIQUE(nome, user_id) non
  // impedirebbe due righe "IDEXX" con user_id nullo - e le righe modello del
  // catalogo hanno proprio user_id nullo. Gli indici si creano dopo l'eventuale
  // ricostruzione: il DROP TABLE porta via gli indici della tabella vecchia.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS concorrente_per_account
      ON concorrenti(nome, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS concorrente_senza_account
      ON concorrenti(nome) WHERE user_id IS NULL;
  `);
}

const STOPWORD = new Set([
  'di', 'del', 'della', 'dei', 'delle', 'test', 'esame', 'esami',
  'e', 'ed', 'il', 'lo', 'la', 'i', 'gli', 'le', 'per', 'con', 'da', 'a', 'in', 'su'
]);

function tokenizza(nomeRaw) {
  return norm(nomeRaw).split(' ').filter(t => t && !STOPWORD.has(t));
}

function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA), b = new Set(tokensB);
  if (a.size === 0 && b.size === 0) return 0;
  let intersezione = 0;
  for (const t of a) if (b.has(t)) intersezione++;
  const unione = new Set([...a, ...b]).size;
  return unione === 0 ? 0 : intersezione / unione;
}

const SOGLIA_SICURA = 0.6;
const SOGLIA_MINIMA = 0.3;

function trovaMatch(db, concorrenteId, esameMylavNomeRaw) {
  const nome = norm(esameMylavNomeRaw);
  if (!nome) return { trovato: false };

  const esatto = db.prepare(`
    SELECT * FROM esami_concorrente WHERE concorrente_id = ? AND esame_mylav_nome = ?
  `).get(concorrenteId, nome);
  if (esatto) {
    return {
      trovato: true, sicuro: true, esameConcorrenteId: esatto.id,
      nomeOriginale: esatto.nome_originale, prezzo: esatto.prezzo, sconto: esatto.sconto, score: 1
    };
  }

  // Tolleranza sul nome mappato: un nome parziale che corrisponde in modo univoco a una
  // mappatura gia' confermata risolve comunque (es. "emocromo mappato" -> "emocromo mappato test").
  // Come risolviEsameCanonico: sottostringa univoca, altrimenti prefisso univoco; altrimenti nessuno.
  const esc = nome.replace(/[\\%_]/g, c => '\\' + c);
  const mappati = db.prepare(`
    SELECT * FROM esami_concorrente
    WHERE concorrente_id = ? AND esame_mylav_nome IS NOT NULL AND esame_mylav_nome LIKE ? ESCAPE '\\'
  `).all(concorrenteId, '%' + esc + '%');
  let scelto = null;
  if (mappati.length === 1) scelto = mappati[0];
  else if (mappati.length > 1) {
    const starts = mappati.filter(m => m.esame_mylav_nome.startsWith(nome));
    if (starts.length === 1) scelto = starts[0];
  }
  if (scelto) {
    return {
      trovato: true, sicuro: true, esameConcorrenteId: scelto.id,
      nomeOriginale: scelto.nome_originale, prezzo: scelto.prezzo, sconto: scelto.sconto, score: 1
    };
  }

  const candidati = db.prepare(`
    SELECT * FROM esami_concorrente WHERE concorrente_id = ? AND esame_mylav_nome IS NULL
  `).all(concorrenteId);
  const tokensMylav = tokenizza(nome);

  let migliore = null, migliorScore = 0;
  for (const c of candidati) {
    const score = jaccard(tokensMylav, tokenizza(c.nome_originale));
    if (score > migliorScore) { migliorScore = score; migliore = c; }
  }
  if (!migliore || migliorScore < SOGLIA_MINIMA) return { trovato: false };

  const sicuro = migliorScore >= SOGLIA_SICURA;
  if (sicuro) {
    db.prepare(`UPDATE esami_concorrente SET esame_mylav_nome = ? WHERE id = ?`).run(nome, migliore.id);
  }
  return {
    trovato: true, sicuro, esameConcorrenteId: migliore.id,
    nomeOriginale: migliore.nome_originale, prezzo: migliore.prezzo, sconto: migliore.sconto, score: migliorScore
  };
}

function confermaMatch(db, concorrenteId, esameConcorrenteId, esameMylavNomeRaw) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ? AND concorrente_id = ?
  `).run(norm(esameMylavNomeRaw), esameConcorrenteId, concorrenteId);
}

function rimuoviMatch(db, concorrenteId, esameConcorrenteId) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = NULL, confermato = 0 WHERE id = ? AND concorrente_id = ?
  `).run(esameConcorrenteId, concorrenteId);
}

// Trova il laboratorio per nome e account, o lo crea se manca. Non scrive
// nessuna riga di esami: serve a chi importa un listino che non e' un
// listino di esami (es. le clip dei macchinari), dove inventare righe vuote
// in esami_concorrente sarebbe un dato falso. upsertConcorrente usa questa
// stessa funzione per la propria parte di anagrafica, cosi' un solo punto
// del codice decide come nasce un laboratorio.
function trovaOCreaConcorrente(db, nome, userId) {
  const nomeOk = String(nome || '').trim();
  if (!nomeOk) {
    const err = new Error('Nome concorrente mancante');
    err.codice = 'NOME_CONCORRENTE_MANCANTE';
    throw err;
  }

  let concorrente = db.prepare(`SELECT id FROM concorrenti WHERE nome = ? AND user_id = ?`).get(nomeOk, userId);
  if (!concorrente) {
    const r = db.prepare(`INSERT INTO concorrenti (nome, user_id) VALUES (?, ?)`).run(nomeOk, userId);
    concorrente = { id: Number(r.lastInsertRowid) };
  }
  return { id: concorrente.id };
}

function upsertConcorrente(db, nomeConcorrente, righe, userId) {
  const concorrente = trovaOCreaConcorrente(db, nomeConcorrente, userId);

  const upsert = db.prepare(`
    INSERT INTO esami_concorrente (concorrente_id, nome_originale, prezzo, sconto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(concorrente_id, nome_originale) DO UPDATE SET prezzo = excluded.prezzo, sconto = excluded.sconto
  `);

  db.exec('BEGIN');
  try {
    let righeSalvate = 0;
    for (const r of (righe || [])) {
      const nomeOriginale = String(r.nome_originale || '').trim();
      if (!nomeOriginale) continue;
      upsert.run(concorrente.id, nomeOriginale, Number(r.prezzo) || 0, r.sconto == null || r.sconto === '' ? null : Number(r.sconto));
      righeSalvate++;
    }
    db.exec('COMMIT');
    return { concorrenteId: concorrente.id, righeSalvate };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listaConcorrenti(db, userId) {
  return db.prepare(`
    SELECT c.id, c.nome, c.data_import,
      COUNT(e.id) AS n_esami,
      SUM(CASE WHEN e.esame_mylav_nome IS NOT NULL THEN 1 ELSE 0 END) AS n_mappati
    FROM concorrenti c
    LEFT JOIN esami_concorrente e ON e.concorrente_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.nome
  `).all(userId).map(r => ({ ...r, n_mappati: r.n_mappati || 0 }));
}

function dettaglioConcorrente(db, id, userId) {
  const concorrente = db.prepare(`SELECT * FROM concorrenti WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!concorrente) return null;
  const esami = db.prepare(`SELECT * FROM esami_concorrente WHERE concorrente_id = ? ORDER BY nome_originale`).all(id);
  return { concorrente, esami };
}

// Elimina un concorrente e tutti i suoi esami. Ritorna true se esisteva.
function eliminaConcorrente(db, id, userId) {
  const cid = Number(id);
  const esiste = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!esiste) return false;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid);

    // I database aggiornati da una versione precedente hanno ancora le tabelle
    // dei macchinari: contengono righe dell'operatore, e la migrazione le lascia
    // dove sono invece di cancellargliele. Quelle righe puntano ai concorrenti
    // con una chiave esterna, quindi senza toglierle prima la cancellazione
    // fallisce e il concorrente non si elimina piu'. Sulle installazioni nuove
    // le tabelle non esistono e non si fa nulla.
    const esiste = t => !!db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (esiste('listini_macchine')) {
      if (esiste('macchine')) {
        db.prepare(`DELETE FROM macchine WHERE listino_id IN (
          SELECT id FROM listini_macchine WHERE concorrente_id = ?)`).run(cid);
      }
      db.prepare(`DELETE FROM listini_macchine WHERE concorrente_id = ?`).run(cid);
    }

    // Stesso difetto, stessa causa: lib/clip.js dichiara una chiave esterna
    // verso concorrenti (Task 2), quindi le clip del laboratorio vanno tolte
    // prima di lui o la cancellazione fallisce con FOREIGN KEY constraint
    // failed. La guardia sull'esistenza della tabella e' la stessa dei
    // macchinari: non tutti i chiamanti (es. i test piu' vecchi) creano clip.
    if (esiste('clip')) {
      db.prepare(`DELETE FROM clip WHERE concorrente_id = ?`).run(cid);
    }

    db.prepare(`DELETE FROM concorrenti WHERE id = ?`).run(cid);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  ensureSchema, trovaOCreaConcorrente, upsertConcorrente, listaConcorrenti, dettaglioConcorrente,
  eliminaConcorrente, tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch
};
