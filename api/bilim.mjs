// Білім PRO API (Vercel): деректер Upstash Redis қоймасында REST арқылы сақталады.
// Vercel Marketplace → Upstash (Redis) қосылғанда KV_REST_API_URL / KV_REST_API_TOKEN
// немесе UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN айнымалылары өздігінен қосылады.
import { handleRequest } from '../server/http.mjs';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const NS = 'bilim:';

async function redis(command) {
  const r = await fetch(URL_, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `Redis ${r.status}`);
  return data.result;
}

const redisStore = {
  get: async key => { const v = await redis(['GET', NS + key]); return v == null ? null : JSON.parse(v); },
  set: (key, value) => redis(['SET', NS + key, JSON.stringify(value)]),
  del: key => redis(['DEL', NS + key]),
  list: async prefix => {
    const keys = []; let cursor = '0';
    do {
      const [next, batch] = await redis(['SCAN', cursor, 'MATCH', NS + prefix + '*', 'COUNT', '1000']);
      cursor = String(next); keys.push(...batch);
    } while (cursor !== '0');
    return [...new Set(keys)].map(k => k.slice(NS.length));
  }
};

const handle = req => handleRequest(req, redisStore, {
  ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown',
  secret: process.env.BILIM_SECRET,
  storageReady: Boolean(URL_ && TOKEN)
});

export const GET = handle, POST = handle, PUT = handle, DELETE = handle;
