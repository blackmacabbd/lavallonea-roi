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
      concorrente_id    INTEGER REFERENCES concorrenti(id),
      nome              TEXT NOT NULL,
      prezzo_confezione REAL,
      pezzi             INTEGER,
      sconto            REAL,
      fonte             TEXT,
      data_import       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Database creato con lo schema precedente: la colonna manca e l'unicita' e'
  // ancora quella vecchia, dentro la definizione della tabella. Si ricostruisce
  // conservando righe e id, che sono l'unica cosa che conta. Va fatto PRIMA di
  // creare gli indici nuovi: su una tabella vecchia la colonna concorrente_id
  // non esiste ancora, e un CREATE INDEX su una colonna inesistente fallisce.
  const colonne = db.prepare(`PRAGMA table_info(clip)`).all().map(c => c.name);
  if (!colonne.includes('concorrente_id')) {
    // node:sqlite applica le chiavi esterne di default (a differenza della
    // riga di comando sqlite3). Con foreign_keys=ON, scrivere nella nuova
    // colonna concorrente_id (anche solo NULL, come qui) richiede che la
    // tabella concorrenti esista gia': in server.js esiste sempre (l'ordine
    // e' garantito), ma un chiamante isolato di ensureSchema no. Si
    // sospende il controllo solo per la durata della ricostruzione: non si
    // scrive mai un id di laboratorio reale in questo passaggio, solo NULL.
    const fkEraAttivo = db.prepare(`PRAGMA foreign_keys`).get().foreign_keys === 1;
    if (fkEraAttivo) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE clip_nuova (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id           INTEGER NOT NULL,
          concorrente_id    INTEGER REFERENCES concorrenti(id),
          nome              TEXT NOT NULL,
          prezzo_confezione REAL,
          pezzi             INTEGER,
          sconto            REAL,
          fonte             TEXT,
          data_import       DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO clip_nuova (id, user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, data_import)
          SELECT id, user_id, NULL, nome, prezzo_confezione, pezzi, sconto, fonte, data_import FROM clip;
        DROP TABLE clip;
        ALTER TABLE clip_nuova RENAME TO clip;
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (fkEraAttivo) db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // file_origine: il nome del PDF da cui la riga e' stata importata l'ultima
  // volta. Additiva: le righe gia' in tabella restano con file_origine NULL,
  // che vuol dire "non si sa da quale PDF viene" (non "e' un errore"). Va
  // aggiunta PRIMA degli indici qui sotto: la fanno gia' entrare nella chiave.
  const colonneFile = db.prepare(`PRAGMA table_info(clip)`).all().map(c => c.name);
  if (!colonneFile.includes('file_origine')) {
    db.exec(`ALTER TABLE clip ADD COLUMN file_origine TEXT`);
  }

  // L'unicita' era per laboratorio (user_id, concorrente_id, nome), non piu'
  // per account: due laboratori vendono la stessa clip ed e' normale. Da task
  // 5 in poi guadagna anche file_origine: due PDF dello stesso laboratorio
  // con una clip omonima (es. listino 2026 e 2027) affiancano due righe
  // invece che il secondo sovrascriva il primo. A differenza di
  // analizzatori_mylav, qui l'unicita' non e' mai stata scritta dentro la
  // CREATE TABLE ma sempre in indici a parte (vedi sopra, versioni
  // precedenti): passare alla chiave nuova e' percio' un cambio di INDICI,
  // non una ricostruzione della tabella. Nessun rischio per righe o id: la
  // tabella clip non viene toccata da questa migrazione.
  //
  // Le combinazioni "con o senza laboratorio" x "con o senza file" sono
  // quattro, quindi servono quattro indici parziali (in SQLite due NULL sono
  // distinti dentro un UNIQUE, quindi ognuno dei due assi ha bisogno del suo
  // ramo "IS NULL" a parte). DROP IF EXISTS toglie i due indici vecchi (a due
  // colonne, senza file_origine nella chiave) se ancora presenti: e'
  // idempotente quanto i CREATE UNIQUE INDEX IF NOT EXISTS che seguono, quindi
  // gira ad ogni avvio senza bisogno di riconoscere lo schema vecchio dal
  // testo.
  db.exec(`DROP INDEX IF EXISTS clip_per_laboratorio`);
  db.exec(`DROP INDEX IF EXISTS clip_senza_laboratorio`);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS clip_laboratorio_file
      ON clip(user_id, concorrente_id, nome, file_origine)
      WHERE concorrente_id IS NOT NULL AND file_origine IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS clip_laboratorio_senza_file
      ON clip(user_id, concorrente_id, nome)
      WHERE concorrente_id IS NOT NULL AND file_origine IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS clip_senza_laboratorio_file
      ON clip(user_id, nome, file_origine)
      WHERE concorrente_id IS NULL AND file_origine IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS clip_senza_laboratorio_senza_file
      ON clip(user_id, nome)
      WHERE concorrente_id IS NULL AND file_origine IS NULL;
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
    concorrenteId: row.concorrente_id == null ? null : row.concorrente_id,
    concorrenteNome: row.concorrente_nome == null ? null : row.concorrente_nome,
    nome: row.nome,
    prezzoConfezione: row.prezzo_confezione,
    pezzi: row.pezzi,
    sconto: row.sconto,
    fonte: row.fonte,
    fileOrigine: row.file_origine == null ? null : row.file_origine,
    dataImport: row.data_import
  };
}

