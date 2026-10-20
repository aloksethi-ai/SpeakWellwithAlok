'use strict';
const { validateRegistration, parseBody, clientIp, rateLimited, originOk, forward } = require('./_shared');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }
  if (!originOk(req)) return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
  if (rateLimited(clientIp(req), 'reg', 8, 60 * 60 * 1000)) return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });

  const body = parseBody(req);
  if (!body) return res.status(400).json({ ok: false, error: 'Invalid request.' });
  // Honeypot: real users never fill this hidden field. Pretend success to bots.
  if (body.website) return res.status(200).json({ ok: true, id: '00000000-0000-4000-8000-000000000000' });

  const v = validateRegistration(body);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  try {
    const r = await forward({ type: 'register', ...v.data }, { retries: 1, timeoutMs: 26000 }); // safe to retry: the Sheet de-duplicates by email
    if (!r || !r.ok || !r.id) throw new Error((r && r.error) || 'bad_response');
    return res.status(200).json({ ok: true, id: r.id });
  } catch (e) {
    console.error('register failed:', e && e.message); // never log personal data
    return res.status(502).json({ ok: false, error: 'Could not save your registration right now. Please try again in a minute.' });
  }
};
