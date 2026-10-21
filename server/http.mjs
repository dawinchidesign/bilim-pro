// Платформаға тәуелсіз HTTP қабаты: Netlify Function мен Vercel Function бірдей қолданады.
// Сұрау: /api/bilim?p=/auth/login (немесе Netlify-да /api/auth/login).
import core from '../bilim-core.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export async function handleRequest(req, store, { ip = 'unknown', secret, storageReady = true } = {}) {
  const url = new URL(req.url);
  const path = url.searchParams.get('p') || url.pathname.replace(/^\/api(\/bilim)?/, '') || '/';
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return json(405, { error: 'Method not allowed' });
  // Қойма қосылмаса, сайт жергілікті режимде жұмыс істей береді.
  if (!storageReady) return path === '/health' ? json(200, { ok: true, mode: 'no-storage' }) : json(503, { error: 'Сервердің дерекқоры қосылмаған.' });
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && origin) {
    try { if (new URL(origin).host !== url.host) return json(403, { error: 'Басқа сайттан сұрау жіберуге болмайды.' }); }
    catch { return json(403, { error: 'Басқа сайттан сұрау жіберуге болмайды.' }); }
  }
  if (Number(req.headers.get('content-length') || 0) > 120000) return json(413, { error: 'Сұрау тым үлкен.' });
  let body = {};
  if (req.method !== 'GET') {
    try { const raw = await req.text(); if (raw.length > 120000) return json(413, { error: 'Сұрау тым үлкен.' }); body = raw ? JSON.parse(raw) : {}; }
    catch { return json(400, { error: 'JSON қате.' }); }
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
  const result = await core.handle({ method: req.method, path, body, token, ip }, store, { secret, mode: 'cloud', log: e => console.error(e) });
  return json(result.status, result.body);
}
