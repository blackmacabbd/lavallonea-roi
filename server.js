'use strict';

const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const { DatabaseSync } = require('node:sqlite');
const path     = require('path');
const fs       = require('fs');
const piani = require('./lib/piani');
const concorrenti = require('./lib/concorrenti');
const pdfimport = require('./lib/pdfimport');
const auth = require('./lib/auth');
const mailer = require('./lib/mailer');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'direttorecommerciale@mylav.net').trim().toLowerCase();
function isAdmin(user) { return !!user && !!user.email && user.email.toLowerCase() === ADMIN_EMAIL; }

const DB_PATH     = process.env.DB_PATH     || path.join(__dirname, 'db', 'database.sqlite');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Database ───────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS strutture (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS file_caricati (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    struttura_id INTEGER REFERENCES strutture(id),
    nome_file    TEXT,
    data_carico  DATETIME DEFAULT CURRENT_TIMESTAMP,
    path_file    TEXT
  );

  CREATE TABLE IF NOT EXISTS dati_foglio (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id                     INTEGER REFERENCES file_caricati(id),
    foglio                      TEXT,
    esame                       TEXT,
    n_esami                     INTEGER DEFAULT 1,
    listino_concorrenza         REAL,
    totale_concorrenza          REAL,
    prezzo_scontato_concorrenza REAL,
    listino_lav                 REAL,
    totale_listino_lav          REAL,
    prezzo_scontato_lav         REAL,
    totale_scontato_lav         REAL,
    risparmio_dottore           REAL,
    sconto_concorrenza          REAL,
    sconto_lav                  REAL
  );
`);

// Migrazione additiva: aggiunge user_id alle tabelle dati se manca. Mai distruttiva.
function addColIfMissing(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColIfMissing('strutture', 'user_id', 'INTEGER');

// Migrazione non distruttiva: rimuove il vincolo UNIQUE globale su strutture.nome
// (DB creati prima della fix avevano "nome TEXT UNIQUE NOT NULL", che rompe
// l'isolamento per utente). SQLite non supporta DROP di un vincolo UNIQUE via
// ALTER, quindi si ricostruisce la tabella preservando gli id (referenziati da
// file_caricati.struttura_id). Idempotente: gira solo se l'indice unique esiste
// ancora.
function migrateStruttureDropGlobalUnique(db) {
  const indici = db.prepare(`PRAGMA index_list('strutture')`).all();
  const haUniqueSuNome = indici.some(idx => {
    if (!idx.unique) return false;
    const cols = db.prepare(`PRAGMA index_info('${idx.name}')`).all();
    return cols.length === 1 && cols[0].name === 'nome';
  });
  if (!haUniqueSuNome) return;

  // file_caricati.struttura_id REFERENCES strutture(id): con foreign_keys=ON
  // (default in node:sqlite) il DROP TABLE fallirebbe per violazione FK finche'
  // esistono righe che puntano a strutture. Le PRAGMA non sono transazionali,
  // quindi si disattivano/riattivano fuori dalla BEGIN/COMMIT, seguendo la
  // procedura standard SQLite per la ricostruzione di tabelle referenziate.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE strutture_new (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          nome    TEXT NOT NULL,
          user_id INTEGER
        );
      `);
      db.exec(`INSERT INTO strutture_new (id, nome, user_id) SELECT id, nome, user_id FROM strutture;`);
      db.exec(`DROP TABLE strutture;`);
      db.exec(`ALTER TABLE strutture_new RENAME TO strutture;`);
      db.exec('COMMIT');
      console.log('  ✓ Migrazione strutture: rimosso vincolo UNIQUE globale su nome');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
migrateStruttureDropGlobalUnique(db);

// ── Piani di scontistica ────────────────────────────
piani.ensureSchema(db);
try {
  const seedPath = path.join(__dirname, 'piani_sconto_esami_2026.json');
  if (fs.existsSync(seedPath)) {
    const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const seedResult = piani.seedFromJson(db, seedData);
    if (seedResult.seeded) {
      console.log(`  ✓ Seed piani sconto: ${seedResult.piani} piani, ${seedResult.esami} esami`);
    }
  }
} catch (err) {
  console.error('Seed piani sconto fallito:', err.message);
}

// ── Concorrenza ─────────────────────────────────────
concorrenti.ensureSchema(db);
addColIfMissing('concorrenti', 'user_id', 'INTEGER');

// ── Autenticazione ──────────────────────────────────
auth.ensureSchema(db);
addColIfMissing('prezzi_esami_custom', 'user_id', 'INTEGER');

// I dati creati prima degli account non hanno proprietario: rimuovili una sola volta.
try {
  const orfane = db.prepare(`SELECT id FROM strutture WHERE user_id IS NULL`).all().map(r => r.id);
  if (orfane.length) {
    const fileIds = db.prepare(`SELECT id FROM file_caricati WHERE struttura_id IN (${orfane.map(()=>'?').join(',')})`).all(...orfane).map(r => r.id);
    if (fileIds.length) db.exec(`DELETE FROM dati_foglio WHERE file_id IN (${fileIds.join(',')})`);
    db.exec(`DELETE FROM file_caricati WHERE struttura_id IN (${orfane.join(',')})`);
    db.exec(`DELETE FROM strutture WHERE user_id IS NULL`);
  }
  db.exec(`DELETE FROM esami_concorrente WHERE concorrente_id IN (SELECT id FROM concorrenti WHERE user_id IS NULL)`);
  db.exec(`DELETE FROM concorrenti WHERE user_id IS NULL`);
  db.exec(`DELETE FROM prezzi_esami_custom WHERE user_id IS NULL`);
} catch (e) { console.error('Pulizia legacy:', e.message); }

// ── Multer ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.xlsx?$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Solo file Excel (.xlsx, .xls)'));
  }
});
const uploadPdf = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Solo file PDF'));
  }
});

// ── Auth middleware ────────────────────────────────
function userFromToken(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-auth-token'] || '');
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  return row || null;
}
function requireAuth(req, res, next) {
  const u = userFromToken(req);
  if (!u) return res.status(401).json({ error: 'Autenticazione richiesta' });
  req.user = u; next();
}
function optionalAuth(req, res, next) { req.user = userFromToken(req); next(); }
function requireAdmin(req, res, next) {
  const u = userFromToken(req);
  if (!u) return res.status(401).json({ error: 'Autenticazione richiesta' });
  if (u.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'Solo l\'amministratore può modificare il catalogo' });
  req.user = u; next();
}

// ── Excel helpers ──────────────────────────────────
const norm = piani.norm;

function findCol(headers, ...terms) {
  for (const term of terms) {
    const t = norm(term);
    const idx = headers.findIndex(h => h && norm(h).includes(t));
    if (idx !== -1) return idx;
  }
  return -1;
}