function upsertClip(db, dati) {
  const { userId, concorrenteId, nome, prezzoConfezione, pezzi, sconto, fonte, fileOrigine } = dati || {};
  if (userId == null) throw new Error('userId mancante');

  const nomeOk = String(nome == null ? '' : nome).trim();
  const prezzoOk = prezzoConfezione == null ? NaN : Number(prezzoConfezione);
  if (!nomeOk || !Number.isFinite(prezzoOk) || prezzoOk < 0) {
    const err = new Error('Nome o prezzo non validi');
    err.codice = 'NOME_PREZZO_NON_VALIDI';
    throw err;
  }
  const concorrenteOk = concorrenteId == null ? null : Number(concorrenteId);
  const pezziOk = pezzi == null ? null : Number(pezzi);
  const scontoOk = sconto == null || sconto === '' ? null : Number(sconto);
  const fonteOk = fonte == null ? null : String(fonte);
  const fileOrigineOk = fileOrigine == null ? null : String(fileOrigine);

  // Quattro indici unici parziali (vedi ensureSchema): "con o senza
  // laboratorio" per "con o senza file" fa quattro combinazioni, e l'ON
  // CONFLICT deve nominare le colonne E il WHERE dell'indice giusto,
  // altrimenti SQLite non lo riconosce e l'insert fallisce invece di
  // aggiornare. Quattro rami invece di uno solo scritto in modo "furbo":
  // qui si perdono dati se si sbaglia, quindi la leggibilita' vale piu'
  // della concisione (vedi il rapporto per la stessa nota).
  //
  // COALESCE su ogni campo tranne l'id: un secondo import (che porta solo nome
  // e prezzo) non deve piu' azzerare pezzi/sconto/fonte completati a mano, e
  // COALESCE tiene il valore vecchio quando il nuovo e' nullo. Effetto
  // collaterale voluto: da qui non si puo' piu' svuotare un campo passando
  // null. Lo svuotamento resta possibile solo da PUT /api/clip/:id, che scrive
  // con un UPDATE diretto invece di passare da upsertClip, perche' e' l'unico
  // punto che sa distinguere "campo assente dalla richiesta" da "campo
  // presente e vuoto" (vedi server.js). file_origine non e' nel SET perche'
  // e' parte della chiave su cui si fa match: un secondo import con lo stesso
  // file aggiorna sempre lo stesso valore, non serve riscriverlo.
  const COALESCE_SET = `
        prezzo_confezione = COALESCE(excluded.prezzo_confezione, prezzo_confezione),
        pezzi             = COALESCE(excluded.pezzi, pezzi),
        sconto            = COALESCE(excluded.sconto, sconto),
        fonte             = COALESCE(excluded.fonte, fonte)`;

  if (concorrenteOk == null && fileOrigineOk == null) {
    db.prepare(`
      INSERT INTO clip (user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, file_origine)
      VALUES (?, NULL, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, nome) WHERE concorrente_id IS NULL AND file_origine IS NULL DO UPDATE SET
        ${COALESCE_SET}
    `).run(Number(userId), nomeOk, prezzoOk, pezziOk, scontoOk, fonteOk);
  } else if (concorrenteOk == null && fileOrigineOk != null) {
    db.prepare(`
      INSERT INTO clip (user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, file_origine)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, nome, file_origine) WHERE concorrente_id IS NULL AND file_origine IS NOT NULL DO UPDATE SET
        ${COALESCE_SET}
    `).run(Number(userId), nomeOk, prezzoOk, pezziOk, scontoOk, fonteOk, fileOrigineOk);
  } else if (concorrenteOk != null && fileOrigineOk == null) {
    db.prepare(`
      INSERT INTO clip (user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, file_origine)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, concorrente_id, nome) WHERE concorrente_id IS NOT NULL AND file_origine IS NULL DO UPDATE SET
        ${COALESCE_SET}
    `).run(Number(userId), concorrenteOk, nomeOk, prezzoOk, pezziOk, scontoOk, fonteOk);
  } else {
    db.prepare(`
      INSERT INTO clip (user_id, concorrente_id, nome, prezzo_confezione, pezzi, sconto, fonte, file_origine)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, concorrente_id, nome, file_origine) WHERE concorrente_id IS NOT NULL AND file_origine IS NOT NULL DO UPDATE SET
        ${COALESCE_SET}
    `).run(Number(userId), concorrenteOk, nomeOk, prezzoOk, pezziOk, scontoOk, fonteOk, fileOrigineOk);
  }

  // ON CONFLICT DO UPDATE non aggiorna lastInsertRowid quando prende la strada
  // dell'update: si rilegge l'id dalla chiave univoca (user_id,
  // concorrente_id, nome, file_origine). "concorrente_id IS ?"/"file_origine
  // IS ?" invece di "= ?": in SQLite "= NULL" non e' mai vero, IS confronta
  // NULL con NULL correttamente (e funziona identico quando il parametro e'
  // un valore vero).
  const row = db.prepare(`
    SELECT id FROM clip WHERE user_id = ? AND nome = ? AND concorrente_id IS ? AND file_origine IS ?
  `).get(Number(userId), nomeOk, concorrenteOk, fileOrigineOk);
  return { id: row.id };
}

