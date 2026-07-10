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

test('sendMail senza alcun provider configurato usa il fallback console (non lancia)', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevUser = process.env.SMTP_USER;
  const prevPass = process.env.SMTP_PASS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const r = await mailer.sendMail({ to: 'x@y.z', subject: 's', html: '<b>h</b>' });
  assert.equal(r.mode, 'console');
  if (prevResend) process.env.RESEND_API_KEY = prevResend;
  if (prevUser) process.env.SMTP_USER = prevUser;
  if (prevPass) process.env.SMTP_PASS = prevPass;
});
