'use strict';
const { validateEvent, parseBody, clientIp, rateLimited, originOk, forward } = require('./_shared');

// Records an anonymous "practice session completed" event (registration id, duration, overall score).
// No transcript, audio, video or analysis text is ever sent here.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  if (!originOk(req)) return res.status(403).json({ ok: false });
  if (rateLimited(clientIp(req), 'evt', 60, 60 * 60 * 1000)) return res.status(429).json({ ok: false });
  const v = validateEvent(parseBody(req));
  if (!v.ok) return res.status(400).json({ ok: false });
  try {
    const r = await forward({ type: 'event', ...v.data });
    return res.status(r && r.ok ? 200 : 502).json({ ok: !!(r && r.ok) });
  } catch (e) {
    console.error('event failed:', e && e.message);
    return res.status(502).json({ ok: false });
  }
};
