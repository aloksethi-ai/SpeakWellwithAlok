'use strict';
// Run: node tests/api.test.js   (no dependencies; spins up a fake Apps Script endpoint)
const http = require('http');
const assert = require('assert');
const S = require('../api/_shared');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('ok  -', name); }, e => { console.error('FAIL -', name, '\n', e); process.exitCode = 1; });

const good = { name: 'Rahul Sharma', email: 'Rahul@Example.com', city: 'Ajmer', whatsapp: '98765 43210', age18: true, consent: true, marketing: false, consentVersion: 'v1' };

function mockRes() {
  const r = { code: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; };
  return r;
}

(async () => {
  await t('phone normalisation', () => {
    assert.strictEqual(S.normPhone('98765 43210'), '+919876543210');
    assert.strictEqual(S.normPhone('09876543210'), '+919876543210');
    assert.strictEqual(S.normPhone('919876543210'), '+919876543210');
    assert.strictEqual(S.normPhone('+91-98765-43210'), '+919876543210');
    assert.strictEqual(S.normPhone('+14155552671'), '+14155552671');
    assert.strictEqual(S.normPhone('12345'), null);
    assert.strictEqual(S.normPhone('+911234567890'), null);
    assert.strictEqual(S.normPhone('5876543210'), null);
  });
  await t('valid registration is normalised', () => {
    const v = S.validateRegistration(good);
    assert.ok(v.ok); assert.strictEqual(v.data.email, 'rahul@example.com'); assert.strictEqual(v.data.whatsapp, '+919876543210');
  });
  await t('rejects bad input / missing consent', () => {
    assert.ok(!S.validateRegistration({ ...good, name: 'A' }).ok);
    assert.ok(!S.validateRegistration({ ...good, email: 'nope' }).ok);
    assert.ok(!S.validateRegistration({ ...good, city: '' }).ok);
    assert.ok(!S.validateRegistration({ ...good, whatsapp: '123' }).ok);
    assert.ok(!S.validateRegistration({ ...good, consent: false }).ok);
    assert.ok(!S.validateRegistration({ ...good, age18: false }).ok);
    assert.ok(!S.validateRegistration({ ...good, consent: 'true' }).ok);
    assert.ok(!S.validateRegistration(null).ok);
  });
  await t('formula injection is neutralised', () => {
    assert.strictEqual(S.clean('=HYPERLINK("x")', 80), 'HYPERLINK("x")');
    const v = S.validateRegistration({ ...good, name: '=cmd Rahul' });
    assert.ok(!v.ok || !/^[=+\-@]/.test(v.data.name));
  });
  await t('unicode names accepted', () => {
    assert.ok(S.validateRegistration({ ...good, name: 'Ananya Iyer', city: 'Chennai' }).ok);
    assert.ok(S.validateRegistration({ ...good, name: 'José Álvarez', city: 'São Paulo' }).ok);
  });
  await t('event validation', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    assert.ok(S.validateEvent({ id, duration: 120, score: 71.6, hasVideo: true }).ok);
    assert.strictEqual(S.validateEvent({ id, duration: 120, score: 71.6 }).data.score, 72);
    assert.ok(!S.validateEvent({ id: 'x', duration: 1, score: 1 }).ok);
    assert.ok(!S.validateEvent({ id, duration: -5, score: 1 }).ok);
    assert.ok(!S.validateEvent({ id, duration: 5, score: 500 }).ok);
  });

  // fake Apps Script endpoint
  const received = [];
  let failNext = 0;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { if (failNext > 0) { failNext--; res.statusCode = 500; return res.end('<html>temporary error</html>'); } const j = JSON.parse(b); received.push(j); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j.secret === 'sekret' ? { ok: true, id: '123e4567-e89b-42d3-a456-426614174000' } : { ok: false, error: 'unauthorized' })); }); });
  await new Promise(r => srv.listen(0, r));
  process.env.SHEET_WEBHOOK_URL = 'http://127.0.0.1:' + srv.address().port + '/exec';
  process.env.SHEET_SECRET = 'sekret';
  const register = require('../api/register'), event = require('../api/event');
  const req = (body, extra) => ({ method: 'POST', headers: { host: 'app.example', origin: 'https://app.example', 'x-forwarded-for': '1.1.1.' + Math.floor(Math.random() * 250) }, body, ...extra });

  await t('register: happy path forwards secret + data server-side', async () => {
    const r = mockRes(); await register(req(good), r);
    assert.strictEqual(r.code, 200); assert.ok(r.body.ok && r.body.id);
    const sent = received.pop(); assert.strictEqual(sent.type, 'register'); assert.strictEqual(sent.secret, 'sekret'); assert.strictEqual(sent.whatsapp, '+919876543210');
    assert.ok(!('secret' in r.body));
  });
  await t('register: wrong method / foreign origin / bad body', async () => {
    let r = mockRes(); await register({ method: 'GET', headers: {} }, r); assert.strictEqual(r.code, 405);
    r = mockRes(); await register(req(good, { headers: { host: 'app.example', origin: 'https://evil.example' } }), r); assert.strictEqual(r.code, 403);
    r = mockRes(); await register(req({ ...good, consent: false }), r); assert.strictEqual(r.code, 400);
  });
  await t('register: honeypot does not reach the sheet', async () => {
    const before = received.length; const r = mockRes(); await register(req({ ...good, website: 'http://spam' }), r);
    assert.strictEqual(r.code, 200); assert.strictEqual(received.length, before);
  });
  await t('register: rate limit after 8 attempts per IP', async () => {
    let last; for (let i = 0; i < 10; i++) { last = mockRes(); await register({ ...req(good), headers: { host: 'app.example', 'x-forwarded-for': '9.9.9.9' } }, last); }
    assert.strictEqual(last.code, 429);
  });
  await t('register: backend failure returns 502 without leaking details', async () => {
    const saved = process.env.SHEET_SECRET; process.env.SHEET_SECRET = 'wrong';
    const r = mockRes(); await register(req(good), r); process.env.SHEET_SECRET = saved;
    assert.strictEqual(r.code, 502); assert.ok(!/unauthorized|secret/i.test(JSON.stringify(r.body)));
  });
  await t('register: one transient backend failure is retried and succeeds', async () => {
    failNext = 1; const r = mockRes(); await register(req(good), r);
    assert.strictEqual(r.code, 200); assert.ok(r.body.ok && r.body.id);
  });
  await t('register: two consecutive failures still return a clean 502', async () => {
    failNext = 2; const r = mockRes(); await register(req(good), r);
    assert.strictEqual(r.code, 502); assert.ok(!/temporary|html/i.test(JSON.stringify(r.body)));
  });
  await t('event: valid event forwarded, invalid rejected', async () => {
    let r = mockRes(); await event(req({ id: '123e4567-e89b-42d3-a456-426614174000', duration: 90, score: 64, hasVideo: true }), r);
    assert.strictEqual(r.code, 200); assert.strictEqual(received.pop().type, 'event');
    r = mockRes(); await event(req({ id: 'bad', duration: 90, score: 64 }), r); assert.strictEqual(r.code, 400);
  });
  srv.close();
  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' - WITH FAILURES' : ''));
})();
