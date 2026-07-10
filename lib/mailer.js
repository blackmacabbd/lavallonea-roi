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
    // Sviluppo senza provider: logga il contenuto (codice incluso) così è leggibile in console.
    const plain = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`[mailer:console] Nessun RESEND_API_KEY — email NON inviata.\n  To=${to}\n  Subject=${subject}\n  Testo: ${plain}`);
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