// concorrenteId assente (parametro non passato) -> tutte le clip dell'account.
// concorrenteId passato (anche null) -> solo le clip di quel laboratorio (null
// vuol dire "senza laboratorio"). Le due cose non sono la stessa domanda.
// Il filtro si attiva col terzo argomento, riconosciuto per valore e non per
// quanti ne sono stati passati: chi scrivesse listaClip(db, id, undefined)
// intendeva "tutte", e contare gli argomenti gli avrebbe dato il contrario.
const TUTTE = Symbol('tutte le clip');
function listaClip(db, userId, concorrenteId = TUTTE) {
  const filtra = concorrenteId !== TUTTE;
  // In server.js concorrenti.ensureSchema gira sempre prima di clip.ensureSchema,
  // quindi la tabella c'e' sempre. Un chiamante isolato (es. un test sulla sola
  // migrazione) puo' pero' non averla creata: senza questa guardia il JOIN
  // romperebbe una lettura che non ha bisogno del nome del laboratorio.
  const conAnagrafica = !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='concorrenti'`).get();
  const base = conAnagrafica
    ? `
      SELECT clip.*, concorrenti.nome AS concorrente_nome
      FROM clip
      LEFT JOIN concorrenti ON concorrenti.id = clip.concorrente_id
      WHERE clip.user_id = ?
    `
    : `
      SELECT clip.*, NULL AS concorrente_nome
      FROM clip
      WHERE clip.user_id = ?
    `;
  if (!filtra) {
    return db.prepare(`${base} ORDER BY clip.nome`).all(Number(userId)).map(daRiga);
  }
  const concorrenteOk = concorrenteId == null ? null : Number(concorrenteId);
  return db.prepare(`${base} AND clip.concorrente_id IS ? ORDER BY clip.nome`)
    .all(Number(userId), concorrenteOk).map(daRiga);
}

// Elimina una clip del proprio account. Ritorna true se esisteva ed e' stata
// rimossa, false se non esisteva o apparteneva a un altro account (stesso
// comportamento di eliminaConcorrente: nessuna riga toccata, nessun errore).
function eliminaClip(db, id, userId) {
  const info = db.prepare(`DELETE FROM clip WHERE id = ? AND user_id = ?`)
    .run(Number(id), Number(userId));
  return info.changes > 0;
}

// Una riga per PDF di provenienza, piu' una per le righe senza provenienza
// (fileOrigine: null). In SQLite GROUP BY mette tutti i NULL in un unico
// gruppo (al contrario degli indici UNIQUE, dove sono distinti): e' proprio
// quello che serve per raccogliere le righe pre-esistenti in un gruppo solo,
// senza inventargli un PDF che non hanno mai avuto.
function gruppiClip(db, userId) {
  return db.prepare(`
    SELECT file_origine AS fileOrigine, COUNT(*) AS n, MAX(data_import) AS dataUltimo
    FROM clip WHERE user_id = ?
    GROUP BY file_origine
    ORDER BY dataUltimo DESC
  `).all(Number(userId));
}

// Elimina tutte le clip di un PDF in blocco: l'unica via per ripulire un
// listino sbagliato senza passare riga per riga (vedi eliminaClip). fileOrigine
// puo' essere null (il gruppo senza provenienza): in SQL "= NULL" non e' mai
// vero, quindi va cercato con IS NULL. Un solo WHERE per entrambi i casi,
// stessa forma di gruppiClip/listaAnalizzatori.
function eliminaGruppoClip(db, fileOrigine, userId) {
  const fileOk = fileOrigine == null ? null : String(fileOrigine);
  const info = db.prepare(`
    DELETE FROM clip
    WHERE user_id = ? AND (file_origine = ? OR (? IS NULL AND file_origine IS NULL))
  `).run(Number(userId), fileOk, fileOk);
  return { eliminate: info.changes };
}

module.exports = {
  ensureSchema, leggiPezzi, sembraClip, upsertClip, listaClip, eliminaClip, gruppiClip,
  eliminaGruppoClip
};