function toNum(val) {
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function isSkipRow(esame) {
  if (!esame) return true;
  const s = String(esame).toLowerCase().trim();
  return s === '' || s.includes('total') || s.includes('differenz') || s.includes('esami');
}

/**
 * Foglio 1:
 * D: listino vet med (listino_concorrenza)
 * E: prezzo vet med  (prezzo_scontato_concorrenza)
 * G: Listino lav     (listino_lav)
 * H: prezzo lav      (prezzo_scontato_lav)
 * n_esami = 1 sempre
 */
function parseFoglio1(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) return { struttura: null, rows: [] };

  let hRow = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i].some(c => String(c).toUpperCase().trim() === 'ESAMI')) { hRow = i; break; }
  }
  if (hRow === -1) {
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      if (rows[i].filter(c => c !== '').length >= 3) { hRow = i; break; }
    }
  }
  if (hRow === -1) return { struttura: null, rows: [] };

  const headers = rows[hRow].map(h => String(h || ''));
  const cEsame   = findCol(headers, 'ESAMI');
  const cListVet = findCol(headers, 'listino vet');
  const cPrezVet = findCol(headers, 'prezzo vet');
  const cListLav = findCol(headers, 'listino lav');
  const cPrezLav = findCol(headers, 'prezzo lav');

  let struttura = null;
  for (let i = hRow + 1; i < rows.length; i++) {
    const v = rows[i][0];
    if (v && String(v).trim()) { struttura = String(v).trim(); break; }
  }

  const result = [];
  for (let i = hRow + 1; i < rows.length; i++) {
    const row  = rows[i];
    const esame = cEsame >= 0 ? row[cEsame] : row[2];
    if (isSkipRow(esame)) continue;

    const listConc  = cListVet >= 0 ? toNum(row[cListVet]) : 0;
    const prezConc  = cPrezVet >= 0 ? toNum(row[cPrezVet]) : 0;
    const listLav   = cListLav >= 0 ? toNum(row[cListLav]) : 0;
    const prezLav   = cPrezLav >= 0 ? toNum(row[cPrezLav]) : 0;

    result.push({
      esame:                       String(esame).trim(),
      n_esami:                     1,
      listino_concorrenza:         listConc,
      totale_concorrenza:          listConc,
      prezzo_scontato_concorrenza: prezConc,
      listino_lav:                 listLav,
      totale_listino_lav:          listLav,
      prezzo_scontato_lav:         prezLav,
      totale_scontato_lav:         prezLav,
      risparmio_dottore:           prezConc - prezLav,
      sconto_concorrenza:          listConc - prezConc,
      sconto_lav:                  listLav  - prezLav
    });
  }

  return { struttura, rows: result };
}

/**
 * Platinum / Gold:
 * E: Costo esami             (listino_concorrenza)
 * F: Totale costo esami      (totale_concorrenza = E × N)
 * G: prezzo vet med scontato (prezzo_scontato_concorrenza)
 * I: LISTINO LAVALLONEA      (listino_lav)
 * J: TOTALE LISTINO          (totale_listino_lav = I × N)
 * K: prezzo lav. platinum/gold (prezzo_scontato_lav)
 * L: totale prezzo lav       (totale_scontato_lav = K × N)
 */
function parsePlatinumGold(sheet, tipoFoglio) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) return { struttura: null, rows: [] };

  let hRow = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i].some(c => String(c).toUpperCase().trim() === 'ESAMI')) { hRow = i; break; }
  }
  if (hRow === -1) {
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      if (rows[i].filter(c => c !== '').length >= 4) { hRow = i; break; }
    }
  }
  if (hRow === -1) return { struttura: null, rows: [] };

  const headers = rows[hRow].map(h => String(h || ''));

  const cEsame      = findCol(headers, 'ESAMI');
  const cNEsami     = findCol(headers, 'n. esami', 'n esami', 'num esami');
  const cCosto      = findCol(headers, 'costo esami');
  const cTotCosto   = findCol(headers, 'totale costo esami', 'totale costo');
  const cPrezVetSc  = findCol(headers, 'prezzo vet med scontato', 'prezzo vet scontato', 'prezzo vet med');
  const cListLav    = findCol(headers, 'listino lavallonea', 'listino lav');
  const cTotListLav = findCol(headers, 'totale listino');
  const cPrezLav    = findCol(headers,
    `prezzo lav. ${tipoFoglio.toLowerCase()}`,
    `prezzo lav. ${tipoFoglio}`,
    'prezzo lav'
  );
  const cTotPrezLav = findCol(headers,
    'totale prezzo lav',
    tipoFoglio === 'Platinum' ? 'totale prezzo lav. plat' : 'totale prezzo lav. gold'
  );

  let struttura = null;
  for (let i = hRow + 1; i < rows.length; i++) {
    const v = rows[i][0];
    if (v && String(v).trim()) { struttura = String(v).trim(); break; }
  }

  const result = [];
  for (let i = hRow + 1; i < rows.length; i++) {
    const row  = rows[i];
    const esame = cEsame >= 0 ? row[cEsame] : row[2];
    if (isSkipRow(esame)) continue;

    const nEsami    = cNEsami     >= 0 ? (parseInt(row[cNEsami])     || 1) : 1;
    const listConc  = cCosto      >= 0 ? toNum(row[cCosto])           : 0;
    const totConc   = cTotCosto   >= 0 ? toNum(row[cTotCosto])        : listConc * nEsami;
    const prezConc  = cPrezVetSc  >= 0 ? toNum(row[cPrezVetSc])       : 0;
    const listLav   = cListLav    >= 0 ? toNum(row[cListLav])          : 0;
    const totListLav = cTotListLav >= 0 ? toNum(row[cTotListLav])     : listLav * nEsami;
    const prezLav   = cPrezLav    >= 0 ? toNum(row[cPrezLav])          : 0;
    const totPrezLav = cTotPrezLav >= 0 ? toNum(row[cTotPrezLav])     : prezLav * nEsami;

    result.push({
      esame:                       String(esame).trim(),
      n_esami:                     nEsami,
      listino_concorrenza:         listConc,
      totale_concorrenza:          totConc,
      prezzo_scontato_concorrenza: prezConc,
      listino_lav:                 listLav,
      totale_listino_lav:          totListLav,
      prezzo_scontato_lav:         prezLav,
      totale_scontato_lav:         totPrezLav,
      risparmio_dottore:           prezConc - totPrezLav,
      sconto_concorrenza:          totConc  - prezConc,
      sconto_lav:                  totListLav - totPrezLav
    });
  }

  return { struttura, rows: result };
}

/**
 * Parsing generico di un listino concorrente: trova la prima riga con almeno
 * 2 celle non vuote come header, poi rileva per keyword le colonne
 * nome esame / prezzo / sconto (sconto puo' mancare del tutto).
 */
function parseConcorrenteExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (allRows.length < 2) return { headers: [], rows: [], colEsame: -1, colPrezzo: -1, colSconto: -1 };

  let hRow = -1;
  for (let i = 0; i < Math.min(8, allRows.length); i++) {
    if (allRows[i].filter(c => String(c).trim() !== '').length >= 2) { hRow = i; break; }
  }
  if (hRow === -1) return { headers: [], rows: [], colEsame: -1, colPrezzo: -1, colSconto: -1 };

  const headers = allRows[hRow].map(h => String(h || ''));
  const colEsame  = findCol(headers, 'esame', 'test', 'nome', 'descrizione');
  const colPrezzo = findCol(headers, 'prezzo', 'listino', 'price');
  const colSconto = findCol(headers, 'sconto', 'discount', '%');

  const rows = allRows.slice(hRow + 1).filter(r => r.some(c => String(c).trim() !== ''));
  return { headers, rows, colEsame, colPrezzo, colSconto };
}

