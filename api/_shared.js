'use strict';
// Shared helpers for the Vercel serverless functions.
// Files starting with "_" inside /api are NOT exposed as routes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]{1,79}$/u;
const CITY_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'()-]{1,59}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONSENT_VERSIONS = new Set(['v1']);

// Strip characters that could turn a cell into a spreadsheet formula (CSV/Excel injection).
function clean(s, max) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[=+\-@\t\r]+/, '')
    .slice(0, max);
}

// Returns an E.164 number or null. Indian numbers must be 10 digits starting 6-9.
function normPhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s().-]/g, '');
  if (/^00\d{8,15}$/.test(s)) s = '+' + s.slice(2);
  if (/^0?[6-9]\d{9}$/.test(s)) return '+91' + s.slice(-10);
  if (/^91[6-9]\d{9}$/.test(s)) return '+' + s;
  if (/^\+91/.test(s)) return /^\+91[6-9]\d{9}$/.test(s) ? s : null;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}

function validateRegistration(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'Invalid request.' };
  const name = clean(b.name, 80);
  const email = clean(b.email, 254).toLowerCase();
  const city = clean(b.city, 60);
  const whatsapp = normPhone(b.whatsapp);
  if (!NAME_RE.test(name)) return { ok: false, error: 'Please enter your full name (letters only).' };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'Please enter a valid email address.' };
  if (!CITY_RE.test(city)) return { ok: false, error: 'Please enter your city.' };
  if (!whatsapp) return { ok: false, error: 'Please enter a valid WhatsApp number (Indian 10-digit, or international with country code).' };
  if (b.age18 !== true || b.consent !== true) return { ok: false, error: 'You must confirm you are 18+ and give consent to continue.' };
  const consentVersion = CONSENT_VERSIONS.has(b.consentVersion) ? b.consentVersion : 'v1';
  return { ok: true, data: { name, email, city, whatsapp, marketing: b.marketing === true, consentVersion } };
}

function validateEvent(b) {
  if (!b || typeof b !== 'object') return { ok: false };
  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) return { ok: false };
  const duration = Number(b.duration), score = b.score == null ? null : Number(b.score);
  if (!Number.isFinite(duration) || duration < 0 || duration > 14400) return { ok: false };
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) return { ok: false };
  return { ok: true, data: { id: b.id, duration: Math.round(duration), score: score === null ? '' : Math.round(score), hasVideo: b.hasVideo === true } };
}

function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return null; } }
  return null;
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Best-effort in-memory limiter (resets on cold start, per instance).
// For stronger protection enable Vercel Firewall rate limiting (see README).
const hits = new Map();
function rateLimited(ip, bucket, limit, windowMs) {
  const now = Date.now(), key = bucket + ':' + ip;
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return arr.length > limit;
}

// Same-origin check; extra origins can be allowed with ALLOWED_ORIGINS (comma-separated).
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // non-browser clients (curl) have no Origin
  let host; try { host = new URL(o).host; } catch (e) { return false; }
  if (host === req.headers.host) return true;
  const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return extra.includes(o);
}

// Forwards a payload to the Google Apps Script web app. The secret never reaches the browser.
// Apps Script can be slow on a cold start, so the timeout is generous and callers may allow retries.
async function forwardOnce(payload, timeoutMs) {
  const url = process.env.SHEET_WEBHOOK_URL, secret = process.env.SHEET_SECRET;
  if (!url || !secret) throw new Error('not_configured');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), signal: ctrl.signal, redirect: 'follow' });
    const text = await r.text();
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

// opts.retries: extra attempts after a failure (use only for idempotent calls such as registration,
// which the Sheet de-duplicates by email). opts.timeoutMs: per-attempt timeout.
async function forward(payload, opts) {
  const retries = (opts && opts.retries) || 0, timeoutMs = (opts && opts.timeoutMs) || 12000;
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await forwardOnce(payload, timeoutMs);
      if (r && r.ok) return r;
      last = new Error((r && r.error) || 'bad_response');
    } catch (e) { last = e; }
    if (i < retries) await new Promise(res => setTimeout(res, 700));
  }
  throw last;
}

module.exports = { UUID_RE, clean, normPhone, validateRegistration, validateEvent, parseBody, clientIp, rateLimited, originOk, forward };
