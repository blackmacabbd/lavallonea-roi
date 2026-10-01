'use strict';
const { leggiImporto } = require('./importi');
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

// Un esame Mylav vale UN esame per laboratorio: il calcolatore ne puo' usare
// un solo prezzo, e con due abbinamenti trovaMatch prendeva la prima riga
// trovata, a caso. Abbinarlo a un altro esame sposta l'abbinamento: quello di
// prima torna libero. Ritorna { tolto: [nomi originali liberati] }, per dirlo
// all'operatore. Nella stessa transazione: o si sposta, o non cambia niente.
function confermaMatch(db, concorrenteId, esameConcorrenteId, esameMylavNomeRaw) {
  const nome = norm(esameMylavNomeRaw);
  db.exec('BEGIN');
  try {
    const altri = db.prepare(`
      SELECT id, nome_originale FROM esami_concorrente
      WHERE concorrente_id = ? AND esame_mylav_nome = ? AND id <> ?
    `).all(concorrenteId, nome, esameConcorrenteId);
    if (altri.length) {
      db.prepare(`
        UPDATE esami_concorrente SET esame_mylav_nome = NULL, confermato = 0
        WHERE concorrente_id = ? AND esame_mylav_nome = ? AND id <> ?
      `).run(concorrenteId, nome, esameConcorrenteId);
    }
    db.prepare(`
      UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ? AND concorrente_id = ?
    `).run(nome, esameConcorrenteId, concorrenteId);
    db.exec('COMMIT');
    return { tolto: altri.map(a => a.nome_originale) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

// Import Excel di un listino esami (Gestione esami esterni). Stessa forma di
// importaListinoExcel per i macchinari (lib/clip.js), che leggeva gia' bene:
//  - il prezzo con leggiImporto: «€ 42,30» e' 42,30 e «1.012,10» e' 1012,10.
//    Prima la rotta usava parseFloat e il primo diventava 0, il secondo 1,012;
//  - una riga senza prezzo valido (vuoto, testo, negativo) si scarta e si
//    conta, invece di entrare come esame a 0 €;
//  - lo stesso nome due volte tiene la prima riga e conta il doppione, invece
//    di sovrascriverla in silenzio;
//  - uno sconto impossibile (non fra 0 e 100) si ignora: il prezzo resta;
//  - il laboratorio nasce solo se c'e' almeno una riga da scrivere, e nella
//    stessa transazione delle righe: niente laboratori fantasma.
// righe: [{ nome, prezzo, sconto }] con i valori cosi' come sono nelle celle.
function importaEsamiExcel(db, dati) {
  const { userId, nomeConcorrente, righe } = dati || {};
  if (userId == null) throw new Error('userId mancante');
  const valide = [];
  const visti = new Set();
  let scartate = 0, doppioni = 0;
  for (const r of (righe || [])) {
    const nome = String((r && r.nome) == null ? '' : r.nome).trim();
    const prezzo = leggiImporto(r && r.prezzo);
    if (!nome || prezzo == null || prezzo < 0) { scartate++; continue; }
    if (visti.has(nome)) { doppioni++; continue; }
    visti.add(nome);
    const sconto = leggiImporto(r.sconto);
    valide.push({ nome, prezzo, sconto: sconto != null && sconto >= 0 && sconto <= 100 ? sconto : null });
  }
  if (!valide.length) {
    const err = new Error('Nessuna riga importabile nell\'elenco confermato');
    err.codice = 'NESSUNA_RIGA_IMPORTABILE';
    throw err;
  }
  const upsert = db.prepare(`
    INSERT INTO esami_concorrente (concorrente_id, nome_originale, prezzo, sconto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(concorrente_id, nome_originale) DO UPDATE SET prezzo = excluded.prezzo, sconto = excluded.sconto
  `);
  db.exec('BEGIN');
  try {
    const { id } = trovaOCreaConcorrente(db, nomeConcorrente, userId);
    for (const v of valide) upsert.run(id, v.nome, v.prezzo, v.sconto);
    db.exec('COMMIT');
    return { concorrenteId: id, importate: valide.length, scartate, doppioni };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// soloConEsami (default false, non distruttivo): un laboratorio nato da un
// import di clip (trovaOCreaConcorrente, mai upsertConcorrente) non ha
// nessuna riga in esami_concorrente. E' un laboratorio a tutti gli effetti
// per i macchinari, ma un concorrente vuoto per il lato esami: sceglierlo li'
// puo' solo produrre zeri. Il default resta l'elenco completo apposta —
// e' quello che legge la pagina macchinari (vedi renderMacchinariEsterni in
// app.js), che deve continuare a vedere ogni laboratorio a prescindere dagli
// esami. Il filtro si applica una sola volta qui, nella query che genera
// l'elenco, non riga per riga da chi lo consuma: e' la stessa regola gia'
// imparata con la colonna del laboratorio nel calcolatore clip.
function listaConcorrenti(db, userId, { soloConEsami = false } = {}) {
  return db.prepare(`
    SELECT c.id, c.nome, c.data_import,
      COUNT(e.id) AS n_esami,
      SUM(CASE WHEN e.esame_mylav_nome IS NOT NULL THEN 1 ELSE 0 END) AS n_mappati
    FROM concorrenti c
    LEFT JOIN esami_concorrente e ON e.concorrente_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ${soloConEsami ? 'HAVING COUNT(e.id) > 0' : ''}
    ORDER BY c.nome
  `).all(userId).map(r => ({ ...r, n_mappati: r.n_mappati || 0 }));
}

function dettaglioConcorrente(db, id, userId) {
  const concorrente = db.prepare(`SELECT * FROM concorrenti WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!concorrente) return null;
  const esami = db.prepare(`SELECT * FROM esami_concorrente WHERE concorrente_id = ? ORDER BY nome_originale`).all(id);
  return { concorrente, esami };
}

// Toglie un laboratorio e tutto cio' che gli punta. NON apre una transazione:
// la apre chi chiama, cosi' la rimozione puo' stare nella stessa transazione
// di cio' che l'ha resa necessaria (vedi eliminaSeVuoto).
//
// Le vecchie tabelle dei macchinari e le clip hanno una chiave esterna verso
// concorrenti: vanno tolte PRIMA della riga del laboratorio, o la
// cancellazione fallisce con FOREIGN KEY constraint failed. Le tabelle possono
// mancare (installazioni nuove, test): si controlla prima.
function rimuoviLaboratorio(db, cid) {
  const esiste = t => !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid);
  if (esiste('listini_macchine')) {
    if (esiste('macchine')) {
      db.prepare(`DELETE FROM macchine WHERE listino_id IN (
        SELECT id FROM listini_macchine WHERE concorrente_id = ?)`).run(cid);
    }
    db.prepare(`DELETE FROM listini_macchine WHERE concorrente_id = ?`).run(cid);
  }
  if (esiste('clip')) db.prepare(`DELETE FROM clip WHERE concorrente_id = ?`).run(cid);
  db.prepare(`DELETE FROM concorrenti WHERE id = ?`).run(cid);
}

// Elimina un laboratorio con tutto quello che ha. Comportamento invariato;
// l'interfaccia non la usa piu' (ogni sezione elimina solo il suo), resta per
// i test e per eliminaSeVuoto, che ne condivide il corpo.
function eliminaConcorrente(db, id, userId) {
  const cid = Number(id);
  const esiste = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!esiste) return false;
  db.exec('BEGIN');
  try {
    rimuoviLaboratorio(db, cid);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Un laboratorio vuoto in entrambe le sezioni — nessun esame, nessuna clip —
// si toglie. Senza questa regola resterebbe invisibile ovunque, e
// trovaOCreaConcorrente continuerebbe a riusarlo per nome. Le vecchie tabelle
// dei macchinari non contano: nessuna schermata le legge piu'.
// NON apre una transazione: vive dentro quella di chi elimina.
function eliminaSeVuoto(db, concorrenteId, userId) {
  if (concorrenteId == null) return false;
  const cid = Number(concorrenteId);
  const lab = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!lab) return false;
  const nEsami = db.prepare(`SELECT COUNT(*) AS n FROM esami_concorrente WHERE concorrente_id = ?`).get(cid).n;
  if (nEsami > 0) return false;
  const haClip = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='clip'`).get();
  if (haClip && db.prepare(`SELECT COUNT(*) AS n FROM clip WHERE concorrente_id = ?`).get(cid).n > 0) return false;
  rimuoviLaboratorio(db, cid);
  return true;
}

// «Elimina» in Gestione esami esterni: toglie SOLO gli esami del laboratorio.
// I suoi listini macchinari restano: sono un'altra sezione, e cancellarli di
// nascosto era la trappola da togliere. Se il laboratorio resta vuoto, si
// toglie nella stessa transazione.
function eliminaEsamiConcorrente(db, id, userId) {
  const cid = Number(id);
  const lab = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ? AND user_id = ?`).get(cid, userId);
  if (!lab) return { trovato: false, eliminati: 0, laboratorioRimosso: false };
  db.exec('BEGIN');
  try {
    const eliminati = db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid).changes;
    const laboratorioRimosso = eliminaSeVuoto(db, cid, userId);
    db.exec('COMMIT');
    return { trovato: true, eliminati, laboratorioRimosso };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  ensureSchema, trovaOCreaConcorrente, upsertConcorrente, importaEsamiExcel, listaConcorrenti, dettaglioConcorrente,
  eliminaConcorrente, eliminaSeVuoto, eliminaEsamiConcorrente, tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch
};
