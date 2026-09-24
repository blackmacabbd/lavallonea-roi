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

const { trovaOCreaConcorrente } = require('./concorrenti');

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
  //
  // Tutta la sequenza (i due DROP piu' le quattro CREATE) sta in una sola
  // transazione: prima girava fuori da qualunque BEGIN, e un guasto a meta'
  // (un lock, il disco pieno, un interrupt all'avvio) poteva lasciare la
  // tabella SENZA alcuna unicita' — i due indici vecchi gia' tolti, i nuovi
  // non ancora tutti creati — col rischio che il prossimo import duplichi
  // righe in silenzio proprio li' dove dovrebbe impedirlo. Con un solo
  // BEGIN/COMMIT un fallimento in qualunque punto fa ROLLBACK dell'intera
  // sequenza, mai uno stato a meta'.
  db.exec('BEGIN');
  try {
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
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

// Le clip scritte a mano in un calcolo entrano nel listino scelto al momento
// del salvataggio, ma SOLO quelle che il listino non ha gia'. Una clip gia' in
// listino non si tocca: il listino importato resta la fonte, e un calcolo fatto
// con uno sconto particolare non deve riscriverlo per tutti i calcoli futuri.
//
// Due casi in cui non si fa niente, ed e' voluto:
//  - nessun listino scritto: non c'e' un posto dove metterla, e inventarne uno
//    e' peggio del non fare niente;
//  - un listino che non esiste (un nome scritto male): crearlo dal nulla lo
//    renderebbe indistinguibile da uno vero nella tendina, e l'operatore si
//    ritroverebbe un listino fantasma nato da un errore di battitura.
// Il listino si riconosce dal fatto di avere gia' almeno una clip: e' la stessa
// definizione che usa gruppiClip per costruire l'elenco dei listini.
function aggiungiClipMancanti(db, dati) {
  const { userId, fileOrigine, righe } = dati || {};
  if (userId == null) throw new Error('userId mancante');
  const file = String(fileOrigine == null ? '' : fileOrigine).trim();
  if (!file) return { aggiunte: 0 };

  // Il laboratorio della clip nuova e' quello del listino in cui entra: la
  // colonna «Laboratorio» del calcolatore e' una nota libera dell'operatore e
  // non decide di chi e' la clip.
  const esistente = db.prepare(`
    SELECT concorrente_id FROM clip WHERE user_id = ? AND file_origine = ? LIMIT 1
  `).get(Number(userId), file);
  if (!esistente) return { aggiunte: 0 };

  const gia = db.prepare(`
    SELECT 1 FROM clip WHERE user_id = ? AND file_origine = ? AND nome = ?
  `);

  let aggiunte = 0;
  for (const r of (righe || [])) {
    const nome = String((r && r.nome) == null ? '' : r.nome).trim();
    const prezzo = (r && r.prezzoConfezione) == null || r.prezzoConfezione === ''
      ? NaN : Number(r.prezzoConfezione);
    if (!nome || !Number.isFinite(prezzo) || prezzo < 0) continue;
    if (gia.get(Number(userId), file, nome)) continue;
    upsertClip(db, {
      userId, concorrenteId: esistente.concorrente_id, nome,
      prezzoConfezione: prezzo,
      pezzi: r.pezzi === '' || r.pezzi == null ? null : Number(r.pezzi),
      sconto: r.sconto === '' || r.sconto == null ? null : Number(r.sconto),
      fonte: 'calcolo', fileOrigine: file
    });
    aggiunte++;
  }
  return { aggiunte };
}

// Import Excel di un listino macchinari: stessa forma di upsertConcorrente
// (lib/concorrenti.js) applicata al catalogo clip invece che agli esami
// concorrente. Il laboratorio si trova o si crea (mai letto dal file: lo
// dichiara l'operatore in fase di import, come per il PDF), poi ogni riga
// valida entra come clip in UNA transazione sola — un fallimento a meta'
// listino non deve lasciare solo alcune clip scritte.
//
// Le righe arrivano gia' come { nome, prezzoConfezione, pezzi }: il parsing
// delle celle (virgola decimale, colonna pezzi assente) e' compito di chi
// chiama (vedi server.js), qui si valida solo cio' che rende una riga
// scrivibile. Una riga senza nome o senza un prezzo valido (numero finito e
// non negativo) viene scartata; un prezzo di confezione senza pezzi resta
// comunque una clip valida (pezzi entra NULL, mai forzato a 1: quell'uno e'
// un'assunzione del calcolatore, non un fatto del catalogo).
function importaListinoExcel(db, dati) {
  const { userId, nomeLaboratorio, fileOrigine, righe } = dati || {};
  if (userId == null) throw new Error('userId mancante');

  // Stesso codice/testo usato dal ramo 'clip' dell'import PDF
  // (server.js, POST /api/import-pdf/:id/conferma): stessa mancanza, stesso
  // messaggio, cosi' il client la traduce allo stesso modo in entrambi i
  // flussi senza bisogno di una seconda chiave i18n.
  const nomeLab = String(nomeLaboratorio == null ? '' : nomeLaboratorio).trim();
  if (!nomeLab) {
    const err = new Error('Manca il nome del laboratorio');
    err.codice = 'NOME_LABORATORIO_MANCANTE';
    throw err;
  }

  const fileOk = fileOrigine == null || fileOrigine === '' ? null : String(fileOrigine);

  // Prima si decide quali righe sono scrivibili, POI si tocca il database.
  // Prima il laboratorio veniva creato subito e fuori dalla transazione: con un
  // file dalle colonne sbagliate (tutte le righe scartate) restava un
  // laboratorio vuoto, che poi compariva fra i concorrenti degli esami senza
  // nessun esame — lo stesso problema gia' visto col CDVET.
  let scartate = 0;
  const valide = [];
  const nomiVisti = new Set();
  let doppioni = 0;
  for (const r of (righe || [])) {
    const nome = String((r && r.nome) == null ? '' : r.nome).trim();
    const prezzo = (r && r.prezzoConfezione) == null || r.prezzoConfezione === ''
      ? NaN : Number(r.prezzoConfezione);
    if (!nome || !Number.isFinite(prezzo) || prezzo < 0) { scartate++; continue; }
    // Lo stesso nome due volte nello stesso file finirebbe sulla stessa riga
    // del catalogo (l'unicita' e' laboratorio + nome + file): la seconda
    // sovrascriverebbe la prima. Si tiene la prima e si conta il doppione,
    // cosi' il risultato dice quante clip ci sono davvero e non quante righe
    // sono state lette.
    if (nomiVisti.has(nome)) { doppioni++; continue; }
    nomiVisti.add(nome);
    // I pezzi sono un intero positivo o niente: 0, negativi e decimali non
    // sono un numero di pezzi. Niente vuol dire NULL, mai 1.
    const p = (r && r.pezzi) == null || r.pezzi === '' ? NaN : Number(r.pezzi);
    valide.push({ nome, prezzo, pezzi: Number.isInteger(p) && p > 0 ? p : null });
  }

  if (!valide.length) {
    const err = new Error('Nessuna riga importabile nell\'elenco confermato');
    err.codice = 'NESSUNA_RIGA_IMPORTABILE';
    throw err;
  }

  let lab;
  db.exec('BEGIN');
  try {
    // Il laboratorio nasce dentro la stessa transazione delle sue clip: o
    // entrano entrambi, o nessuno dei due.
    lab = trovaOCreaConcorrente(db, nomeLab, userId);
    for (const v of valide) {
      upsertClip(db, {
        userId, concorrenteId: lab.id, nome: v.nome, prezzoConfezione: v.prezzo,
        pezzi: v.pezzi, sconto: null, fonte: 'excel', fileOrigine: fileOk
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { concorrenteId: lab.id, importate: valide.length, scartate, doppioni };
}

module.exports = {
  ensureSchema, leggiPezzi, sembraClip, upsertClip, listaClip, eliminaClip, gruppiClip,
  eliminaGruppoClip, aggiungiClipMancanti, importaListinoExcel
};
