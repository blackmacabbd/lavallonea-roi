'use strict';
const nodemailer = require('nodemailer');
const dns = require('node:dns');

// Molti host cloud (Railway incluso) non hanno uscita IPv6: senza questa
// preferenza Node prova prima l'IPv6 di Gmail e fallisce con ENETUNREACH.
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

const BRAND = '#0f76bc';

let _transporter = null;
function getTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      family: 4, // forza IPv4: alcuni host cloud non hanno connettività IPv6 in uscita
      auth: { user, pass }
    });
  }
  return _transporter;
}

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

function logConsoleFallback(to, subject, html) {
  const plain = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`[mailer:console] Email NON inviata (nessun provider configurato).\n  To=${to}\n  Subject=${subject}\n  Testo: ${plain}`);
}

// "Nome <email@dominio>" -> {name, email}. SendGrid vuole i due campi separati.
function parseFrom(headerStr) {
  const s = String(headerStr || '').trim();
  const m = s.match(/^(.*?)<(.+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || undefined, email: m[2].trim() };
  return { name: undefined, email: s };
}

// SendGrid: invia via HTTPS (porta 443), non bloccata dai firewall in uscita
// dei cloud host che invece bloccano SMTP (25/465/587). Richiede solo la
// verifica di un singolo mittente ("Single Sender"), non un dominio.
async function sendViaSendGrid({ to, subject, html }) {
  const key = process.env.SENDGRID_API_KEY;
  const from = parseFrom(process.env.MAIL_FROM || 'MYLAV ROI <noreply@example.com>');
  try {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    });
    if (!resp.ok) {
      console.error('[mailer] SendGrid error', resp.status, await resp.text().catch(() => ''));
      return { sent: false, mode: 'sendgrid' };
    }
    return { sent: true, mode: 'sendgrid' };
  } catch (err) {
    console.error('[mailer] SendGrid invio fallito', err.message);
    return { sent: false, mode: 'sendgrid' };
  }
}

// Ordine: SendGrid (SENDGRID_API_KEY, via HTTPS) -> SMTP Gmail -> Resend -> log console.
// SendGrid è la scelta consigliata sui cloud host che bloccano le porte SMTP in uscita.
async function sendMail({ to, subject, html }) {
  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid({ to, subject, html });
  }

  const transporter = getTransporter();
  if (transporter) {
    const from = process.env.MAIL_FROM || `MYLAV ROI <${process.env.SMTP_USER}>`;
    try {
      await transporter.sendMail({ from, to, subject, html });
      return { sent: true, mode: 'smtp' };
    } catch (err) {
      console.error('[mailer] SMTP invio fallito', err.message);
      return { sent: false, mode: 'smtp' };
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logConsoleFallback(to, subject, html);
    return { sent: false, mode: 'console' };
  }
  const from = process.env.MAIL_FROM || 'MYLAV ROI <onboarding@resend.dev>';
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
