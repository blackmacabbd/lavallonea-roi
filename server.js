'use strict';

const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const { DatabaseSync } = require('node:sqlite');
const path     = require('path');
const fs       = require('fs');

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────
const app  = express();
const PORT = 3000;

const DB_PATH    = path.join(__dirname, 'db', 'database.sqlite');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.join(__dirname, 'db'), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ──────────────────────────────────────────────
// Database
// ──────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS strutture (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS file_caricati (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    struttura_id INTEGER REFERENCES strutture(id),
    nome_file    TEXT,
    data_carico  DATETIME DEFAULT CURRENT_TIMESTAMP,
    path_file    TEXT
  );

  CREATE TABLE IF NOT EXISTS dati_foglio (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id             INTEGER REFERENCES file_caricati(id),
    foglio              TEXT,
    esame               TEXT,
    n_esami             INTEGER,
    costo_listino       REAL,
    totale_listino      REAL,
    prezzo_vet_scontato REAL,
    listino_lav         REAL,
    totale_listino_lav  REAL,
    prezzo_lav          REAL,
    totale_prezzo_lav   REAL
  );
`);

// ──────────────────────────────────────────────
// Multer
// ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/\.xlsx?$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Solo file Excel (.xlsx, .xls)'));
  }
});

// ──────────────────────────────────────────────
// Excel parsing helpers
// ──────────────────────────────────────────────

/** Find column index by searching header strings (case-insensitive, partial match, normalizza spazi multipli) */
function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
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
 * Parse "Foglio 1"
 * Columns: struttura | (vuota) | ESAMI | listino vet med | prezzo vet med | (vuota) | Listino lav | prezzo lav
 * n_esami = 1 always
 */
function parseFoglio1(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) return { struttura: null, rows: [] };

  // Find header row: must contain 'ESAMI'
  let hRow = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i].some(c => String(c).toUpperCase().trim() === 'ESAMI')) { hRow = i; break; }
  }
  if (hRow === -1) {
    // Fallback: first row with more than 3 non-empty cells
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      if (rows[i].filter(c => c !== '').length >= 3) { hRow = i; break; }
    }
  }
  if (hRow === -1) return { struttura: null, rows: [] };

  const headers = rows[hRow].map(h => String(h || ''));
  const cEsame     = findCol(headers, 'ESAMI');
  const cListVet   = findCol(headers, 'listino vet');
  const cPrezVet   = findCol(headers, 'prezzo vet');
  const cListLav   = findCol(headers, 'listino lav');
  const cPrezLav   = findCol(headers, 'prezzo lav');

  // Struttura = first non-empty cell in first data row
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

    const costoListino      = cListVet  >= 0 ? toNum(row[cListVet])  : 0;
    const prezzoVetScontato = cPrezVet  >= 0 ? toNum(row[cPrezVet])  : 0;
    const listinoLav        = cListLav  >= 0 ? toNum(row[cListLav])  : 0;
    const prezzoLav         = cPrezLav  >= 0 ? toNum(row[cPrezLav])  : 0;

    result.push({
      esame:               String(esame).trim(),
      n_esami:             1,
      costo_listino:       costoListino,
      totale_listino:      costoListino,
      prezzo_vet_scontato: prezzoVetScontato,
      listino_lav:         listinoLav,
      totale_listino_lav:  listinoLav,
      prezzo_lav:          prezzoLav,
      totale_prezzo_lav:   prezzoLav
    });
  }

  return { struttura, rows: result };
}

/**
 * Parse "Platinum" or "Gold"
 * Columns: struttura | (vuota) | ESAMI | N. esami | Costo esami | Totale costo esami |
 *          prezzo vet med scontato | (vuota) | LISTINO LAVALLONEA | TOTALE LISTINO |
 *          prezzo lav. [platinum/gold] | totale prezzo lav
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

  const cEsame        = findCol(headers, 'ESAMI');
  const cNEsami       = findCol(headers, 'n. esami', 'n esami', 'num esami');
  const cCosto        = findCol(headers, 'costo esami');
  const cTotaleCosto  = findCol(headers, 'totale costo esami', 'totale costo');
  const cPrezVetSc    = findCol(headers, 'prezzo vet med scontato', 'prezzo vet scontato', 'prezzo vet med');
  const cListLav      = findCol(headers, 'listino lavallonea', 'listino lav');
  const cTotListLav   = findCol(headers, 'totale listino');
  const cPrezLav      = findCol(headers,
    `prezzo lav. ${tipoFoglio.toLowerCase()}`,
    `prezzo lav. ${tipoFoglio}`,
    'prezzo lav'
  );
  const cTotPrezLav   = findCol(headers,
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

    const nEsami           = cNEsami    >= 0 ? (parseInt(row[cNEsami])    || 1) : 1;
    const costoListino     = cCosto     >= 0 ? toNum(row[cCosto])     : 0;
    const totaleListino    = cTotaleCosto >= 0 ? toNum(row[cTotaleCosto]) : costoListino * nEsami;
    const prezzoVetSc      = cPrezVetSc >= 0 ? toNum(row[cPrezVetSc]) : 0;
    const listinoLav       = cListLav   >= 0 ? toNum(row[cListLav])   : 0;
    const totaleListLav    = cTotListLav >= 0 ? toNum(row[cTotListLav]) : listinoLav * nEsami;
    const prezzoLav        = cPrezLav   >= 0 ? toNum(row[cPrezLav])   : 0;
    const totalePrezzoLav  = cTotPrezLav >= 0 ? toNum(row[cTotPrezLav]) : prezzoLav * nEsami;

    result.push({
      esame:               String(esame).trim(),
      n_esami:             nEsami,
      costo_listino:       costoListino,
      totale_listino:      totaleListino,
      prezzo_vet_scontato: prezzoVetSc,
      listino_lav:         listinoLav,
      totale_listino_lav:  totaleListLav,
      prezzo_lav:          prezzoLav,
      totale_prezzo_lav:   totalePrezzoLav
    });
  }

  return { struttura, rows: result };
}

/** Compute totali from array of dati_foglio rows */
function calcolaTotali(dati) {
  const t = dati.reduce((acc, d) => {
    acc.totale_listino      += d.totale_listino      || 0;
    acc.prezzo_vet_scontato += d.prezzo_vet_scontato || 0;
    acc.totale_prezzo_lav   += d.totale_prezzo_lav   || 0;
    return acc;
  }, { totale_listino: 0, prezzo_vet_scontato: 0, totale_prezzo_lav: 0 });

  t.differenziale   = t.prezzo_vet_scontato - t.totale_prezzo_lav;
  t.sconto_applicato = t.totale_listino - t.prezzo_vet_scontato;
  t.risparmio_pct   = t.totale_listino > 0
    ? +((t.sconto_applicato / t.totale_listino) * 100).toFixed(1)
    : 0;
  return t;
}

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/chart.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.min.js'));
});

// ──────────────────────────────────────────────
// DEBUG — POST /api/debug (non salva nulla)
// ──────────────────────────────────────────────
app.post('/api/debug', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const result = {};
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      // Find header row
      let hRow = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        if (rows[i].some(c => String(c).toUpperCase().trim() === 'ESAMI') ||
            rows[i].filter(c => c !== '').length >= 3) {
          hRow = i; break;
        }
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

// ──────────────────────────────────────────────
// API Routes
// ──────────────────────────────────────────────

// GET /api/strutture
app.get('/api/strutture', (req, res) => {
  try {
    const strutture = db.prepare('SELECT * FROM strutture ORDER BY nome').all();
    const result = strutture.map(s => {
      const fileCnt = db.prepare(
        'SELECT COUNT(*) as cnt FROM file_caricati WHERE struttura_id = ?'
      ).get(s.id).cnt;
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

// GET /api/strutture/:id/file
app.get('/api/strutture/:id/file', (req, res) => {
  try {
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

// GET /api/file/:id/dati?foglio=Platinum
app.get('/api/file/:id/dati', (req, res) => {
  try {
    const { foglio } = req.query;
    if (!foglio) return res.status(400).json({ error: 'Parametro foglio mancante' });

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

// GET /api/strutture/:id/aggregato
app.get('/api/strutture/:id/aggregato', (req, res) => {
  try {
    const struttura = db.prepare('SELECT * FROM strutture WHERE id = ?').get(req.params.id);
    if (!struttura) return res.status(404).json({ error: 'Struttura non trovata' });

    const files = db.prepare(
      'SELECT * FROM file_caricati WHERE struttura_id = ? ORDER BY data_carico'
    ).all(req.params.id);

    const result = files.map(f => {
      const fogli = db.prepare(
        'SELECT DISTINCT foglio FROM dati_foglio WHERE file_id = ?'
      ).all(f.id).map(r => r.foglio);

      const foglioData = {};
      fogli.forEach(foglio => {
        const dati = db.prepare(
          'SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ?'
        ).all(f.id, foglio);
        foglioData[foglio] = calcolaTotali(dati);
      });

      return { file: f, fogli: foglioData };
    });

    res.json({ struttura, files: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard
app.get('/api/dashboard', (req, res) => {
  try {
    const strutture_count = db.prepare('SELECT COUNT(*) as cnt FROM strutture').get().cnt;
    const file_count      = db.prepare('SELECT COUNT(*) as cnt FROM file_caricati').get().cnt;

    const diffRow = db.prepare(`
      SELECT SUM(sub.diff) as totale
      FROM (
        SELECT (SUM(prezzo_vet_scontato) - SUM(totale_prezzo_lav)) as diff
        FROM dati_foglio
        GROUP BY file_id
      ) sub
    `).get();
    const differenziale_totale = diffRow.totale || 0;

    const ultimi_file = db.prepare(`
      SELECT fc.*, s.nome as struttura_nome
      FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      ORDER BY fc.data_carico DESC
      LIMIT 5
    `).all();

    const per_struttura = db.prepare(`
      SELECT s.nome,
        SUM(df.prezzo_vet_scontato) as fatturato,
        SUM(df.totale_prezzo_lav)   as costo
      FROM dati_foglio df
      JOIN file_caricati fc ON df.file_id = fc.id
      JOIN strutture s ON fc.struttura_id = s.id
      GROUP BY s.id
      ORDER BY s.nome
    `).all();

    res.json({ strutture_count, file_count, differenziale_totale, ultimi_file, per_struttura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cronologia?struttura_id=X
app.get('/api/cronologia', (req, res) => {
  try {
    const { struttura_id } = req.query;
    const where = struttura_id ? 'WHERE fc.struttura_id = ?' : '';
    const params = struttura_id ? [struttura_id] : [];

    const rows = db.prepare(`
      SELECT
        fc.id, fc.nome_file, fc.data_carico,
        s.id   as struttura_id,
        s.nome as struttura_nome,
        GROUP_CONCAT(DISTINCT df.foglio)         as fogli,
        SUM(df.prezzo_vet_scontato)              as totale_dottore,
        SUM(df.totale_prezzo_lav)                as totale_costo,
        SUM(df.prezzo_vet_scontato)
          - SUM(df.totale_prezzo_lav)            as differenziale
      FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      LEFT JOIN dati_foglio df ON df.file_id = fc.id
      ${where}
      GROUP BY fc.id
      ORDER BY fc.data_carico DESC
    `).all(...params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/confronto
app.get('/api/confronto', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        s.id, s.nome,
        SUM(df.totale_listino)      as totale_listino,
        SUM(df.prezzo_vet_scontato) as prezzo_scontato,
        SUM(df.totale_prezzo_lav)   as costo_lav,
        SUM(df.prezzo_vet_scontato)
          - SUM(df.totale_prezzo_lav) as differenziale
      FROM strutture s
      JOIN file_caricati fc ON fc.struttura_id = s.id
      JOIN dati_foglio df   ON df.file_id = fc.id
      GROUP BY s.id
      ORDER BY s.nome
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  try {
    const wb   = XLSX.readFile(req.file.path);
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
      return res.status(400).json({
        error: 'Struttura o dati non trovati nel file. Verifica il formato Excel.'
      });
    }

    strutturaNome = strutturaNome.trim();

    // Check duplicate (stesso nome file + stessa struttura)
    const dup = db.prepare(`
      SELECT fc.id FROM file_caricati fc
      JOIN strutture s ON fc.struttura_id = s.id
      WHERE fc.nome_file = ? AND s.nome = ?
    `).get(req.file.originalname, strutturaNome);

    if (dup && !req.body.force) {
      return res.status(409).json({
        conflict: true,
        struttura: strutturaNome,
        message: `File "${req.file.originalname}" già presente per "${strutturaNome}". Sovrascrivere?`
      });
    }

    // Transaction: insert everything
    let result;
    db.exec('BEGIN');
    try {
      let strutturaRow = db.prepare('SELECT id FROM strutture WHERE nome = ?').get(strutturaNome);
      if (!strutturaRow) {
        const r = db.prepare('INSERT INTO strutture (nome) VALUES (?)').run(strutturaNome);
        strutturaRow = { id: Number(r.lastInsertRowid) };
      }

      const fileRow = db.prepare(`
        INSERT INTO file_caricati (struttura_id, nome_file, path_file)
        VALUES (?, ?, ?)
      `).run(strutturaRow.id, req.file.originalname, req.file.path);

      const fileId = Number(fileRow.lastInsertRowid);

      const ins = db.prepare(`
        INSERT INTO dati_foglio
          (file_id, foglio, esame, n_esami, costo_listino, totale_listino,
           prezzo_vet_scontato, listino_lav, totale_listino_lav, prezzo_lav, totale_prezzo_lav)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let totaleEsami = 0;
      for (const [foglio, rows] of Object.entries(datiPerFoglio)) {
        for (const r of rows) {
          ins.run(
            fileId, foglio, r.esame, r.n_esami, r.costo_listino, r.totale_listino,
            r.prezzo_vet_scontato, r.listino_lav, r.totale_listino_lav,
            r.prezzo_lav, r.totale_prezzo_lav
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

// ──────────────────────────────────────────────
// PDF Generation
// ──────────────────────────────────────────────

function euro(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function chartsSection(donutImg, barreImg) {
  if (!donutImg && !barreImg) return '';
  const donutHtml = donutImg
    ? `<div style="flex:0 0 240px;text-align:center">
         <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Ripartizione</div>
         <img src="${donutImg}" style="width:200px;height:200px;object-fit:contain">
       </div>` : '';
  const barreHtml = barreImg
    ? `<div style="flex:1;min-width:0">
         <div style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:8px">Guadagno per esame</div>
         <img src="${barreImg}" style="width:100%;max-height:320px;object-fit:contain">
       </div>` : '';
  return `<div class="sec">
  <h2>Grafici</h2>
  <div style="display:flex;gap:20px;align-items:flex-start">
    ${donutHtml}${barreHtml}
  </div>
</div>`;
}

function buildHtmlDottore(fileInfo, foglio, dati, t, donutImg, barreImg) {
  const rows = dati.map(d => {
    const risp   = d.costo_listino - d.prezzo_vet_scontato;
    const rispPct = d.costo_listino > 0
      ? ((risp / d.costo_listino) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>${d.esame}</td>
      <td style="text-align:center">${d.n_esami}</td>
      <td>${euro(d.costo_listino)}</td>
      <td style="color:#1a7a4a;font-weight:500">${euro(d.prezzo_vet_scontato)}</td>
      <td style="color:#1a7a4a">${euro(risp)}</td>
      <td style="color:#1a7a4a">${rispPct}%</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a1a;background:#fff;font-size:12px}
  .hdr{background:#1a7a4a;color:#fff;padding:24px 28px}
  .hdr h1{font-size:22px;font-weight:500;margin-bottom:4px}
  .hdr .sub{font-size:12px;opacity:.8}
  .kpis{display:flex;gap:12px;padding:20px 28px;background:#f5f6f8}
  .kpi{flex:1;background:#fff;padding:14px 16px;border-radius:6px;border:1px solid #e8e9eb}
  .kpi .l{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .kpi .v{font-size:16px;font-weight:500}
  .kpi.g .v{color:#1a7a4a}
  .sec{padding:20px 28px}
  .sec h2{font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;
          color:#6b7280;border-bottom:1px solid #e8e9eb;padding-bottom:8px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse}
  th{background:#f5f6f8;padding:8px 10px;text-align:left;font-weight:500;
     border-bottom:1px solid #e8e9eb;font-size:11px}
  td{padding:7px 10px;border-bottom:1px solid #f5f5f5;font-size:11px}
  .ftr{padding:16px 28px;font-size:10px;color:#9ca3af;border-top:1px solid #e8e9eb;margin-top:8px}
</style></head><body>
<div class="hdr">
  <h1>Lavallonea</h1>
  <div class="sub">${fileInfo.struttura_nome} &mdash; ${foglio} &mdash; ${new Date().toLocaleDateString('it-IT')}</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="l">Listino pieno</div><div class="v">${euro(t.totale_listino)}</div></div>
  <div class="kpi g"><div class="l">Prezzo per te</div><div class="v">${euro(t.prezzo_vet_scontato)}</div></div>
  <div class="kpi g"><div class="l">Risparmio totale</div>
    <div class="v">${euro(t.sconto_applicato)} <span style="font-size:13px;font-weight:400">(${t.risparmio_pct}%)</span></div>
  </div>
</div>
${chartsSection(donutImg, barreImg)}
<div class="sec">
  <h2>Dettaglio esami</h2>
  <table>
    <thead><tr>
      <th>Esame</th><th>N.</th><th>Listino</th>
      <th>Prezzo tuo</th><th>Risparmio €</th><th>Risparmio %</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="ftr">Prezzi validi per il periodo indicato. Documento generato da Lavallonea ROI Dashboard.</div>
</body></html>`;
}

function buildHtmlCompleto(fileInfo, foglio, dati, t, donutImg, barreImg) {
  const rows = dati.map(d => {
    const diff   = d.prezzo_vet_scontato - d.totale_prezzo_lav;
    const diffPct = d.prezzo_vet_scontato > 0
      ? ((diff / d.prezzo_vet_scontato) * 100).toFixed(1) : '0.0';
    return `<tr>
      <td>${d.esame}</td>
      <td style="text-align:center">${d.n_esami}</td>
      <td>${euro(d.costo_listino)}</td>
      <td style="color:#1a7a4a">${euro(d.prezzo_vet_scontato)}</td>
      <td>${euro(d.listino_lav)}</td>
      <td style="color:#f5a800">${euro(d.prezzo_lav)}</td>
      <td style="color:#2563a8;font-weight:500">${euro(diff)}</td>
      <td style="color:#2563a8">${diffPct}%</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a1a;background:#fff;font-size:12px}
  .hdr{background:#1a1a1a;color:#fff;padding:24px 28px}
  .hdr h1{font-size:22px;font-weight:500;margin-bottom:4px}
  .hdr .sub{font-size:12px;opacity:.7}
  .badge{display:inline-block;background:#f5a800;color:#1a1a1a;font-size:10px;
         font-weight:500;padding:3px 10px;border-radius:3px;margin-left:12px;vertical-align:middle}
  .kpis{display:flex;gap:10px;padding:16px 28px;background:#f5f6f8;flex-wrap:wrap}
  .kpi{flex:1;min-width:110px;background:#fff;padding:12px 14px;border-radius:6px;border:1px solid #e8e9eb}
  .kpi .l{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
  .kpi .v{font-size:15px;font-weight:500}
  .kpi.g .v{color:#1a7a4a}.kpi.y .v{color:#f5a800}.kpi.b .v{color:#2563a8}
  .sec{padding:18px 28px}
  .sec h2{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;
          color:#6b7280;border-bottom:1px solid #e8e9eb;padding-bottom:8px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse}
  th{background:#f5f6f8;padding:7px 8px;text-align:left;font-weight:500;
     border-bottom:1px solid #e8e9eb;font-size:10px}
  td{padding:6px 8px;border-bottom:1px solid #f5f5f5;font-size:10px}
  .ftr{padding:14px 28px;font-size:10px;color:#9ca3af;border-top:1px solid #e8e9eb}
</style></head><body>
<div class="hdr">
  <h1>Lavallonea &mdash; Report Completo <span class="badge">USO INTERNO</span></h1>
  <div class="sub">${fileInfo.struttura_nome} &mdash; ${foglio} &mdash; ${new Date().toLocaleDateString('it-IT')}</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="l">Listino pieno</div><div class="v">${euro(t.totale_listino)}</div></div>
  <div class="kpi g"><div class="l">Prezzo scontato</div><div class="v">${euro(t.prezzo_vet_scontato)}</div></div>
  <div class="kpi y"><div class="l">Tuo costo</div><div class="v">${euro(t.totale_prezzo_lav)}</div></div>
  <div class="kpi b"><div class="l">Differenziale</div><div class="v">${euro(t.differenziale)}</div></div>
</div>
${chartsSection(donutImg, barreImg)}
<div class="sec">
  <h2>Dettaglio completo</h2>
  <table>
    <thead><tr>
      <th>Esame</th><th>N.</th><th>Listino vet</th><th>Prezzo scontato</th>
      <th>Listino Lav</th><th>Tuo costo</th><th>Differenziale</th><th>%</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="ftr">Documento confidenziale &mdash; uso interno. Lavallonea ROI Dashboard.</div>
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

// POST /api/pdf/dottore/:fileId/:foglio  { donutImg, barreImg }
app.post('/api/pdf/dottore/:fileId/:foglio', express.json({ limit: '15mb' }), async (req, res) => {
  try {
    const { fileId, foglio } = req.params;
    const { donutImg, barreImg } = req.body || {};
    const dati     = db.prepare('SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ? ORDER BY id').all(fileId, foglio);
    const fileInfo = db.prepare('SELECT fc.*, s.nome as struttura_nome FROM file_caricati fc JOIN strutture s ON fc.struttura_id = s.id WHERE fc.id = ?').get(fileId);
    if (!fileInfo) return res.status(404).json({ error: 'File non trovato' });

    const t   = calcolaTotali(dati);
    const pdf = await renderPDF(buildHtmlDottore(fileInfo, foglio, dati, t, donutImg, barreImg));

    const fname = `lavallonea_${fileInfo.struttura_nome.replace(/\s/g,'_')}_${foglio}_dottore.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pdf/completo/:fileId/:foglio  { donutImg, barreImg }
app.post('/api/pdf/completo/:fileId/:foglio', express.json({ limit: '15mb' }), async (req, res) => {
  try {
    const { fileId, foglio } = req.params;
    const { donutImg, barreImg } = req.body || {};
    const dati     = db.prepare('SELECT * FROM dati_foglio WHERE file_id = ? AND foglio = ? ORDER BY id').all(fileId, foglio);
    const fileInfo = db.prepare('SELECT fc.*, s.nome as struttura_nome FROM file_caricati fc JOIN strutture s ON fc.struttura_id = s.id WHERE fc.id = ?').get(fileId);
    if (!fileInfo) return res.status(404).json({ error: 'File non trovato' });

    const t   = calcolaTotali(dati);
    const pdf = await renderPDF(buildHtmlCompleto(fileInfo, foglio, dati, t, donutImg, barreImg));

    const fname = `lavallonea_${fileInfo.struttura_nome.replace(/\s/g,'_')}_${foglio}_completo.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✓ Lavallonea ROI Dashboard`);
  console.log(`  → http://localhost:${PORT}\n`);
});
