// Telegram 情报站 - local API + static server
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import * as ai from './ai.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'app', 'web', 'dist');
const PORT = Number(process.env.PORT || 8317);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  const q = {};
  for (const k of u.searchParams.keys()) {
    const all = u.searchParams.getAll(k);
    q[k] = all.length > 1 ? all : all[0];
  }
  return q;
}

function filtersFrom(q) {
  const tags = q.tags ? (Array.isArray(q.tags) ? q.tags : String(q.tags).split(',')).filter(Boolean) : [];
  return { category: q.category || '', channel: q.channel || '', from: q.from || '', to: q.to || '', tags: tags };
}

async function api(req, res, pathname, query) {
  if (pathname === '/api/health') return send(res, 200, { ok: true, ts: Date.now() });

  if (pathname === '/api/facets') {
    const f = store.facets();
    return send(res, 200, { categories: f.categories, channels: f.channels, tags: store.topTags(40), meta: f.meta });
  }

  if (pathname === '/api/search') {
    const q = query;
    const r = store.search({
      q: q.q || '', category: q.category || '', channel: q.channel || '',
      from: q.from || '', to: q.to || '',
      tags: q.tags ? (Array.isArray(q.tags) ? q.tags : String(q.tags).split(',')).filter(Boolean) : [],
      sort: q.sort || 'relevance', page: Number(q.page || 1), size: Math.min(100, Number(q.size || 30)),
      minValue: Number(q.minValue || 0),
    });
    return send(res, 200, r);
  }

  const mPost = pathname.match(/^\/api\/post\/(\d+)$/);
  if (mPost) {
    const p = store.getPost(mPost[1]);
    return p ? send(res, 200, p) : send(res, 404, { error: 'not found' });
  }

  const mRel = pathname.match(/^\/api\/related\/(\d+)$/);
  if (mRel) return send(res, 200, { items: store.related(mRel[1], 8) });

  if (pathname === '/api/settings') {
    if (req.method === 'GET') return send(res, 200, { settings: ai.publicSettings(), presets: ai.PRESETS, active: ai.activeProfile() ? ai.activeProfile().name : '' });
    if (req.method === 'POST') {
      const body = await readBody(req);
      ai.saveSettings(body);
      const a = ai.activeProfile();
      return send(res, 200, { settings: ai.publicSettings(), presets: ai.PRESETS, active: a ? a.name : '' });
    }
  }

  if (pathname === '/api/settings/active' && req.method === 'POST') {
    const body = await readBody(req);
    ai.saveSettings({ activeId: String(body.id || '') });
    const a = ai.activeProfile();
    return send(res, 200, { ok: true, active: a ? a.name : '', settings: ai.publicSettings() });
  }

  if (pathname === '/api/settings/test' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const r = await ai.testConnection(body);
      return send(res, 200, { ok: true, result: r });
    } catch (e) {
      return send(res, 200, { ok: false, error: String(e.message || e) });
    }
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const question = String(body.question || '').slice(0, 2000);
    if (!question) return send(res, 400, { error: 'empty question' });
    const filters = body.filters || {};
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    const ev = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
    const t0 = Date.now();
    try {
      ev({ type: 'status', stage: 'retrieving' });
      const posts = ai.retrieve(question, filters, ai.loadSettings().topK || 14);
      ev({ type: 'sources', items: posts.map(p => ({ id: p.id, date: p.date, channel: p.channel, category: p.category, text: String(p.text || '').slice(0, 160), url: p.url, value: p.value })) });
      const settings = ai.loadSettings();
      if (!settings.apiKey) {
        const text = ai.extractiveAnswer(question, posts);
        for (let i = 0; i < text.length; i += 40) {
          ev({ type: 'delta', text: text.slice(i, i + 40) });
          await new Promise(r => setTimeout(r, 8));
        }
      } else {
        ev({ type: 'status', stage: 'thinking' });
        const msgs = ai.buildMessages(question, posts, body.history || []);
        await ai.streamLLM(msgs, (d) => ev({ type: 'delta', text: d }));
      }
      ev({ type: 'done', elapsed: Date.now() - t0, sources: posts.length });
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === 'NO_KEY') ev({ type: 'error', message: '未配置 AI API Key', hint: 'no-key' });
      else ev({ type: 'error', message: msg });
    }
    res.end();
    return;
  }

  return send(res, 404, { error: 'unknown api' });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(DIST, rel.replace(/^\/+/, ''));
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (e2, b2) => {
        if (e2) return send(res, 404, 'App not built yet. Run: npm run build (in app/web)', 'text/plain; charset=utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(b2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname, parseQuery(req.url));
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return send(res, 500, { error: String(e.message || e) });
    try { res.end(); } catch (e2) {}
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const f = store.facets();
  console.log('Telegram 情报站 running: http://127.0.0.1:' + PORT);
  console.log('索引帖子数:', (f.meta && f.meta.count) || '?');
});