function calcolaTotali(dati) {
  const t = dati.reduce((acc, d) => {
    acc.totale_concorrenza          += d.totale_concorrenza          || 0;
    acc.prezzo_scontato_concorrenza += d.prezzo_scontato_concorrenza || 0;
    acc.totale_listino_lav          += d.totale_listino_lav          || 0;
    acc.totale_scontato_lav         += d.totale_scontato_lav         || 0;
    acc.sconto_totale_concorrenza   += d.sconto_concorrenza          || 0;
    acc.sconto_totale_lav           += d.sconto_lav                  || 0;
    return acc;
  }, {
    totale_concorrenza: 0,
    prezzo_scontato_concorrenza: 0,
    totale_listino_lav: 0,
    totale_scontato_lav: 0,
    sconto_totale_concorrenza: 0,
    sconto_totale_lav: 0
  });

  t.risparmio_totale_dottore = t.prezzo_scontato_concorrenza - t.totale_scontato_lav;
  t.risparmio_pct = t.prezzo_scontato_concorrenza > 0
    ? +((t.risparmio_totale_dottore / t.prezzo_scontato_concorrenza) * 100).toFixed(1)
    : 0;
  return t;
}

// ── Middleware ─────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/chart.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.min.js'));
});

// ── Rate limiting (best-effort, in-memory, nessuna dipendenza) ─────────────
// Finestra scorrevole per IP + email/marker: max RATE_LIMIT_MAX tentativi ogni
// RATE_LIMIT_WINDOW_MS. Pensato per le rotte di autenticazione (login, reset,
// recover); non e' persistente e si azzera al riavvio del processo — accettabile
// per una protezione "best effort" contro brute-force banali.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateLimitHits = new Map(); // chiave -> array di timestamp (ms)

function rateLimitKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const marker = auth.normEmail(req.body?.email) || 'anon';
  return ip + ':' + marker;
}

function rateLimitCheck(key) {
  const now = Date.now();
  let hits = rateLimitHits.get(key);
  if (!hits) { hits = []; rateLimitHits.set(key, hits); }
  while (hits.length && now - hits[0] > RATE_LIMIT_WINDOW_MS) hits.shift();
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  return true;
}

function rateLimitReset(key) { rateLimitHits.delete(key); }

// Pulizia periodica delle chiavi scadute (facoltativa, evita crescita illimitata
// della Map su processi a lunga vita). unref() cosi' non tiene vivo il processo.
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitHits) {
    while (hits.length && now - hits[0] > RATE_LIMIT_WINDOW_MS) hits.shift();
    if (hits.length === 0) rateLimitHits.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS);
if (typeof rateLimitCleanup.unref === 'function') rateLimitCleanup.unref();

function authRateLimit(req, res, next) {
  const key = rateLimitKey(req);
  if (!rateLimitCheck(key)) {
    return res.status(429).json({ error: 'Troppi tentativi, riprova più tardi' });
  }
  req._rateLimitKey = key;
  next();
}

// ── Auth ────────────────────────────────────────────
app.post('/api/auth/register', express.json(), async (req, res) => {
  try {
    const email = auth.normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email non valida' });
    const pv = auth.validaPassword(password);
    if (!pv.ok) return res.status(400).json({ error: pv.motivo });
    if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) return res.status(409).json({ error: 'Email già registrata' });

    const recoveryCode = auth.genRecoveryCode();
    const info = db.prepare(`INSERT INTO users (email, pass_hash, recovery_hash, recovery_lookup) VALUES (?, ?, ?, ?)`)
      .run(email, auth.hashPassword(password), auth.hashPassword(recoveryCode), auth.lookupHash(recoveryCode));
    const userId = Number(info.lastInsertRowid);
    const token = auth.genToken();
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`).run(token, userId);

    const tpl = mailer.templateRecovery(recoveryCode);
    mailer.sendMail({ to: email, subject: tpl.subject, html: tpl.html }).catch(() => {});
    res.json({ token, email, recoveryCode, isAdmin: isAdmin({ email }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', authRateLimit, express.json(), (req, res) => {
  try {
    const email = auth.normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!u || !auth.verifyPassword(password, u.pass_hash)) return res.status(401).json({ error: 'Email o password errati' });
    rateLimitReset(req._rateLimitKey);
    const token = auth.genToken();
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`).run(token, u.id);
    res.json({ token, email: u.email, isAdmin: isAdmin(u) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-auth-token'] || '');
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ email: req.user.email, isAdmin: isAdmin(req.user) }));

app.post('/api/auth/request-reset', authRateLimit, express.json(), async (req, res) => {
  try {
    const email = auth.normEmail(req.body?.email);
    const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (u) {
      const code = auth.genResetCode();
      db.prepare(`INSERT INTO reset_codes (user_id, code, expires_at) VALUES (?, ?, ?)`)
        .run(u.id, code, Date.now() + 30 * 60 * 1000);
      const tpl = mailer.templateReset(code);
      mailer.sendMail({ to: email, subject: tpl.subject, html: tpl.html }).catch(() => {});
    }
    res.json({ ok: true }); // risposta generica: niente user-enumeration
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', authRateLimit, express.json(), (req, res) => {
  try {
    const email = auth.normEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const pv = auth.validaPassword(String(req.body?.newPassword || ''));
    if (!pv.ok) return res.status(400).json({ error: pv.motivo });
    const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!u) return res.status(400).json({ error: 'Codice non valido' });
    const rc = db.prepare(`SELECT * FROM reset_codes WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC`)
      .get(u.id, code, Date.now());
    if (!rc) return res.status(400).json({ error: 'Codice non valido o scaduto' });
    db.prepare(`UPDATE users SET pass_hash = ? WHERE id = ?`).run(auth.hashPassword(req.body.newPassword), u.id);
    db.prepare(`UPDATE reset_codes SET used = 1 WHERE id = ?`).run(rc.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/recover-full', authRateLimit, express.json(), (req, res) => {
  try {
    const recoveryCode = String(req.body?.recoveryCode || '');
    const newEmail = auth.normEmail(req.body?.newEmail);
    const pv = auth.validaPassword(String(req.body?.newPassword || ''));
    if (!pv.ok) return res.status(400).json({ error: pv.motivo });
    if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return res.status(400).json({ error: 'Email non valida' });
    const u = db.prepare(`SELECT * FROM users WHERE recovery_lookup = ?`).get(auth.lookupHash(recoveryCode));
    if (!u || !auth.verifyPassword(recoveryCode, u.recovery_hash)) return res.status(400).json({ error: 'Codice di recupero non valido' });
    const other = db.prepare(`SELECT 1 FROM users WHERE email = ? AND id <> ?`).get(newEmail, u.id);
    if (other) return res.status(409).json({ error: 'Email già in uso da un altro account' });
    db.prepare(`UPDATE users SET email = ?, pass_hash = ? WHERE id = ?`).run(newEmail, auth.hashPassword(req.body.newPassword), u.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DEBUG ──────────────────────────────────────────
app.post('/api/debug', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const result = {};
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      let hRow = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i].some(c => String(c).toUpperCase().trim() === 'ESAMI') ||
            rows[i].filter(c => c !== '').length >= 3) { hRow = i; break; }
      }
      const headers = hRow >= 0 ? rows[hRow].map((h, i) => `[${i}] "${h}"`) : [];
      const sample  = rows.slice(hRow + 1, hRow + 4).map(r => r.slice(0, 12));
      result[sheetName] = { hRow, headers, sample };
    }
    fs.unlinkSync(req.file.path);
    res.json(result);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch(_) {}
    res.status(500).json({ error: e.message });
  }
});

