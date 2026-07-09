'use strict';
const { norm } = require('./piani.js');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concorrenti (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nome         TEXT UNIQUE NOT NULL,
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

function confermaMatch(db, esameConcorrenteId, esameMylavNomeRaw) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = ?, confermato = 1 WHERE id = ?
  `).run(norm(esameMylavNomeRaw), esameConcorrenteId);
}

function rimuoviMatch(db, esameConcorrenteId) {
  db.prepare(`
    UPDATE esami_concorrente SET esame_mylav_nome = NULL, confermato = 0 WHERE id = ?
  `).run(esameConcorrenteId);
}

function upsertConcorrente(db, nomeConcorrente, righe) {
  const nome = String(nomeConcorrente || '').trim();
  if (!nome) throw new Error('Nome concorrente mancante');

  db.prepare(`INSERT INTO concorrenti (nome) VALUES (?) ON CONFLICT(nome) DO NOTHING`).run(nome);
  const concorrente = db.prepare(`SELECT id FROM concorrenti WHERE nome = ?`).get(nome);

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

function listaConcorrenti(db) {
  return db.prepare(`
    SELECT c.id, c.nome, c.data_import,
      COUNT(e.id) AS n_esami,
      SUM(CASE WHEN e.esame_mylav_nome IS NOT NULL THEN 1 ELSE 0 END) AS n_mappati
    FROM concorrenti c
    LEFT JOIN esami_concorrente e ON e.concorrente_id = c.id
    GROUP BY c.id
    ORDER BY c.nome
  `).all().map(r => ({ ...r, n_mappati: r.n_mappati || 0 }));
}

function dettaglioConcorrente(db, id) {
  const concorrente = db.prepare(`SELECT * FROM concorrenti WHERE id = ?`).get(id);
  if (!concorrente) return null;
  const esami = db.prepare(`SELECT * FROM esami_concorrente WHERE concorrente_id = ? ORDER BY nome_originale`).all(id);
  return { concorrente, esami };
}

// Elimina un concorrente e tutti i suoi esami. Ritorna true se esisteva.
function eliminaConcorrente(db, id) {
  const cid = Number(id);
  const esiste = db.prepare(`SELECT 1 FROM concorrenti WHERE id = ?`).get(cid);
  if (!esiste) return false;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM esami_concorrente WHERE concorrente_id = ?`).run(cid);
    db.prepare(`DELETE FROM concorrenti WHERE id = ?`).run(cid);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  ensureSchema, upsertConcorrente, listaConcorrenti, dettaglioConcorrente,
  eliminaConcorrente, tokenizza, jaccard, trovaMatch, confermaMatch, rimuoviMatch
};
