'use strict';
// Bozze di import PDF e registro di audit.
//
// Una bozza e' il risultato di un'analisi PDF in attesa di revisione umana:
// finche' resta in stato 'bozza' NULLA e' scritto nel catalogo. La conferma
// esplicita dell'operatore e' l'unico passaggio che promuove i dati, e avviene
// una volta sola per bozza.
//
// Ogni lettura e ogni scrittura sono vincolate a user_id: una bozza di un
// account non e' leggibile ne' confermabile da un altro, nemmeno conoscendone
// l'id (stessa regola del catalogo piani).

const { parsePrezzo } = require('./pdfclassifica');

const ENTITA = ['piano', 'concorrente', 'macchina'];

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_bozze (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      entita           TEXT    NOT NULL,
      nome_file        TEXT    NOT NULL,
      stato            TEXT    NOT NULL DEFAULT 'bozza',
      json_righe       TEXT    NOT NULL,
      pagine           INTEGER,
      totali_tabellari INTEGER,
      classificate     INTEGER,
      confidenza       REAL,
      created_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
      confermato_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bozze_utente ON import_bozze(user_id, stato);

    CREATE TABLE IF NOT EXISTS import_audit (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER,
      entita    TEXT,
      nome_file TEXT,
      esito     TEXT NOT NULL,
      dettaglio TEXT,
      n_righe   INTEGER,
      bozza_id  INTEGER,
      data      TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_utente ON import_audit(user_id, data);
  `);
}

function verificaEntita(entita) {
  if (!ENTITA.includes(entita)) {
    const err = new Error(`entita non prevista: "${entita}" (attese: ${ENTITA.join(', ')})`);
    err.codice = 'DESTINAZIONE_NON_VALIDA';
    throw err;
  }
}

function daRiga(row) {
  if (!row) return null;
  let righe = [];
  try { righe = JSON.parse(row.json_righe); } catch (_) { righe = []; }
  return {
    id: row.id,
    userId: row.user_id,
    entita: row.entita,
    nomeFile: row.nome_file,
    stato: row.stato,
    righe: Array.isArray(righe) ? righe : [],
    pagine: row.pagine,
    totaliTabellari: row.totali_tabellari,
    classificate: row.classificate,
    confidenza: row.confidenza,
    createdAt: row.created_at,
    confermatoAt: row.confermato_at
  };
}

function creaBozza(db, dati) {
  const { userId, entita, nomeFile, righe, pagine, totaliTabellari, classificate, confidenza } = dati;
  verificaEntita(entita);
  if (userId == null) throw new Error('userId mancante');

  // Le bozze non confermate dello stesso account sono superate da questa: non
  // esiste modo di riaprirle e ognuna porta il JSON completo delle righe, quindi
  // conservarle gonfierebbe il database senza servire a nessuno. Le bozze
  // confermate restano: sono lo storico di cio' che e' stato importato, e ogni
  // analisi resta comunque tracciata in import_audit.
  db.prepare(`DELETE FROM import_bozze WHERE user_id = ? AND stato = 'bozza'`).run(Number(userId));

  const info = db.prepare(`
    INSERT INTO import_bozze
      (user_id, entita, nome_file, stato, json_righe, pagine, totali_tabellari, classificate, confidenza)
    VALUES (?, ?, ?, 'bozza', ?, ?, ?, ?, ?)
  `).run(
    Number(userId), entita, String(nomeFile || 'documento.pdf'),
    JSON.stringify(righe || []),
    pagine == null ? null : Number(pagine),
    totaliTabellari == null ? null : Number(totaliTabellari),
    classificate == null ? null : Number(classificate),
    confidenza == null ? null : Number(confidenza)
  );
  return { id: Number(info.lastInsertRowid) };
}

function getBozza(db, id, userId) {
  const row = db.prepare(`SELECT * FROM import_bozze WHERE id = ? AND user_id = ?`)
    .get(Number(id), Number(userId));
  return daRiga(row);
}

/**
 * Promuove una bozza a 'confermato' salvando le righe riviste dall'operatore.
 * Passa solo se la bozza esiste, appartiene all'account ed e' ancora in bozza:
 * cosi una seconda conferma non puo' riscrivere il catalogo.
 *
 * @returns {Object|null} la bozza confermata, oppure null se non ammessa
 */
function confermaBozza(db, id, userId, righeFinali) {
  const info = db.prepare(`
    UPDATE import_bozze
       SET stato = 'confermato', json_righe = ?, confermato_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ? AND stato = 'bozza'
  `).run(JSON.stringify(righeFinali || []), Number(id), Number(userId));
  if (!info.changes) return null;
  return getBozza(db, id, userId);
}

/**
 * Ripulisce le righe riviste a mano prima di scriverle nel catalogo.
 * Scarta cio' che non e' importabile invece di inserire dati rotti, e dice
 * quante righe ha ignorato: il conteggio finisce nella risposta e nell'audit.
 */
function normalizzaRighe(righe) {
  const perNome = new Map();
  let ignorate = 0;
  let duplicate = 0;
  for (const r of Array.isArray(righe) ? righe : []) {
    const nome = String((r && r.nome) || '').replace(/\s+/g, ' ').trim();
    // Il prezzo arriva come numero dall'analisi o come testo digitato in
    // revisione: "1.234,56" deve valere 1234.56, non 1.234.
    const prezzo = parsePrezzo(r && r.prezzo);
    if (!nome || !Number.isFinite(prezzo) || prezzo < 0) { ignorate++; continue; }

    // Il catalogo e' indicizzato per nome normalizzato: due righe con lo stesso
    // nome diventano una sola scrittura, quindi contarle entrambe come
    // "importate" sarebbe un resoconto falso. Vince l'ultima, come l'upsert.
    const chiave = nome.toLowerCase();
    if (perNome.has(chiave)) duplicate++;
    perNome.set(chiave, { nome, prezzo });
  }
  return { valide: [...perNome.values()], ignorate, duplicate };
}

function registraAudit(db, dati) {
  const { userId, entita, nomeFile, esito, dettaglio, nRighe, bozzaId } = dati;
  if (!esito) throw new Error('esito mancante');
  db.prepare(`
    INSERT INTO import_audit (user_id, entita, nome_file, esito, dettaglio, n_righe, bozza_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId == null ? null : Number(userId),
    entita || null,
    nomeFile || null,
    String(esito),
    dettaglio == null ? null : String(dettaglio),
    nRighe == null ? null : Number(nRighe),
    bozzaId == null ? null : Number(bozzaId)
  );
}

// id DESC come secondo criterio: CURRENT_TIMESTAMP ha risoluzione al secondo,
// quindi due import ravvicinati avrebbero la stessa data e ordine indefinito.
function listaAudit(db, userId, limite = 50) {
  return db.prepare(`
    SELECT id, entita, nome_file, esito, dettaglio, n_righe, bozza_id, data
      FROM import_audit
     WHERE user_id = ?
     ORDER BY data DESC, id DESC
     LIMIT ?
  `).all(Number(userId), Number(limite)).map(r => ({
    id: r.id,
    entita: r.entita,
    nomeFile: r.nome_file,
    esito: r.esito,
    dettaglio: r.dettaglio,
    nRighe: r.n_righe,
    bozzaId: r.bozza_id,
    data: r.data
  }));
}

module.exports = {
  ENTITA, ensureSchema, creaBozza, getBozza, confermaBozza,
  normalizzaRighe, registraAudit, listaAudit
};