// ── API ────────────────────────────────────────────

app.get('/api/strutture', requireAuth, (req, res) => {
  try {
    const strutture = db.prepare('SELECT * FROM strutture WHERE user_id = ? ORDER BY nome').all(req.user.id);
    const result = strutture.map(s => {
      const fileCnt = db.prepare('SELECT COUNT(*) as cnt FROM file_caricati WHERE struttura_id = ?').get(s.id).cnt;
      const fogli = db.prepare(`
        SELECT DISTINCT df.foglio
        FROM dati_foglio df
        JOIN file_caricati fc ON df.file_id = fc.id
        WHERE fc.struttura_id = ?
        ORDER BY df.foglio
      `).all(s.id).map(r => r.foglio);
      return { ...s, file_count: fileCnt, fogli };
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/strutture/:id/file', requireAuth, (req, res) => {
  try {
    const owned = db.prepare('SELECT 1 FROM strutture WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'Struttura non trovata' });

    const files = db.prepare(`
      SELECT fc.*,
        GROUP_CONCAT(DISTINCT df.foglio) as fogli
      FROM file_caricati fc
      LEFT JOIN dati_foglio df ON df.file_id = fc.id
      WHERE fc.struttura_id = ?
      GROUP BY fc.id
      ORDER BY fc.data_carico DESC
    `).all(req.params.id);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file/:id/dati', requireAuth, (req, res) => {
  try {
    const { foglio } = req.query;
    if (!foglio) return res.status(400).json({ error: 'Parametro foglio mancante' });

    const owned = db.prepare(`
      SELECT 1 FROM file_caricati fc
      JOIN strutture s ON s.id = fc.struttura_id
      WHERE fc.id = ? AND s.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'File non trovato' });

    const dati = db.prepare(
      'SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ? ORDER BY id'
    ).all(req.params.id, foglio);

    const totali = calcolaTotali(dati);

    const fileInfo = db.prepare(`
      SELECT fc.*, s.nome as struttura_nome
      FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      WHERE fc.id = ?
    `).get(req.params.id);

    res.json({ dati, totali, file: fileInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/strutture/:id/aggregato', requireAuth, (req, res) => {
  try {
    const struttura = db.prepare('SELECT * FROM strutture WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!struttura) return res.status(404).json({ error: 'Struttura non trovata' });

    const files = db.prepare('SELECT * FROM file_caricati WHERE struttura_id = ? ORDER BY data_carico').all(req.params.id);
    const result = files.map(f => {
      const fogli = db.prepare('SELECT DISTINCT foglio FROM dati_foglio WHERE file_id = ?').all(f.id).map(r => r.foglio);
      const foglioData = {};
      fogli.forEach(foglio => {
        const dati = db.prepare('SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ?').all(f.id, foglio);
        foglioData[foglio] = calcolaTotali(dati);
      });
      return { file: f, fogli: foglioData };
    });

    res.json({ struttura, files: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', optionalAuth, (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        strutture_count: 0,
        file_count: 0,
        differenziale_totale: 0,
        ultimi_file: [],
        per_struttura: []
      });
    }

    const strutture_count = db.prepare('SELECT COUNT(*) as cnt FROM strutture WHERE user_id = ?').get(req.user.id).cnt;
    const file_count      = db.prepare(`
      SELECT COUNT(*) as cnt FROM file_caricati fc
      JOIN strutture s ON s.id = fc.struttura_id
      WHERE s.user_id = ?
    `).get(req.user.id).cnt;

    const diffRow = db.prepare(`
      SELECT SUM(df.risparmio_dottore) as totale
      FROM dati_foglio df
      JOIN file_caricati fc ON df.file_id = fc.id
      JOIN strutture s ON s.id = fc.struttura_id
      WHERE s.user_id = ?
    `).get(req.user.id);
    const differenziale_totale = diffRow.totale || 0;

    const ultimi_file = db.prepare(`
      SELECT fc.*, s.nome as struttura_nome
      FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      WHERE s.user_id = ?
      ORDER BY fc.data_carico DESC LIMIT 5
    `).all(req.user.id);

    const per_struttura = db.prepare(`
      SELECT s.nome,
        SUM(df.prezzo_scontato_concorrenza) as fatturato,
        SUM(df.totale_scontato_lav)         as costo
      FROM dati_foglio df
      JOIN file_caricati fc ON df.file_id = fc.id
      JOIN strutture s ON fc.struttura_id = s.id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.nome
    `).all(req.user.id);

    res.json({ strutture_count, file_count, differenziale_totale, ultimi_file, per_struttura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cronologia', requireAuth, (req, res) => {
  try {
    const { struttura_id } = req.query;
    const where  = struttura_id ? 'AND fc.struttura_id = ?' : '';
    const params = struttura_id ? [req.user.id, struttura_id] : [req.user.id];

    const rows = db.prepare(`
      SELECT
        fc.id, fc.nome_file, fc.data_carico,
        s.id   as struttura_id,
        s.nome as struttura_nome,
        GROUP_CONCAT(DISTINCT df.foglio)            as fogli,
        SUM(df.prezzo_scontato_concorrenza)         as totale_dottore,
        SUM(df.totale_scontato_lav)                 as totale_costo,
        SUM(df.risparmio_dottore)                   as differenziale
      FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      LEFT JOIN dati_foglio df ON df.file_id = fc.id
      WHERE s.user_id = ? ${where}
      GROUP BY fc.id
      ORDER BY fc.data_carico DESC
    `).all(...params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/confronto', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        s.id, s.nome,
        SUM(df.totale_concorrenza)          as totale_concorrenza,
        SUM(df.prezzo_scontato_concorrenza) as prezzo_scontato_concorrenza,
        SUM(df.totale_listino_lav)          as totale_listino_lav,
        SUM(df.totale_scontato_lav)         as totale_scontato_lav,
        SUM(df.risparmio_dottore)           as risparmio_totale
      FROM strutture s
      JOIN file_caricati fc ON fc.struttura_id = s.id
      JOIN dati_foglio df   ON df.file_id = fc.id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.nome
    `).all(req.user.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Upload ─────────────────────────────────────────
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  try {
    const wb = XLSX.readFile(req.file.path);
    const datiPerFoglio = {};
    let strutturaNome   = null;

    for (const sheetName of wb.SheetNames) {
      const name = sheetName.trim();
      try {
        if (name === 'Foglio 1' || name === 'Foglio1') {
          const p = parseFoglio1(wb.Sheets[sheetName]);
          if (p.struttura && !strutturaNome) strutturaNome = p.struttura;
          if (p.rows.length > 0) datiPerFoglio['Foglio 1'] = p.rows;
        } else if (name.toLowerCase() === 'platinum') {
          const p = parsePlatinumGold(wb.Sheets[sheetName], 'Platinum');
          if (p.struttura && !strutturaNome) strutturaNome = p.struttura;
          if (p.rows.length > 0) datiPerFoglio['Platinum'] = p.rows;
        } else if (name.toLowerCase() === 'gold') {
          const p = parsePlatinumGold(wb.Sheets[sheetName], 'Gold');
          if (p.struttura && !strutturaNome) strutturaNome = p.struttura;
          if (p.rows.length > 0) datiPerFoglio['Gold'] = p.rows;
        }
      } catch (sheetErr) {
        console.error(`Errore foglio "${sheetName}":`, sheetErr.message);
      }
    }

    if (!strutturaNome || Object.keys(datiPerFoglio).length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Struttura o dati non trovati nel file.' });
    }

    strutturaNome = strutturaNome.trim();

    const dup = db.prepare(`
      SELECT fc.id FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      WHERE fc.nome_file = ? AND s.nome = ? AND s.user_id = ?
    `).get(req.file.originalname, strutturaNome, req.user.id);

    if (dup && !req.body.force) {
      return res.status(409).json({
        conflict: true,
        struttura: strutturaNome,
        message: `File "${req.file.originalname}" già presente per "${strutturaNome}". Sovrascrivere?`
      });
    }

    let result;
    db.exec('BEGIN');
    try {
      let strutturaRow = db.prepare('SELECT id FROM strutture WHERE nome = ? AND user_id = ?').get(strutturaNome, req.user.id);
      if (!strutturaRow) {
        const r = db.prepare('INSERT INTO strutture (nome, user_id) VALUES (?, ?)').run(strutturaNome, req.user.id);
        strutturaRow = { id: Number(r.lastInsertRowid) };
      }

      const fileRow = db.prepare(`
        INSERT INTO file_caricati (struttura_id, nome_file, path_file)
        VALUES (?, ?, ?)
      `).run(strutturaRow.id, req.file.originalname, req.file.path);

      const fileId = Number(fileRow.lastInsertRowid);

      const ins = db.prepare(`
        INSERT INTO dati_foglio
          (file_id, foglio, esame, n_esami,
           listino_concorrenza, totale_concorrenza, prezzo_scontato_concorrenza,
           listino_lav, totale_listino_lav, prezzo_scontato_lav, totale_scontato_lav,
           risparmio_dottore, sconto_concorrenza, sconto_lav)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let totaleEsami = 0;
      for (const [foglio, rows] of Object.entries(datiPerFoglio)) {
        for (const r of rows) {
          ins.run(
            fileId, foglio, r.esame, r.n_esami,
            r.listino_concorrenza, r.totale_concorrenza, r.prezzo_scontato_concorrenza,
            r.listino_lav, r.totale_listino_lav, r.prezzo_scontato_lav, r.totale_scontato_lav,
            r.risparmio_dottore, r.sconto_concorrenza, r.sconto_lav
          );
          totaleEsami++;
        }
      }

      result = {
        struttura: strutturaNome,
        struttura_id: strutturaRow.id,
        file_id: fileId,
        totale_esami: totaleEsami,
        fogli: Object.keys(datiPerFoglio)
      };
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Upload error:', err);
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// ── PDF ────────────────────────────────────────────
function euro(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

// Logo MYLAV (wordmark + "A" a doppio triangolo rosso/blu + ®), riusabile nel PDF.
function mylavLogo() {
  return `<div style="display:flex;align-items:flex-end;gap:1px;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:30px;letter-spacing:1px;line-height:1;color:#ffffff">
    <span>MYL</span>
    <svg width="25" height="30" viewBox="0 0 100 100" style="display:block">
      <polygon points="6,94 40,10 52,10 22,94" fill="#ce181e"/>
      <polygon points="94,94 60,10 48,10 78,94" fill="#0f76bc"/>
    </svg>
    <span>V</span>
    <span style="font-size:11px;font-weight:600;margin-left:2px;color:#9cc8e8">&reg;</span>
  </div>`;
}

// Stile brand condiviso dai PDF. Palette MYLAV: grafite #26262a, blu #0f76bc,
// rosso #ce181e. Semantica coerente coi grafici: rosso=concorrenza, blu=Mylav,
// grafite=risparmio.
const PDF_BRAND_STYLE = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#26262a;background:#fff;font-size:12px}
  .hdr{background:#26262a;color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:flex-end}
  .hdr .tag{font-size:10px;color:#c9cace;margin-top:7px;letter-spacing:.02em}
  .hdr .tag b{color:#fff;font-weight:600}
  .hdr-meta{text-align:right}
  .hdr-title{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#9cc8e8}
  .hdr-sub{font-size:11px;color:#c9cace;margin-top:5px}
  .badge{display:inline-block;background:#ce181e;color:#fff;font-size:9px;font-weight:700;
         text-transform:uppercase;letter-spacing:.08em;padding:3px 9px;border-radius:3px;margin-left:10px;vertical-align:middle}
  .brand-rule{height:4px;background:linear-gradient(90deg,#ce181e 0 50%,#0f76bc 50% 100%)}
  .kpis{display:flex;gap:12px;padding:20px 28px;background:#f6f7f9;flex-wrap:wrap}
  .kpi{flex:1;min-width:120px;background:#fff;padding:13px 16px;border-radius:7px;
       border:1px solid #e6e7ea;border-left:4px solid #cfd2d7}
  .kpi .l{font-size:9.5px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .kpi .v{font-size:16px;font-weight:700;color:#26262a}
  .kpi.r{border-left-color:#ce181e} .kpi.r .v{color:#ce181e}
  .kpi.b{border-left-color:#0f76bc} .kpi.b .v{color:#0f76bc}
  .kpi.k{border-left-color:#26262a} .kpi.k .v{color:#26262a}
  .sec{padding:20px 28px}
  .sec h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
          color:#26262a;border-bottom:2px solid #0f76bc;padding-bottom:7px;margin-bottom:13px}
  table{width:100%;border-collapse:collapse}
  th{background:#eaf3fb;padding:8px 10px;text-align:left;font-weight:600;
     color:#26262a;border-bottom:2px solid #0f76bc;font-size:10.5px}
  td{padding:7px 10px;border-bottom:1px solid #eef0f2;font-size:10.5px}
  tbody tr:nth-child(even){background:#fafbfc}
  .muted{color:#9ca3af}
  .c-conc{color:#ce181e} .c-lav{color:#0f76bc;font-weight:600} .c-risp{color:#26262a;font-weight:700}
  .ftr{padding:15px 28px;font-size:9.5px;color:#9ca3af;border-top:2px solid #0f76bc;margin-top:8px}
`;

function brandHeader(fileInfo, foglio, titolo, badge) {
  const data = new Date().toLocaleDateString('it-IT');
  return `<div class="hdr">
  <div>
    ${mylavLogo()}
    <div class="tag">Il laboratorio dei <b>clinici</b> per i <b>clinici</b></div>
  </div>
  <div class="hdr-meta">
    <div class="hdr-title">${titolo}${badge ? `<span class="badge">${badge}</span>` : ''}</div>
    <div class="hdr-sub">${fileInfo.struttura_nome} &middot; ${foglio} &middot; ${data}</div>
  </div>
</div>
<div class="brand-rule"></div>`;
}

// Legenda colori sotto ai grafici (i canvas catturati non la contengono).
function pdfLegend(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const chips = items.map(i => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:9.5px;color:#26262a">
      <span style="width:10px;height:10px;border-radius:2px;background:${i.color};display:inline-block;flex:0 0 auto"></span>${i.label}</span>`).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin-top:10px">${chips}</div>`;
}

function chartsSection(donutImg, barreImg, donutLegend, barreLegend) {
  if (!donutImg && !barreImg) return '';
  const lbl = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#0f76bc;margin-bottom:8px';
  const donutHtml = donutImg
    ? `<div style="flex:0 0 230px;text-align:center">
         <div style="${lbl}">Confronto prezzi</div>
         <img src="${donutImg}" style="width:190px;height:190px;object-fit:contain">
         ${pdfLegend(donutLegend)}
       </div>` : '';
  const barreHtml = barreImg
    ? `<div style="flex:1;min-width:0">
         <div style="${lbl}">Confronto per esame</div>
         <img src="${barreImg}" style="width:100%;max-height:300px;object-fit:contain">
         ${pdfLegend(barreLegend)}
       </div>` : '';
  return `<div class="sec">
  <h2>Grafici</h2>
  <div style="display:flex;gap:22px;align-items:flex-start">
    ${donutHtml}${barreHtml}
  </div>
</div>`;
}

// Vista DOTTORE
function buildHtmlDottore(fileInfo, foglio, dati, t, donutImg, barreImg, donutLegend, barreLegend) {
  const rows = dati.map(d => {
    const risp    = d.risparmio_dottore || 0;
    const rispPct = d.prezzo_scontato_concorrenza > 0
      ? ((risp / d.prezzo_scontato_concorrenza) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>${d.esame}</td>
      <td style="text-align:center">${d.n_esami}</td>
      <td class="c-conc">${euro(d.prezzo_scontato_concorrenza)}</td>
      <td class="c-lav">${euro(d.totale_scontato_lav)}</td>
      <td class="c-risp">${euro(risp)}</td>
      <td class="c-risp">${rispPct}%</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<style>${PDF_BRAND_STYLE}</style></head><body>
${brandHeader(fileInfo, foglio, 'Confronto risparmio')}
<div class="kpis">
  <div class="kpi r"><div class="l">Pagheresti con concorrenza</div><div class="v">${euro(t.prezzo_scontato_concorrenza)}</div></div>
  <div class="kpi b"><div class="l">Paghi con Mylav</div><div class="v">${euro(t.totale_scontato_lav)}</div></div>
  <div class="kpi k"><div class="l">Risparmi scegliendo noi</div>
    <div class="v">${euro(t.risparmio_totale_dottore)} <span style="font-size:12px;font-weight:600;color:#6b7280">(${t.risparmio_pct}%)</span></div>
  </div>
</div>
${chartsSection(donutImg, barreImg, donutLegend, barreLegend)}
<div class="sec">
  <h2>Dettaglio esami</h2>
  <table>
    <thead><tr>
      <th>Esame</th><th>N.</th><th>Prezzo mercato</th>
      <th>Prezzo Mylav</th><th>Risparmi &euro;</th><th>Risparmi %</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="ftr">Prezzi validi per il periodo indicato. Documento generato da Mylav ROI Dashboard.</div>
</body></html>`;
}

async function renderPDF(html) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' }
    });
  } finally {
    await browser.close();
  }
}

app.post('/api/pdf/dottore/:fileId/:foglio', requireAuth, express.json({ limit: '15mb' }), async (req, res) => {
  try {
    const { fileId, foglio } = req.params;
    const { donutImg, barreImg, donutLegend, barreLegend } = req.body || {};
    const fileInfo = db.prepare('SELECT fc.*, s.nome as struttura_nome FROM file_caricati fc JOIN strutture s ON fc.struttura_id = s.id WHERE fc.id = ? AND s.user_id = ?').get(fileId, req.user.id);
    if (!fileInfo) return res.status(404).json({ error: 'File non trovato' });
    const dati     = db.prepare('SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ? ORDER BY id').all(fileId, foglio);
    const t   = calcolaTotali(dati);
    const pdf = await renderPDF(buildHtmlDottore(fileInfo, foglio, dati, t, donutImg, barreImg, donutLegend, barreLegend));
    const fname = `mylav_${fileInfo.struttura_nome.replace(/\s/g,'_')}_${foglio}_dottore.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── Calcolatore endpoints ──────────────────────────

app.get('/api/esami/autocomplete', optionalAuth, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const like = `%${q}%`;
    const rows = req.user
      ? db.prepare(`
          SELECT esame AS nome FROM dati_foglio df
            JOIN file_caricati fc ON fc.id = df.file_id
            JOIN strutture s ON s.id = fc.struttura_id
            WHERE s.user_id = ? AND esame LIKE ?
          UNION
          SELECT nome FROM esami_riferimento WHERE nome LIKE ?
          UNION
          SELECT esame_nome AS nome FROM prezzi_esami_custom WHERE user_id = ? AND esame_nome LIKE ?
          UNION
          SELECT esame_mylav_nome AS nome FROM esami_concorrente ec
            JOIN concorrenti c ON c.id = ec.concorrente_id
            WHERE c.user_id = ? AND esame_mylav_nome IS NOT NULL AND esame_mylav_nome LIKE ?
          ORDER BY nome LIMIT 20
        `).all(req.user.id, like, like, req.user.id, like, req.user.id, like)
      : db.prepare(`
          SELECT nome FROM esami_riferimento WHERE nome LIKE ?
          ORDER BY nome LIMIT 20
        `).all(like);
    res.json(rows.map(r => r.nome));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/esami/prezzi', optionalAuth, (req, res) => {
  try {
    const nome = String(req.query.nome || '').trim();
    if (!req.user) return res.json({});
    const row = db.prepare(`
      SELECT
        ROUND(AVG(df.listino_concorrenza), 2) as listino_concorrenza,
        ROUND(AVG(df.listino_lav), 2)         as listino_lav,
        ROUND(AVG(df.prezzo_scontato_lav), 2) as prezzo_scontato_lav
      FROM dati_foglio df
      JOIN file_caricati fc ON fc.id = df.file_id
      JOIN strutture s ON s.id = fc.struttura_id
      WHERE s.user_id = ? AND LOWER(TRIM(df.esame)) = LOWER(TRIM(?))
    `).get(req.user.id, nome);
    res.json(row || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piani', optionalAuth, (req, res) => {
  try {
    const all = req.query.all === '1';
    const rows = all
      ? db.prepare(`SELECT id, nome, categoria, anno, ordine, attivo FROM piani_sconto ORDER BY ordine`).all()
      : db.prepare(`SELECT id, nome, categoria, anno, ordine FROM piani_sconto WHERE attivo = 1 ORDER BY ordine`).all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piani/:id/prezzo', optionalAuth, (req, res) => {
  try {
    const { esame } = req.query;
    if (!esame) return res.status(400).json({ error: 'Parametro esame mancante' });
    const result = piani.resolvePrezzo(db, Number(req.params.id), esame, req.user ? req.user.id : null);
    if (result.fonte === 'base_fallback') {
      console.warn(`Prezzo mancante per piano ${req.params.id}, esame "${esame}" — uso il prezzo base come fallback`);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piani/consiglio', optionalAuth, (req, res) => {
  try {
    const { esame } = req.query;
    if (!esame) return res.status(400).json({ error: 'Parametro esame mancante' });
    res.json(piani.pianoMigliorePerEsame(db, esame, req.user ? req.user.id : null));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/piani/consiglio-totale', optionalAuth, express.json(), (req, res) => {
  try {
    const { esami, pianoIdAttuale } = req.body || {};
    if (!Array.isArray(esami)) return res.status(400).json({ error: 'Parametro esami mancante' });
    const userId = req.user ? req.user.id : null;
    const migliore = piani.pianoMiglioreTotale(db, esami, userId);
    let totaleAttuale = null;
    if (migliore && pianoIdAttuale) {
      totaleAttuale = piani.totalePiano(db, Number(pianoIdAttuale), esami.filter(e => e && e.nome), userId).totale;
    }
    res.json(migliore ? { ...migliore, totaleAttuale } : null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Classifica di tutti i piani attivi per gli esami dati (dal piu' conveniente al meno)
app.post('/api/piani/classifica', optionalAuth, express.json(), (req, res) => {
  try {
    const { esami } = req.body || {};
    if (!Array.isArray(esami)) return res.status(400).json({ error: 'Parametro esami mancante' });
    res.json(piani.pianiClassifica(db, esami, req.user ? req.user.id : null));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/esami-riferimento/prezzo-base', optionalAuth, (req, res) => {
  try {
    const { nome } = req.query;
    res.json({ prezzo_base: nome ? piani.getPrezzoBase(db, nome) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tutti i nomi del catalogo esami Mylav (per autocomplete/datalist)
app.get('/api/esami-riferimento/nomi', optionalAuth, (req, res) => {
  try {
    // Tutti i nomi esame Mylav "conosciuti": catalogo (+ storico/custom/mappati dell'utente se loggato).
    const nomi = req.user
      ? db.prepare(`
          SELECT nome FROM esami_riferimento
          UNION SELECT df.esame FROM dati_foglio df
            JOIN file_caricati fc ON fc.id = df.file_id
            JOIN strutture s ON s.id = fc.struttura_id
            WHERE s.user_id = ? AND df.esame IS NOT NULL AND df.esame != ''
          UNION SELECT esame_nome FROM prezzi_esami_custom WHERE user_id = ?
          UNION SELECT ec.esame_mylav_nome FROM esami_concorrente ec
            JOIN concorrenti c ON c.id = ec.concorrente_id
            WHERE c.user_id = ? AND ec.esame_mylav_nome IS NOT NULL
          ORDER BY nome
        `).all(req.user.id, req.user.id, req.user.id).map(r => r.nome)
      : db.prepare(`SELECT nome FROM esami_riferimento ORDER BY nome`).all().map(r => r.nome);
    res.json(nomi);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/prezzi-custom', requireAuth, express.json(), (req, res) => {
  try {
    const { esame_nome, piano_id, prezzo } = req.body || {};
    if (!esame_nome || !piano_id || prezzo == null) {
      return res.status(400).json({ error: 'Dati mancanti (esame_nome, piano_id, prezzo)' });
    }
    piani.salvaPrezzoCustom(db, esame_nome, Number(piano_id), Number(prezzo), req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/piani/:id', optionalAuth, (req, res) => {
  try {
    const piano = db.prepare(`SELECT * FROM piani_sconto WHERE id = ?`).get(req.params.id);
    if (!piano) return res.status(404).json({ error: 'Piano non trovato' });
    const prezzi = db.prepare(`
      SELECT er.id AS esame_id, er.nome AS esame_nome, er.prezzo_base, pp.prezzo
      FROM esami_riferimento er
      LEFT JOIN prezzi_piano_esame pp ON pp.esame_id = er.id AND pp.piano_id = ?
      ORDER BY er.nome
    `).all(req.params.id);
    res.json({ piano, prezzi });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/piani/:id/prezzi', requireAdmin, express.json({ limit: '2mb' }), (req, res) => {
  try {
    const { prezzi } = req.body || {};
    if (!Array.isArray(prezzi)) return res.status(400).json({ error: 'Formato non valido, atteso { prezzi: [...] }' });
    const upsert = db.prepare(`
      INSERT INTO prezzi_piano_esame (piano_id, esame_id, prezzo) VALUES (?, ?, ?)
      ON CONFLICT(piano_id, esame_id) DO UPDATE SET prezzo = excluded.prezzo
    `);
    db.exec('BEGIN');
    try {
      for (const r of prezzi) upsert.run(req.params.id, r.esame_id, r.prezzo);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ success: true, aggiornati: prezzi.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/piani/:id/attivo', requireAdmin, express.json(), (req, res) => {
  try {
    const { attivo } = req.body || {};
    db.prepare(`UPDATE piani_sconto SET attivo = ? WHERE id = ?`).run(attivo ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/piani/import', requireAdmin, express.json({ limit: '10mb' }), (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.plans || !data.exams_base_price) {
      return res.status(400).json({ error: 'JSON non nel formato atteso (servono exams_base_price e plans)' });
    }
    const result = piani.upsertFromJson(db, data);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/import', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const parsed = parseConcorrenteExcel(req.file.path);
    fs.unlinkSync(req.file.path);
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/concorrenti/import/conferma', requireAuth, express.json({ limit: '5mb' }), (req, res) => {
  try {
    const { nomeConcorrente, colEsame, colPrezzo, colSconto, rows } = req.body || {};
    if (!nomeConcorrente || colEsame == null || colPrezzo == null || !Array.isArray(rows)) {
      return res.status(400).json({ error: 'Dati mancanti (nomeConcorrente, colEsame, colPrezzo, rows)' });
    }
    const righe = rows
      .map(r => ({
        nome_originale: r[colEsame],
        prezzo: parseFloat(String(r[colPrezzo]).replace(',', '.')) || 0,
        sconto: (colSconto != null && colSconto >= 0 && r[colSconto] !== '')
          ? (parseFloat(String(r[colSconto]).replace(',', '.')) || 0)
          : null
      }))
      .filter(r => r.nome_originale && String(r.nome_originale).trim());
    const result = concorrenti.upsertConcorrente(db, nomeConcorrente, righe, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/concorrenti', requireAuth, (req, res) => {
  try { res.json(concorrenti.listaConcorrenti(db, req.user.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/concorrenti/:id', requireAuth, (req, res) => {
  try {
    const dettaglio = concorrenti.dettaglioConcorrente(db, req.params.id, req.user.id);
    if (!dettaglio) return res.status(404).json({ error: 'Concorrente non trovato' });
    res.json(dettaglio);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/concorrenti/:id/match', requireAuth, (req, res) => {
  try {
    const { esame } = req.query;
    if (!esame) return res.status(400).json({ error: 'Parametro esame mancante' });
    const owned = concorrenti.dettaglioConcorrente(db, req.params.id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'Concorrente non trovato' });
    res.json(concorrenti.trovaMatch(db, Number(req.params.id), esame));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/:id/conferma-match', requireAuth, express.json(), (req, res) => {
  try {
    const { esameConcorrenteId, esameMylavNome } = req.body || {};
    if (!esameConcorrenteId || !esameMylavNome) {
      return res.status(400).json({ error: 'Dati mancanti (esameConcorrenteId, esameMylavNome)' });
    }
    const owned = concorrenti.dettaglioConcorrente(db, req.params.id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'Concorrente non trovato' });
    concorrenti.confermaMatch(db, Number(req.params.id), Number(esameConcorrenteId), esameMylavNome);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/:id/rimuovi-match', requireAuth, express.json(), (req, res) => {
  try {
    const { esameConcorrenteId } = req.body || {};
    if (!esameConcorrenteId) return res.status(400).json({ error: 'Dati mancanti (esameConcorrenteId)' });
    const owned = concorrenti.dettaglioConcorrente(db, req.params.id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'Concorrente non trovato' });
    concorrenti.rimuoviMatch(db, Number(req.params.id), Number(esameConcorrenteId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/concorrenti/:id', requireAuth, (req, res) => {
  try {
    const ok = concorrenti.eliminaConcorrente(db, req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Concorrente non trovato' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/concorrenti/import-pdf', requireAuth, uploadPdf.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const testo = await pdfimport.estraiTestoPdf(buf);
    const parsed = pdfimport.parseRigheDaTesto(testo);
    fs.unlinkSync(req.file.path);
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/concorrenti/import-pdf/conferma', requireAuth, express.json({ limit: '5mb' }), (req, res) => {
  try {
    const { nomeConcorrente, righe } = req.body || {};
    if (!nomeConcorrente || !Array.isArray(righe)) {
      return res.status(400).json({ error: 'Dati mancanti (nomeConcorrente, righe)' });
    }
    const pulite = righe
      .map(r => ({ nome_originale: r.nome_originale, prezzo: Number(r.prezzo) || 0, sconto: null }))
      .filter(r => r.nome_originale && String(r.nome_originale).trim() && r.prezzo > 0);
    const result = concorrenti.upsertConcorrente(db, nomeConcorrente, pulite, req.user.id);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/calcolo/salva', requireAuth, express.json(), (req, res) => {
  try {
    const { struttura: strutturaNome, foglio, righe, nomeFile, piano_id } = req.body || {};
    if (!strutturaNome || !foglio || !righe?.length)
      return res.status(400).json({ error: 'Dati mancanti' });

    db.exec('BEGIN');
    try {
      let strRow = db.prepare('SELECT id FROM strutture WHERE nome = ? AND user_id = ?').get(strutturaNome, req.user.id);
      if (!strRow) {
        const r = db.prepare('INSERT INTO strutture (nome, user_id) VALUES (?, ?)').run(strutturaNome, req.user.id);
        strRow = { id: Number(r.lastInsertRowid) };
      }
      const nomef = nomeFile || `Calcolo_${foglio}_${new Date().toISOString().split('T')[0]}`;
      const fRow  = db.prepare(
        'INSERT INTO file_caricati (struttura_id, nome_file, path_file) VALUES (?, ?, ?)'
      ).run(strRow.id, nomef, '');
      const fileId = Number(fRow.lastInsertRowid);

      const ins = db.prepare(`
        INSERT INTO dati_foglio
          (file_id, foglio, esame, n_esami,
           listino_concorrenza, totale_concorrenza, prezzo_scontato_concorrenza,
           listino_lav, totale_listino_lav, prezzo_scontato_lav, totale_scontato_lav,
           risparmio_dottore, sconto_concorrenza, sconto_lav, piano_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of righe) {
        const n        = r.n_esami || 1;
        const lConc    = r.listino_concorrenza || 0;
        const tConc    = lConc * n;
        const pConc    = parseFloat((tConc * 0.9).toFixed(2));
        const lLav     = r.listino_lav || 0;
        const tLLav    = lLav * n;
        const pLav     = r.prezzo_scontato_lav || 0;
        const tPLav    = pLav * n;
        ins.run(fileId, foglio, r.esame, n,
          lConc, tConc, pConc, lLav, tLLav, pLav, tPLav,
          pConc - tPLav, tConc - pConc, tLLav - tPLav, piano_id || null);
      }
      db.exec('COMMIT');
      res.json({ success: true, file_id: fileId, struttura_id: strRow.id, struttura: strutturaNome, fogli: [foglio] });
    } catch (txErr) { db.exec('ROLLBACK'); throw txErr; }
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/export-excel', requireAuth, express.json(), (req, res) => {
  try {
    const { foglio, struttura, righe } = req.body || {};
    if (!righe?.length) return res.status(400).json({ error: 'Nessuna riga' });
    const wb = XLSX.utils.book_new();
    let wsData;
    if (foglio === 'Foglio 1') {
      wsData = [
        ['Struttura', '', 'ESAMI', 'listino vet med', 'prezzo vet med', '', 'Listino lav', 'prezzo lav'],
        ...righe.map((r, i) => [
          i === 0 ? struttura : '', '',
          r.esame,
          r.listino_concorrenza || 0,
          parseFloat(((r.listino_concorrenza || 0) * 0.9).toFixed(2)),
          '',
          r.listino_lav || 0,
          r.prezzo_scontato_lav || 0
        ])
      ];
    } else {
      wsData = [
        ['Struttura', '', 'ESAMI', 'N. esami', 'Costo esami', 'Totale costo esami',
         'prezzo vet med scontato', '', 'LISTINO LAVALLONEA', 'TOTALE LISTINO',
         `prezzo lav. ${foglio}`, 'Totale prezzo lav'],
        ...righe.map((r, i) => {
          const n = r.n_esami || 1;
          const lc = r.listino_concorrenza || 0;
          return [
            i === 0 ? struttura : '', '', r.esame, n,
            lc, lc * n, parseFloat((lc * n * 0.9).toFixed(2)),
            '',
            r.listino_lav || 0, (r.listino_lav || 0) * n,
            r.prezzo_scontato_lav || 0, (r.prezzo_scontato_lav || 0) * n
          ];
        })
      ];
    }
    const ws  = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, foglio);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="mylav_${(struttura||'export').replace(/\s/g,'_')}_${foglio}.xlsx"`
    });
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cronologia/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const owned = db.prepare(`
      SELECT 1 FROM file_caricati fc
      JOIN strutture s ON s.id = fc.struttura_id
      WHERE fc.id = ? AND s.user_id = ?
    `).get(id, req.user.id);
    if (!owned) return res.status(404).json({ error: 'File non trovato' });
    db.prepare('DELETE FROM dati_foglio WHERE file_id = ?').run(id);
    db.prepare('DELETE FROM file_caricati WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/strutture/:id', requireAuth, (req, res) => {
  try {
    const id = req.params.id;
    const esiste = db.prepare('SELECT 1 FROM strutture WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!esiste) return res.status(404).json({ error: 'Struttura non trovata' });

    const files = db.prepare('SELECT id, path_file FROM file_caricati WHERE struttura_id = ?').all(id);
    db.exec('BEGIN');
    try {
      for (const f of files) {
        db.prepare('DELETE FROM dati_foglio WHERE file_id = ?').run(f.id);
      }
      db.prepare('DELETE FROM file_caricati WHERE struttura_id = ?').run(id);
      db.prepare('DELETE FROM strutture WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    // best-effort: rimuovi i file Excel caricati dal disco
    for (const f of files) {
      if (f.path_file) { try { fs.unlinkSync(f.path_file); } catch (_) {} }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  ✓ Mylav ROI Dashboard`);
  console.log(`  → http://localhost:${PORT}\n`);
});
