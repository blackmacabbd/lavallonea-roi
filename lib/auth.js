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
