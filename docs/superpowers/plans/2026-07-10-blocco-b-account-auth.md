# Blocco B — Account, autenticazione, persistenza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link universale con account personali: registrazione/login/ospite, dati privati per utente, catalogo MYLAV condiviso, recupero password/account via email (Resend), sessione persistente per dispositivo, persistenza dati tra deploy.

**Architecture:** Nuovi moduli `lib/auth.js` (schema utenti/sessioni + crypto con `node:crypto`) e `lib/mailer.js` (invio email via `fetch` a Resend). `server.js` monta lo schema, aggiunge middleware `requireAuth`/`optionalAuth`, le rotte `/api/auth/*`, e mette in scope per `user_id` tutte le rotte dati. Frontend (`public/index.html`, `app.js`, `style.css`): overlay di autenticazione brandizzato, gestione token in `localStorage`, modalità ospite, menu account nella sidebar.

**Tech Stack:** Node/Express, `node:sqlite`, `node:crypto` (scrypt, randomBytes, timingSafeEqual, createHash), `fetch` (Resend), frontend vanilla JS, `node:test`.

## Global Constraints

- **Nessuna nuova dipendenza npm.** Auth con `node:crypto`; email con `fetch`.
- Password valida: **≥8 caratteri, ≥1 cifra, ≥1 carattere speciale**.
- Email normalizzate lowercase+trim, **UNIQUE**.
- Codice univoco di recupero generato **una sola volta alla registrazione**, permanente, mostrato a schermo + inviato via email.
- Sessione **senza scadenza** (resta loggato per dispositivo). Logout cancella la sessione.
- Ospite: **nessuna persistenza** (rotte di scrittura bloccate).
- Catalogo MYLAV (`piani_sconto`, `esami_riferimento`, `prezzi_piano_esame`) **condiviso**; modificabile solo da utenti loggati (modifica globale). Ospite: sola lettura.
- Migrazioni **additive e non distruttive**. Righe legacy con `user_id IS NULL` eliminate una tantum al boot.
- Testo UI in italiano. Palette brand MYLAV (grafite `#26262a`, blu `#0f76bc`, rosso `#ce181e`).
- `test`: `npm test` = `node --test lib/*.test.js`. Modifiche a `server.js`/`lib` → `preview_stop`+`preview_start`.
- Non fare push finché l'utente non lo autorizza.

---

### Task B1: `lib/auth.js` — schema + crypto helpers (TDD)

**Files:**
- Create: `lib/auth.js`
- Create: `lib/auth.test.js`

**Interfaces:**
- Produces:
  - `ensureSchema(db)` — crea `users`, `sessions`, `reset_codes` (idempotente).
  - `validaPassword(pw) -> {ok:boolean, motivo?:string}`
  - `normEmail(email) -> string`
  - `hashPassword(pw) -> string` ("saltHex:hashHex")
  - `verifyPassword(pw, stored) -> boolean`
  - `genToken() -> string` (64 hex)
  - `genRecoveryCode() -> string` (formato `XXXX-XXXX-XXXX`, base32 senza O/0/I/1)
  - `lookupHash(code) -> string` (sha256 hex del codice normalizzato uppercase senza trattini)
  - `genResetCode() -> string` (6 cifre)

- [ ] **Step 1: Test**

Create `lib/auth.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const auth = require('./auth.js');

test('ensureSchema crea users/sessions/reset_codes ed è idempotente', () => {
  const db = new DatabaseSync(':memory:');
  auth.ensureSchema(db); auth.ensureSchema(db);
  const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  assert.ok(t.includes('users') && t.includes('sessions') && t.includes('reset_codes'));
  db.close();
});

test('validaPassword applica lunghezza, cifra e speciale', () => {
  assert.equal(auth.validaPassword('abcdefgh').ok, false);      // no cifra/speciale
  assert.equal(auth.validaPassword('abcdefg1').ok, false);      // no speciale
  assert.equal(auth.validaPassword('Ab1!').ok, false);          // troppo corta
  assert.equal(auth.validaPassword('abcdef1!').ok, true);
});

test('normEmail normalizza lowercase e trim', () => {
  assert.equal(auth.normEmail('  Mario.Rossi@Example.COM '), 'mario.rossi@example.com');
});

test('hashPassword/verifyPassword', () => {
  const h = auth.hashPassword('abcdef1!');
  assert.ok(h.includes(':'));
  assert.equal(auth.verifyPassword('abcdef1!', h), true);
  assert.equal(auth.verifyPassword('sbagliata9!', h), false);
});

test('genToken e genRecoveryCode sono ad alta entropia e distinti', () => {
  const a = auth.genToken(), b = auth.genToken();
  assert.equal(a.length, 64); assert.notEqual(a, b);
  const r = auth.genRecoveryCode();
  assert.match(r, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('lookupHash è stabile e ignora trattini/case', () => {
  const code = 'K7M4-Q2XR-9T5P';
  assert.equal(auth.lookupHash(code), auth.lookupHash('k7m4q2xr9t5p'));
  assert.equal(auth.lookupHash(code).length, 64);
});

test('genResetCode sono 6 cifre', () => {
  assert.match(auth.genResetCode(), /^[0-9]{6}$/);
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `node --test lib/auth.test.js`
Expected: FAIL ("Cannot find module './auth.js'").

- [ ] **Step 3: Implementazione**

Create `lib/auth.js`:

```javascript
'use strict';
const crypto = require('node:crypto');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT UNIQUE NOT NULL,
      pass_hash       TEXT NOT NULL,
      recovery_hash   TEXT NOT NULL,
      recovery_lookup TEXT UNIQUE NOT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reset_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function normEmail(email) { return String(email || '').trim().toLowerCase(); }

function validaPassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return { ok: false, motivo: 'La password deve avere almeno 8 caratteri' };
  if (!/[0-9]/.test(s)) return { ok: false, motivo: 'La password deve contenere almeno un numero' };
  if (!/[^A-Za-z0-9]/.test(s)) return { ok: false, motivo: 'La password deve contenere almeno un carattere speciale' };
  return { ok: true };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const a = Buffer.from(hashHex, 'hex');
  return a.length === hash.length && crypto.timingSafeEqual(a, hash);
}

function genToken() { return crypto.randomBytes(32).toString('hex'); }

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
function genRecoveryCode() {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

function lookupHash(code) {
  const norm = String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function genResetCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

module.exports = {
  ensureSchema, normEmail, validaPassword, hashPassword, verifyPassword,
  genToken, genRecoveryCode, lookupHash, genResetCode
};
```

- [ ] **Step 4: Verifica passaggio**

Run: `node --test lib/auth.test.js`
Expected: PASS (tutti).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.js lib/auth.test.js
git commit -m "feat(auth): lib crypto (scrypt, token, recovery code) + schema utenti"
```

---

### Task B2: `lib/mailer.js` — invio email via Resend (con fallback console)

**Files:**
- Create: `lib/mailer.js`
- Create: `lib/mailer.test.js`

**Interfaces:**
- Produces:
  - `async sendMail({to, subject, html}) -> {sent:boolean, mode:'resend'|'console'}`
  - `templateRecovery(code) -> {subject, html}`
  - `templateReset(code) -> {subject, html}`

- [ ] **Step 1: Test** (verifica i template e il fallback console quando manca la key)

Create `lib/mailer.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('./mailer.js');

test('templateRecovery contiene il codice', () => {
  const t = mailer.templateRecovery('K7M4-Q2XR-9T5P');
  assert.match(t.subject, /recupero|codice/i);
  assert.ok(t.html.includes('K7M4-Q2XR-9T5P'));
});

test('templateReset contiene il codice a 6 cifre', () => {
  const t = mailer.templateReset('123456');
  assert.ok(t.html.includes('123456'));
});

test('sendMail senza RESEND_API_KEY usa il fallback console (non lancia)', async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const r = await mailer.sendMail({ to: 'x@y.z', subject: 's', html: '<b>h</b>' });
  assert.equal(r.mode, 'console');
  if (prev) process.env.RESEND_API_KEY = prev;
});
```

- [ ] **Step 2: Verifica fallimento**

Run: `node --test lib/mailer.test.js`
Expected: FAIL ("Cannot find module './mailer.js'").

- [ ] **Step 3: Implementazione**

Create `lib/mailer.js`:

```javascript
'use strict';

const BRAND = '#0f76bc';

function wrap(bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#26262a;max-width:520px;margin:0 auto">
    <div style="font-size:22px;font-weight:800;letter-spacing:1px;color:#26262a">MYL<span style="color:#ce181e">A</span>V</div>
    <div style="height:3px;background:linear-gradient(90deg,#ce181e 0 50%,#0f76bc 50% 100%);margin:8px 0 16px"></div>
    ${bodyHtml}
    <p style="font-size:11px;color:#9ca3af;margin-top:20px">MYLAV ROI — email automatica, non rispondere.</p>
  </div>`;
}

function templateRecovery(code) {
  return {
    subject: 'Il tuo codice di recupero MYLAV',
    html: wrap(`<p>Grazie per la registrazione. Conserva questo <b>codice di recupero</b>:
      serve per reimpostare email e password se le dimentichi.</p>
      <p style="font-size:22px;font-weight:700;letter-spacing:2px;color:${BRAND};text-align:center;
        border:1px dashed ${BRAND};border-radius:8px;padding:14px">${code}</p>`)
  };
}

function templateReset(code) {
  return {
    subject: 'Reimposta la password — MYLAV ROI',
    html: wrap(`<p>Hai richiesto di reimpostare la password. Inserisci questo codice
      (valido 30 minuti):</p>
      <p style="font-size:26px;font-weight:700;letter-spacing:4px;color:${BRAND};text-align:center">${code}</p>
      <p style="font-size:12px;color:#6b7280">Se non hai richiesto tu il reset, ignora questa email.</p>`)
  };
}

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || 'MYLAV ROI <onboarding@resend.dev>';
  if (!key) {
    console.log(`[mailer:console] To=${to} Subject=${subject}`);
    return { sent: false, mode: 'console' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    if (!resp.ok) { console.error('[mailer] Resend error', resp.status, await resp.text().catch(() => '')); return { sent: false, mode: 'resend' }; }
    return { sent: true, mode: 'resend' };
  } catch (err) {
    console.error('[mailer] fetch failed', err.message);
    return { sent: false, mode: 'resend' };
  }
}

module.exports = { sendMail, templateRecovery, templateReset };
```

- [ ] **Step 4: Verifica passaggio**

Run: `node --test lib/mailer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mailer.js lib/mailer.test.js
git commit -m "feat(auth): mailer Resend via fetch con fallback console + template email"
```

---

### Task B3: server.js — schema utenti, migrazione additiva, middleware auth

**Files:**
- Modify: `server.js` — sezione boot (righe ~22-99) e aggiunta middleware.

**Interfaces:**
- Consumes: `lib/auth.js` (`ensureSchema`, `genToken`, ...).
- Produces: `requireAuth(req,res,next)`, `optionalAuth(req,res,next)` che settano `req.user = {id, email}` o `null`.

- [ ] **Step 1: Import e schema**

In cima a `server.js`, dopo `const pdfimport = require('./lib/pdfimport');`, aggiungere:

```javascript
const auth = require('./lib/auth');
const mailer = require('./lib/mailer');
```

Dopo `concorrenti.ensureSchema(db);` (riga ~99) aggiungere:

```javascript
auth.ensureSchema(db);
```

- [ ] **Step 2: Rimuovere la migrazione distruttiva e renderla additiva**

Sostituire l'attuale blocco "Migra vecchio schema" (righe ~59-81, quello che fa `DROP TABLE IF EXISTS dati_foglio`) con una migrazione additiva che aggiunge `user_id` dove serve, senza mai droppare dati:

```javascript
// Migrazione additiva: aggiunge user_id alle tabelle dati se manca. Mai distruttiva.
function addColIfMissing(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
addColIfMissing('strutture', 'user_id', 'INTEGER');
addColIfMissing('concorrenti', 'user_id', 'INTEGER');
```

(La tabella `prezzi_esami_custom` è creata in `lib/piani.js`; aggiungere lì la colonna `user_id` — vedi Task B5 nota — oppure con `addColIfMissing('prezzi_esami_custom','user_id','INTEGER')` dopo `piani.ensureSchema`. Usare quest'ultima forma qui per centralizzare.)

Aggiungere anche:

```javascript
addColIfMissing('prezzi_esami_custom', 'user_id', 'INTEGER');
```

Nota: `strutture.nome UNIQUE` a livello colonna resta, ma per l'unicità per-utente si gestisce in `POST /api/calcolo/salva` e nelle creazioni controllando `WHERE nome = ? AND user_id = ?` (SQLite non consente di rimuovere un UNIQUE con ALTER senza ricreare la tabella; per non essere distruttivi si evita il vincolo globale a livello applicativo — vedi B5).

- [ ] **Step 3: Pulizia righe legacy senza proprietario (una tantum, non distruttiva sui dati utente)**

Dopo le migrazioni, aggiungere:

```javascript
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
```

- [ ] **Step 4: Middleware auth**

Dopo la creazione di `app` e i middleware base (dopo `const upload = ...`/prima delle rotte), aggiungere:

```javascript
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
```

- [ ] **Step 5: Verifica boot**

Run: `node -c server.js` → exit 0.
`preview_stop` + `preview_start`; `preview_logs` non deve mostrare errori di boot; le tabelle `users/sessions/reset_codes` esistono (verifica via una rotta di health o log). `npm test` resta verde.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(auth): schema utenti, migrazione additiva non distruttiva, middleware auth"
```

---

### Task B4: server.js — rotte `/api/auth/*`

**Files:**
- Modify: `server.js` — aggiungere il gruppo rotte auth (dopo i middleware, prima delle rotte dati).

**Interfaces:**
- Consumes: `auth.*`, `mailer.*`, `db`.
- Produces: rotte `POST /api/auth/register|login|logout|request-reset|reset-password|recover-full`, `GET /api/auth/me`.

- [ ] **Step 1: Implementazione rotte**

```javascript
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
    res.json({ token, email, recoveryCode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', express.json(), (req, res) => {
  try {
    const email = auth.normEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!u || !auth.verifyPassword(password, u.pass_hash)) return res.status(401).json({ error: 'Email o password errati' });
    const token = auth.genToken();
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`).run(token, u.id);
    res.json({ token, email: u.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-auth-token'] || '');
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ email: req.user.email }));

