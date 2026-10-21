// Жергілікті тексеруге арналған сервер: сайтты және /api бөлігін Netlify-сыз іске қосады.
// Іске қосу: node dev-server.mjs  →  http://localhost:8888
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const core = createRequire(import.meta.url)('./bilim-core.js');
const port = Number(process.env.PORT || 8888);
const dbFile = path.join(root, '.data', 'db.json');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' };

let db = {};
try { db = JSON.parse(await readFile(dbFile, 'utf8')); } catch {}
let saving = Promise.resolve();
const persist = () => { saving = saving.then(async () => { await mkdir(path.dirname(dbFile), { recursive: true }); await writeFile(dbFile, JSON.stringify(db)); }); return saving; };
const store = {
  get: async key => (key in db ? structuredClone(db[key]) : null),
  set: async (key, value) => { db[key] = structuredClone(value); await persist(); },
  del: async key => { delete db[key]; await persist(); },
  list: async prefix => Object.keys(db).filter(k => k.startsWith(prefix))
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 120000) break; }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"JSON қате."}'); return; }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
    const result = await core.handle({ method: req.method, path: url.searchParams.get('p') || url.pathname.replace(/^\/api(\/bilim)?/, ''), body, token, ip: req.socket.remoteAddress }, store, { mode: 'cloud', log: console.error });
    res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(result.body));
    return;
  }
  const file = path.normalize(path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(root) || file.includes(`${path.sep}.data`) || file.includes('node_modules')) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Білім PRO: http://localhost:${port}`));
