'use strict';
// Catalogo clip: le clip precaricate degli analizzatori da banco.
//
// Il prezzo di listino e' per confezione, non per clip: il nome del prodotto
// finisce con il numero di pezzi della confezione (es. "... CLIP 98-11003-02
// 12" costa il prezzo di listino diviso 12). Sbagliare quella divisione
// falserebbe ogni confronto di un fattore pari al numero di pezzi.
//
// Ogni lettura e ogni scrittura sono vincolate a user_id, come il resto del
// catalogo (stessa regola di concorrenti e piani).

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      nome              TEXT NOT NULL,
      prezzo_confezione REAL,
      pezzi             INTEGER,
      sconto            REAL,
      fonte             TEXT,
      data_import       DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, nome)
    );
  `);
}

// Il numero di pezzi e' l'ultimo elemento del nome, dopo il codice prodotto.
// Si accetta solo un intero piccolo: le confezioni vanno da poche unita' a
// qualche decina, e un numero piu' grande e' un codice travestito.
const PEZZI_MAX = 200;
function leggiPezzi(nome) {
  // Lo spazio prima del numero non e' un dettaglio: i codici prodotto finiscono
  // con "-02" e senza quel vincolo "Qualcosa -3" varrebbe tre pezzi.
  const m = String(nome == null ? '' : nome).trim().match(/(?:^|\s)(\d{1,3})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= PEZZI_MAX ? n : null;
}

// Riconoscere una clip serve a proporla all'operatore, che conferma sempre.
// Servono due segni insieme: un nome di prodotto (CLIP, Chem, Profile) e un
// numero di pezzi in coda. Il solo numero non basta: nel listino reale 127
// voci su 517 ne hanno uno, e quasi tutte sono esami.
const NOME_CLIP = /\b(clip|chem\s*\d|profile)\b/i;
function sembraClip(nome) {
  const n = String(nome == null ? '' : nome);
  return NOME_CLIP.test(n) && leggiPezzi(n) != null;
}

function daRiga(row) {
  return {
    id: row.id,
    userId: row.user_id,
    nome: row.nome,
    prezzoConfezione: row.prezzo_confezione,
    pezzi: row.pezzi,
    sconto: row.sconto,
    fonte: row.fonte,
    dataImport: row.data_import
  };
}

function upsertClip(db, dati) {
  const { userId, nome, prezzoConfezione, pezzi, sconto, fonte } = dati || {};
  if (userId == null) throw new Error('userId mancante');

  const nomeOk = String(nome == null ? '' : nome).trim();
  const prezzoOk = prezzoConfezione == null ? NaN : Number(prezzoConfezione);
  if (!nomeOk || !Number.isFinite(prezzoOk) || prezzoOk < 0) {
    const err = new Error('Nome o prezzo non validi');
    err.codice = 'NOME_PREZZO_NON_VALIDI';
    throw err;
  }

  db.prepare(`
    INSERT INTO clip (user_id, nome, prezzo_confezione, pezzi, sconto, fonte)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, nome) DO UPDATE SET
      prezzo_confezione = excluded.prezzo_confezione,
      pezzi             = excluded.pezzi,
      sconto            = excluded.sconto,
      fonte             = excluded.fonte
  `).run(
    Number(userId), nomeOk, prezzoOk,
    pezzi == null ? null : Number(pezzi),
    sconto == null || sconto === '' ? null : Number(sconto),
    fonte == null ? null : String(fonte)
  );

  // ON CONFLICT DO UPDATE non aggiorna lastInsertRowid quando prende la strada
  // dell'update: si rilegge l'id dalla chiave univoca (user_id, nome).
  const row = db.prepare(`SELECT id FROM clip WHERE user_id = ? AND nome = ?`).get(Number(userId), nomeOk);
  return { id: row.id };
}

function listaClip(db, userId) {
  return db.prepare(`SELECT * FROM clip WHERE user_id = ? ORDER BY nome`)
    .all(Number(userId)).map(daRiga);
}

// Elimina una clip del proprio account. Ritorna true se esisteva ed e' stata
// rimossa, false se non esisteva o apparteneva a un altro account (stesso
// comportamento di eliminaConcorrente: nessuna riga toccata, nessun errore).
function eliminaClip(db, id, userId) {
  const info = db.prepare(`DELETE FROM clip WHERE id = ? AND user_id = ?`)
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

module.exports = { ensureSchema, leggiPezzi, sembraClip, upsertClip, listaClip, eliminaClip };