app.post('/api/auth/request-reset', express.json(), async (req, res) => {
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

app.post('/api/auth/reset-password', express.json(), (req, res) => {
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

app.post('/api/auth/recover-full', express.json(), (req, res) => {
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
```

- [ ] **Step 2: Verifica**

Run: `node -c server.js` → exit 0. `preview_stop`+`preview_start`.
Via `preview_eval`/`fetch`: register nuova email → `{token, recoveryCode}`; register stessa email → 409; login corretto → token; login sbagliato → 401; `/api/auth/me` con token → `{email}`; senza token → 401; request-reset → 200; reset-password con codice dal log → 200; recover-full con recoveryCode → 200 e login con nuova email/pass funziona. `preview_logs` mostra `[mailer:console]` (senza key).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(auth): rotte register/login/logout/me/reset/recover-full"
```

---

### Task B5: server.js — scoping dati per utente + `prezzi_esami_custom.user_id`

**Files:**
- Modify: `server.js` — tutte le rotte dati elencate sotto.
- Modify: `lib/piani.js` — `salvaPrezzoCustom` e `resolvePrezzo`/lettura custom per includere `user_id` (firma estesa).
- Modify: `lib/concorrenti.js` — `upsertConcorrente`, `listaConcorrenti`, `dettaglioConcorrente`, `trovaMatch`, `eliminaConcorrente` per filtrare/assegnare `user_id`.

**Principio:** ogni rotta che legge/scrive dati utente monta `requireAuth` e filtra per `req.user.id`. Il catalogo MYLAV resta pubblico in lettura (con `optionalAuth`). Ospite → 401 sulle scritture.

**Classificazione rotte:**

*Pubbliche in lettura (usare `optionalAuth`; se `req.user` scoping ai suoi dati, altrimenti solo catalogo):*
- `GET /api/piani`, `GET /api/piani/:id/prezzo`, `GET /api/piani/consiglio`, `POST /api/piani/consiglio-totale`, `POST /api/piani/classifica`, `GET /api/piani/:id`, `GET /api/esami-riferimento/prezzo-base`, `GET /api/esami-riferimento/nomi`, `GET /api/esami/prezzi`, `GET /api/esami/autocomplete`.
  - Per `autocomplete`/`esami/nomi`/`esami/prezzi`: se `req.user`, filtrare le UNION su `dati_foglio`/`prezzi_esami_custom`/`esami_concorrente` per `user_id`; se ospite, includere solo `esami_riferimento` (catalogo). Aggiungere le clausole `WHERE ... user_id = ?` di conseguenza.

*Solo utente (usare `requireAuth` + filtro `user_id`):*
- `GET /api/strutture` → `WHERE user_id = ?`.
- `GET /api/strutture/:id/file`, `GET /api/file/:id/dati`, `GET /api/strutture/:id/aggregato` → verificare che la struttura/file appartenga a `req.user.id` (JOIN `strutture.user_id`), altrimenti 404.
- `GET /api/dashboard`, `GET /api/cronologia`, `GET /api/confronto` → aggregare solo strutture/file dell'utente.
- `POST /api/upload`, `POST /api/calcolo/salva`, `POST /api/export-excel` → creano/leggono sotto `req.user.id`; in `calcolo/salva` la struttura si cerca/crea con `WHERE nome = ? AND user_id = ?` e si inserisce `user_id`.
- `DELETE /api/cronologia/:id`, `DELETE /api/strutture/:id` → verificare proprietà prima di eliminare.
- `POST /api/pdf/dottore/:fileId/:foglio` → verificare che il file sia dell'utente.
- Concorrenti: `GET /api/concorrenti`, `GET /api/concorrenti/:id`, `GET /api/concorrenti/:id/match`, `POST /api/concorrenti/:id/conferma-match`, `POST /api/concorrenti/:id/rimuovi-match`, `DELETE /api/concorrenti/:id`, `POST /api/concorrenti/import`, `POST /api/concorrenti/import/conferma`, `POST /api/concorrenti/import-pdf`, `POST /api/concorrenti/import-pdf/conferma` → tutti `requireAuth` + `user_id`.
- `POST /api/prezzi-custom` → `requireAuth`, salva con `user_id`.

*Catalogo scrivibile (utenti loggati, modifica globale):*
- `PUT /api/piani/:id/prezzi`, `PUT /api/piani/:id/attivo`, `POST /api/piani/import`, `POST /api/concorrenti/import` (no, è dati) → per i tre `piani` usare `requireAuth` (qualsiasi utente loggato può modificare il catalogo condiviso).

- [ ] **Step 1: Estendere `lib/concorrenti.js` con `user_id`**

- `upsertConcorrente(db, nomeConcorrente, righe, userId)`: l'INSERT/lookup del concorrente usa `user_id`; unicità per `(user_id, nome)` a livello applicativo (`SELECT id FROM concorrenti WHERE nome = ? AND user_id = ?`); l'INSERT include `user_id`.
- `listaConcorrenti(db, userId)`: `WHERE c.user_id = ?`.
- `dettaglioConcorrente(db, id, userId)`: `WHERE id = ? AND user_id = ?`.
- `trovaMatch(db, concorrenteId, nome)`: invariato (il concorrente è già dell'utente perché filtrato a monte), ma la rotta deve prima verificare che `concorrenteId` sia dell'utente.
- `eliminaConcorrente(db, id, userId)`: `WHERE id = ? AND user_id = ?`.
- Aggiornare i test di `lib/concorrenti.test.js` passando un `userId` fittizio (es. 1) e verificando l'isolamento tra due userId diversi (un concorrente di user 1 non compare nella lista di user 2).

- [ ] **Step 2: Estendere `lib/piani.js` prezzi custom con `user_id`**

- `salvaPrezzoCustom(db, esameNome, pianoId, prezzo, userId)`: INSERT/UPSERT include `user_id`; il conflitto è su `(esame_id, piano_id, user_id)` — aggiornare lo schema di `prezzi_esami_custom` in `ensureSchema` per includere `user_id` e l'UNIQUE su `(piano_id, esame_id, user_id)` (creazione idempotente; per DB esistenti la colonna è aggiunta via `addColIfMissing` in server.js).
- La lettura dei prezzi custom (in `resolvePrezzo`/`getPrezzoBase` o dove si consultano) deve filtrare per `user_id` quando fornito; per l'ospite/catalogo, ignorare i custom.
- Aggiornare `lib/piani.test.js` di conseguenza (custom price isolato per utente).

- [ ] **Step 3: Applicare middleware e filtri alle rotte**

Esempio rappresentativo — `GET /api/strutture`:

```javascript
app.get('/api/strutture', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.nome, COUNT(fc.id) AS file_count, GROUP_CONCAT(DISTINCT df.foglio) AS fogli_csv
      FROM strutture s
      LEFT JOIN file_caricati fc ON fc.struttura_id = s.id
      LEFT JOIN dati_foglio df ON df.file_id = fc.id
      WHERE s.user_id = ?
      GROUP BY s.id ORDER BY s.nome
    `).all(req.user.id);
    // ...mappatura invariata...
    res.json(/* ... */);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

Esempio — `POST /api/calcolo/salva` (creazione struttura per utente):

```javascript
let strRow = db.prepare('SELECT id FROM strutture WHERE nome = ? AND user_id = ?').get(strutturaNome, req.user.id);
if (!strRow) {
  const r = db.prepare('INSERT INTO strutture (nome, user_id) VALUES (?, ?)').run(strutturaNome, req.user.id);
  strRow = { id: Number(r.lastInsertRowid) };
}
```

Esempio — verifica proprietà su `DELETE /api/strutture/:id`:

```javascript
const owned = db.prepare('SELECT 1 FROM strutture WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
if (!owned) return res.status(404).json({ error: 'Struttura non trovata' });
```

Applicare lo stesso pattern (requireAuth + filtro/verifica `user_id`) a **tutte** le rotte elencate nella classificazione sopra. Per le rotte concorrenti, passare `req.user.id` alle funzioni `lib/concorrenti.js` estese e verificare la proprietà di `:id` prima di match/conferma/rimozione/eliminazione. Per `optionalAuth` sulle rotte catalogo/autocomplete, usare `optionalAuth` e ramo `req.user ? scoped : catalogOnly`.

- [ ] **Step 4: Aggiornare i test lib e verifica isolamento**

Run: `npm test` → tutti verdi (inclusi i test aggiornati di piani/concorrenti con isolamento per utente).

- [ ] **Step 5: Verifica live isolamento**

`preview_stop`+`preview_start`. Via fetch con due token (due utenti registrati):
- User A salva una struttura → compare in `GET /api/strutture` di A, **non** di B.
- Concorrenti/custom price idem.
- Ospite (nessun token) su `GET /api/strutture` → 401; su `GET /api/piani` → 200 (catalogo).

- [ ] **Step 6: Commit**

```bash
git add server.js lib/piani.js lib/piani.test.js lib/concorrenti.js lib/concorrenti.test.js
git commit -m "feat(auth): scoping per utente di strutture, file, concorrenti, prezzi custom"
```

---

### Task B6: Frontend — token, boot, wrapper `api()`, overlay auth

**Files:**
- Modify: `public/index.html` — contenitore overlay auth.
- Modify: `public/app.js` — boot, `api()`, stato auth, funzioni di flusso.
- Modify: `public/style.css` — stile schermata auth brand.

**Interfaces:**
- Consumes: rotte `/api/auth/*`.
- Produces: `S.auth = {token, email, guest}`; funzioni `authRegister/authLogin/authLogout/authGuest/mostraAuthScreen/nascondiAuthScreen`; `api()` invia il token.

- [ ] **Step 1: Overlay in `index.html`**

Aggiungere, subito dentro `<body>` prima del layout app, un contenitore:

```html
<div id="auth-overlay" style="display:none"></div>
```

- [ ] **Step 2: Token nel wrapper `api()` e nelle fetch**

In `public/app.js`, individuare il wrapper `api(url, opts)` e aggiungere l'header token:

```javascript
function authHeaders(extra = {}) {
  const h = { ...extra };
  if (S.auth && S.auth.token) h['Authorization'] = 'Bearer ' + S.auth.token;
  return h;
}
```

In `api()` unire `authHeaders()` agli headers. Per le `fetch` dirette verso rotte dati (autocomplete, prezzo-base, match, ecc.) aggiungere `headers: authHeaders({'Content-Type':'application/json'})`. Se una risposta è `401`, chiamare `authLogout(true)` (mostra la schermata auth).

Aggiungere lo stato:

```javascript
S.auth = { token: localStorage.getItem('authToken') || null, email: localStorage.getItem('authEmail') || null, guest: false };
```

- [ ] **Step 3: Boot con controllo sessione**

Nel punto di avvio (`init` / `DOMContentLoaded`), prima di costruire l'app:

```javascript
async function boot() {
  if (S.auth.token) {
    try {
      const me = await fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.ok ? r.json() : null);
      if (me) { S.auth.email = me.email; nascondiAuthScreen(); return avviaApp(); }
    } catch (_) {}
  }
  mostraAuthScreen();
}
```

`avviaApp()` = l'attuale sequenza (`loadStrutture`, `loadPiani`, `loadConcorrenti`, `buildSidebar`, `navigate('dashboard')`). `mostraAuthScreen()` popola `#auth-overlay` (Step 5) e lo mostra; `nascondiAuthScreen()` lo nasconde.

- [ ] **Step 4: Funzioni di flusso auth**

```javascript
function salvaSessione(token, email) {
  S.auth.token = token; S.auth.email = email; S.auth.guest = false;
  localStorage.setItem('authToken', token); localStorage.setItem('authEmail', email);
}
async function authLogin(email, password) {
  const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Login fallito');
  salvaSessione(d.token, d.email); nascondiAuthScreen(); avviaApp();
}
async function authRegister(email, password) {
  const r = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Registrazione fallita');
  salvaSessione(d.token, d.email);
  return d.recoveryCode; // il chiamante mostra la schermata "salva il codice"
}
function authGuest() { S.auth = { token:null, email:null, guest:true }; nascondiAuthScreen(); avviaApp(); }
async function authLogout(silent) {
  if (S.auth.token) { try { await fetch('/api/auth/logout', { method:'POST', headers: authHeaders() }); } catch(_){} }
  S.auth = { token:null, email:null, guest:false };
  localStorage.removeItem('authToken'); localStorage.removeItem('authEmail');
  mostraAuthScreen();
}
```

- [ ] **Step 5: Markup schermata auth (brand MYLAV) in `mostraAuthScreen()`**

`mostraAuthScreen()` imposta `#auth-overlay.innerHTML` con card centrata: logo MYLAV in primo piano (riusare l'SVG A rosso/blu come in `index.html`), barra brand, tab Accedi/Registrati, form, link Ospite + recuperi. Esempio struttura:

```javascript
function mostraAuthScreen(vista = 'login') {
  const ov = el('auth-overlay');
  ov.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">MYL<svg viewBox="0 0 100 100" width="26" height="30">
        <polygon points="6,94 40,10 52,10 22,94" fill="#ce181e"/>
        <polygon points="94,94 60,10 48,10 78,94" fill="#0f76bc"/></svg>V<span class="auth-reg">®</span></div>
      <div class="auth-rule"></div>
      <div class="auth-tabs">
        <button class="auth-tab ${vista==='login'?'active':''}" onclick="mostraAuthScreen('login')">Accedi</button>
        <button class="auth-tab ${vista==='register'?'active':''}" onclick="mostraAuthScreen('register')">Registrati</button>
      </div>
      <div id="auth-body"></div>
      <div class="auth-links">
        <a onclick="authGuest()">Entra come ospite</a>
        <a onclick="mostraAuthScreen('reset')">Password dimenticata?</a>
        <a onclick="mostraAuthScreen('recover')">Ho dimenticato email e password</a>
      </div>
    </div>`;
  ov.style.display = 'flex';
  renderAuthBody(vista);
}
```

`renderAuthBody(vista)` costruisce il form giusto (login: email+password+bottone; register: email+password con hint requisiti+validazione live, poi mostra il codice; reset: email→codice→nuova password; recover: codice+nuova email+nuova password). Ogni submit chiama la funzione di flusso e mostra errori inline. La validazione password client-side rispecchia `≥8, ≥1 cifra, ≥1 speciale`.

- [ ] **Step 6: CSS schermata auth (`style.css`)**

Aggiungere stile brand: overlay a tutta pagina (`position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:2000`), `.auth-card` (bianca, `max-width:380px`, ombra, radius, padding, centrata), `.auth-logo` (grande, grafite, centrato), `.auth-rule` (barra rossa/blu come `.brand-rule`), tab, input full-width, bottone primario blu, link discreti, messaggi errore rossi. Usare i token esistenti.

- [ ] **Step 7: Verifica live**

`preview_stop`+`preview_start`. Cancellare `localStorage` → al reload compare la schermata auth centrata brandizzata. Registrare un utente → mostra codice → entra in app. Reload → resta loggato (nessuna richiesta login). Logout → torna alla schermata. Login → rientra. Ospite → entra senza token. `preview_screenshot` per conferma visiva; `preview_console_logs level error` vuoto.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat(auth): overlay login/registrazione/ospite brandizzato + sessione persistente"
```

---

### Task B7: Frontend — menu account nella sidebar + gating ospite

**Files:**
- Modify: `public/app.js` — `buildSidebar` (icona omino in basso), gating scritture ospite.
- Modify: `public/style.css` — stile pulsante account.

**Interfaces:**
- Consumes: `S.auth`, `authLogout`, `mostraAuthScreen`, `authGuest`.

- [ ] **Step 1: Icona account in basso a destra nella sidebar**

In `buildSidebar`, in fondo alla sidebar (dopo il gruppo "Altro"), aggiungere un blocco account fissato in basso:

```javascript
  html += `
    <div class="sidebar-account">
      <button class="account-btn" onclick="toggleAccountMenu()" title="Account">
        <span class="account-ico">👤</span>
        <span class="account-email">${S.auth.guest ? 'Ospite' : (S.auth.email || 'Account')}</span>
      </button>
      <div id="account-menu" class="account-menu" style="display:none">
        ${S.auth.guest || !S.auth.token ? `
          <div onclick="mostraAuthScreen('login')">Accedi</div>
          <div onclick="mostraAuthScreen('register')">Registrati</div>
          <div onclick="authGuest()">Entra come ospite</div>` : `
          <div onclick="authLogout()">Logout</div>
          <div onclick="mostraAuthScreen('login')">Cambia account</div>`}
      </div>
    </div>`;
```

Aggiungere `function toggleAccountMenu(){ const m = el('account-menu'); if(m) m.style.display = m.style.display==='none'?'block':'none'; }`. La sidebar deve avere layout a colonna con questo blocco in fondo (`margin-top:auto`).

- [ ] **Step 2: Gating ospite sulle scritture**

Per l'ospite (`S.auth.guest`), disabilitare/bloccare le azioni di salvataggio: `salvaCalcolo`, creazione struttura, import concorrenti/piani, gestione mappature. Aggiungere all'inizio di queste funzioni:

```javascript
  if (S.auth.guest || !S.auth.token) { roiMsg('Accedi per salvare i dati', 'error'); return; }
```

(usare l'equivalente esistente di messaggio/toast per il contesto; per i pannelli Gestione, mostrare un avviso "Accedi per salvare").

- [ ] **Step 3: CSS**

`.sidebar-account` fissato in basso (`margin-top:auto; border-top:1px solid var(--line); padding:10px 12px`), `.account-btn` (flex, icona + email troncata), `.account-menu` (popover sopra il bottone, voci cliccabili con hover `var(--blue-tint)`).

- [ ] **Step 4: Verifica live**

Loggato: l'omino mostra l'email; menu → Logout/Cambia account. Ospite: mostra "Ospite"; salvare un calcolo → messaggio "Accedi per salvare"; menu → Accedi/Registrati. `preview_screenshot`.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(auth): menu account in sidebar + gating salvataggi per ospite"
```

---

### Task B8: Documentazione persistenza Railway + verifica end-to-end

**Files:**
- Create/Modify: `README.md` (o `docs/deploy-railway.md`).

- [ ] **Step 1: Documentare i passi Railway**

Scrivere una sezione "Persistenza e configurazione Railway":
- Creare un **Volume** montato su `/data`.
- Variabili d'ambiente: `DB_PATH=/data/database.sqlite`, `UPLOADS_DIR=/data/uploads`, `RESEND_API_KEY=<key>`, `MAIL_FROM=MYLAV ROI <noreply@dominio-verificato>`.
- Nota: senza dominio verificato, Resend invia solo alla propria email di account (dominio di test `onboarding@resend.dev`).
- Con il volume, i dati (utenti, strutture, calcoli, concorrenti) persistono tra i deploy.

- [ ] **Step 2: Verifica end-to-end completa nel browser**

Scenario utente reale (due utenti + ospite): registrazione (con codice mostrato+email in console), logout, login, isolamento dati tra utenti, ospite senza persistenza, reset password (codice da console), recupero totale via codice, sessione persistente al reload, PDF "Resoconto struttura" per un file dell'utente. Zero errori console. `npm test` verde.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: configurazione persistenza e email su Railway (volume + env)"
```

---

## Self-Review

- **Spec coverage:** B1 (crypto/schema) B2 (email) B3 (schema+migrazione additiva+middleware+legacy wipe) B4 (rotte auth: register/login/logout/me/reset/recover-full) B5 (scoping per utente + catalogo condiviso) B6 (overlay auth brand + sessione persistente + ospite + api token) B7 (menu account omino + gating ospite) B8 (persistenza Railway + verifica). Tutti i punti dello spec B0-B8 sono coperti.
- **Placeholder scan:** codice completo per lib/rotte; il frontend fornisce markup/funzioni concrete e per le parti ripetitive (renderAuthBody, scoping delle molte rotte) indica pattern e codice rappresentativo con elenco esaustivo — nessun "TODO".
- **Type consistency:** `S.auth={token,email,guest}`, `authHeaders()`, `salvaSessione(token,email)`, `avviaApp()`, `mostraAuthScreen(vista)`, `renderAuthBody(vista)`, `requireAuth`/`optionalAuth`, `auth.*`/`mailer.*` usati coerentemente tra i task.
- **Vincolo dipendenze:** nessun pacchetto npm nuovo (crypto/fetch nativi).

## Note per l'esecuzione multi-agente

- Ordine consigliato: B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 (B5 dipende da B1/B3; il frontend B6/B7 dipende da B3/B4).
- B5 è il task più ampio (molte rotte): può essere spezzato dall'esecutore in sotto-lotti (strutture/file/dashboard; concorrenti; prezzi-custom/catalogo) mantenendo lo stesso pattern.
