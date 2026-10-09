// Telegram 情报站 - local API + static server
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import * as bot from './bot.mjs';
import * as source from './source.mjs';
import * as sync from './sync.mjs';
import * as backup from './backup.mjs';
import * as semantic from './semantic.mjs';
import * as rag from './rag.mjs';
import * as aiClassify from './ai-classify.mjs';

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

// 简单限速。虽然只监听本机，但一个跑飞的前端循环足以把 1.6GB 的库打满。
const RATE_WINDOW = 1000;
const RATE_MAX = 40;
const rateHits = new Map();
function rateLimited(key, max) {
  const now = Date.now();
  const e = rateHits.get(key);
  if (!e || now - e.at > RATE_WINDOW) { rateHits.set(key, { at: now, n: 1 }); return false; }
  e.n++;
  return e.n > (max || RATE_MAX);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of rateHits) if (now - e.at > RATE_WINDOW * 5) rateHits.delete(k);
}, 60000).unref();

async function api(req, res, pathname, query) {
  if (pathname === '/api/health') return send(res, 200, { ok: true, ts: Date.now() });

  const ip = (req.socket && req.socket.remoteAddress) || 'local';
  if (rateLimited(ip)) {
    return send(res, 429, { error: '请求过于频繁，请稍后再试', retryAfterMs: RATE_WINDOW });
  }

  if (pathname === '/api/facets') {
    const f = store.facets();
    return send(res, 200, { categories: f.categories, channels: f.channels, tags: store.topTags(40), meta: f.meta });
  }

  if (pathname === '/api/search') {
    const q = query;
    const r = store.search({
      q: q.q || '', category: q.category || '', channel: q.channel || '',
      from: q.from || '', to: q.to || '', since: Number(q.since || 0),
      tags: q.tags ? (Array.isArray(q.tags) ? q.tags : String(q.tags).split(',')).filter(Boolean) : [],
      sort: q.sort || 'relevance', page: Number(q.page || 1), size: Math.min(100, Number(q.size || 30)),
      minValue: Number(q.minValue || 0),
      collapse: q.collapse === undefined ? true : q.collapse !== '0',
    });
    return send(res, 200, r);
  }

  const mPost = pathname.match(/^\/api\/post\/(\d+)$/);
  if (mPost) {
    const p = store.getPost(mPost[1]);
    return p ? send(res, 200, p) : send(res, 404, { error: 'not found' });
  }

  const mClu = pathname.match(/^\/api\/cluster\/(\d+)$/);
  if (mClu) return send(res, 200, { items: store.clusterMembers(mClu[1]) });

  // ---------- AI 辅助分类 ----------
  if (pathname === '/api/ai-classify/status') return send(res, 200, Object.assign({}, aiClassify.getStatus(), {
    profileId: aiClassify.classifyProfileId(),
    profiles: (ai.loadSettings().profiles || []).map(p => ({ id: p.id, name: p.name, model: p.model, hasKey: !!p.apiKey })),
  }));
  if (pathname === '/api/ai-classify/preview') {
    const q = query || {};
    const scope = {
      scope: q.scope || 'other', category: q.category || '',
      days: Number(q.days || 0) || 0,
      // minValue 之前没往下传，导致「仅价值分 ≥3 的」这个默认范围失效，
      // 「其他」全部 21 万条都被算进去，预计耗时直接显示成 32 天。
      minValue: q.minValue === undefined || q.minValue === '' ? null : Number(q.minValue),
    };
    return send(res, 200, { items: aiClassify.preview(scope, Number(q.n || 5)), candidates: store.countAiCandidates(scope) });
  }
  if (pathname === '/api/ai-classify/start' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    // 兼容两种传法：扁平参数，或者一个嵌套的 scope 对象。
    // 之前只认扁平写法，而界面传的是 { scope: {...} }，
    // 结果 s.scope 拿到的是对象、范围判断全部失效 —— 点「开始标注」会静默变成全库任务。
    const scope = (body.scope && typeof body.scope === 'object')
      ? Object.assign({}, body.scope)
      : {
          scope: body.scope || 'other', category: body.category || '',
          days: Number(body.days || 0) || 0,
          minValue: body.minValue === undefined || body.minValue === null || body.minValue === '' ? null : Number(body.minValue),
        };
    if (!ai.hasKey()) return send(res, 200, { ok: false, error: '还没配置 AI 模型，先去「AI 模型」里填一个可用的服务商' });
    return send(res, 200, aiClassify.startClassify({ scope: scope, limit: Number(body.limit || 0) }));
  }
  if (pathname === '/api/ai-classify/stop' && req.method === 'POST') return send(res, 200, { ok: aiClassify.requestStop() });
  if (pathname === '/api/ai-classify/profile' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    store.setState('classifyProfileId', String(body.id || ''));
    return send(res, 200, { ok: true, id: String(body.id || '') });
  }
  if (pathname === '/api/ai-classify/rollback' && req.method === 'POST') return send(res, 200, { ok: true, restored: store.rollbackAiLabels() });
  if (pathname === '/api/ai-classify/clear' && req.method === 'POST') return send(res, 200, { ok: true, removed: store.clearAiLabels() });
  // ---------- 检索式保存 ----------
  if (pathname === '/api/searches') {
    if (req.method === 'GET') return send(res, 200, { items: store.listSavedSearches() });
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const id = store.saveSearch(body.name, body.params);
      return send(res, 200, { ok: true, id: id, items: store.listSavedSearches() });
    }
  }
  const mSs = pathname.match(/^\/api\/searches\/(\d+)$/);
  if (mSs && req.method === 'DELETE') {
    const ok = store.removeSavedSearch(mSs[1]);
    return send(res, 200, { ok: ok, items: store.listSavedSearches() });
  }

  // ---------- 收藏 ----------
  if (pathname === '/api/favorites') {
    if (req.method === 'GET') return send(res, 200, { items: store.listFavorites(), ids: store.favoriteIds() });
    if (req.method === 'POST') {
      const body = await readBody(req);
      store.addFavorite(body.id, body.tags || [], body.note || '');
      return send(res, 200, { ok: true, ids: store.favoriteIds() });
    }
  }
  const mFav = pathname.match(/^\/api\/favorites\/(\d+)$/);
  if (mFav && req.method === 'DELETE') {
    return send(res, 200, { ok: store.removeFavorite(mFav[1]), ids: store.favoriteIds() });
  }

  // ---------- 关键词订阅 ----------
  if (pathname === '/api/subscriptions') {
    if (req.method === 'GET') return send(res, 200, { items: store.listSubscriptions() });
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!String(body.keyword || '').trim()) return send(res, 400, { error: '关键词不能为空' });
      const id = store.upsertSubscription(body);
      return send(res, 200, { ok: true, id: id, items: store.listSubscriptions() });
    }
  }
  if (pathname === '/api/subscriptions/check' && req.method === 'POST') {
    const body = await readBody(req);
    // 优先用调用方给的时间点（订阅自己的「上次检查」），否则回退到「上次访问」
    const since = Number(body.since || 0) || (Number(store.getState('lastSubCheck', 0)) || 0) || (Number(store.getState('lastVisit', 0)) || 0);
    const results = store.checkSubscriptions(since);
    for (const r of results) if (r.count) store.markSubscriptionHit(r.id, r.count);
    // 时间点由服务端推进，不依赖前端调用顺序
    const next = Math.floor(Date.now() / 1000);
    store.setState('lastSubCheck', String(next));
    return send(res, 200, { since: since, next: next, results: results });
  }

  const mSub = pathname.match(/^\/api\/subscriptions\/(\d+)$/);
  if (mSub && req.method === 'DELETE') {
    return send(res, 200, { ok: store.removeSubscription(mSub[1]), items: store.listSubscriptions() });
  }

  // ---------- 语义检索 ----------
  if (pathname === '/api/semantic/status') return send(res, 200, semantic.getStatus());
  if (pathname === '/api/semantic/build' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    return send(res, 200, semantic.startBuild({
      minValue: body.minValue, batch: body.batch, maxChars: body.maxChars, maxBatches: body.maxBatches,
    }));
  }
  if (pathname === '/api/semantic/clear' && req.method === 'POST') {
    return send(res, 200, { ok: semantic.clearIndex(), stats: store.embedStats() });
  }
  if (pathname === '/api/semantic') {
    const k = Math.min(100, Number(query.k || 30));
    const useRerank = query.rerank === '1' || query.rerank === 'true';
    if (useRerank) {
      const r = await semantic.rerankedSearch(String(query.q || ''), k, Number(query.recall || 60));
      if (!r.ok) return send(res, 200, { ok: false, error: r.error, items: [] });
      return send(res, 200, r);
    }
    const r = await semantic.semanticSearch(String(query.q || ''), Math.max(k * 8, 200));
    if (!r.ok) return send(res, 200, { ok: false, error: r.error, items: [] });
    return send(res, 200, { ok: true, model: r.model, items: r.items.slice(0, k) });
  }

  // ---------- 备份 / 恢复 ----------
  if (pathname === '/api/backups') {
    if (req.method === 'GET') return send(res, 200, { items: backup.listBackups(), dir: backup.BK_DIR });
    if (req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try { return send(res, 200, { ok: true, backup: backup.createBackup(body.label) }); }
      catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
    }
  }
  const mBk = pathname.match(/^\/api\/backups\/([0-9T:-]+)$/);
  if (mBk) {
    if (req.method === 'DELETE') return send(res, 200, { ok: backup.deleteBackup(mBk[1]), items: backup.listBackups() });
    if (req.method === 'POST') {
      try {
        const r = backup.restoreBackup(mBk[1]);
        // 数据库文件已被替换，必须重启进程才能安全继续；
        // 写标记文件让外层的「启动情报站.cmd」用新数据把它拉起来
        try { fs.writeFileSync(path.join(ROOT, 'app', 'data', '.restart'), '1'); } catch (e) {}
        setTimeout(() => process.exit(0), 600);
        return send(res, 200, Object.assign({ restarting: true }, r));
      } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
    }
  }

  // ---------- 应用状态（上次访问时间等）----------
  const mSt = pathname.match(/^\/api\/state\/([A-Za-z0-9_.-]+)$/);
  if (mSt) {
    if (req.method === 'GET') return send(res, 200, { k: mSt[1], v: store.getState(mSt[1], null) });
    if (req.method === 'POST') {
      const body = await readBody(req);
      store.setState(mSt[1], body.v);
      return send(res, 200, { ok: true });
    }
  }

  const mRel = pathname.match(/^\/api\/related\/(\d+)$/);
  if (mRel) {
    const id = Number(mRel[1]);
    // 优先用向量找相似（换说法也能命中）。
    // 没建索引、或这条本身没向量时返回 null，再回退到关键词方案。
    let sim = null;
    try { sim = semantic.similarPosts(id, 8); } catch (e) { sim = null; }
    if (sim && sim.length) {
      const posts = store.getPostsByIds(sim.map(h => h.id));
      const byId = {};
      for (const p of posts) byId[p.id] = p;
      const items = sim.map(h => {
        const p = byId[h.id];
        return p ? Object.assign({ sim: +h.score.toFixed(4) }, p) : null;
      }).filter(Boolean);
      if (items.length) return send(res, 200, { items: items, by: 'vector' });
    }
    return send(res, 200, { items: store.related(id, 8), by: 'keyword' });
  }

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

  if (pathname === '/api/settings/models' && req.method === 'POST') {
    const body = await readBody(req);
    const active = ai.activeProfile() || {};
    const r = await ai.fetchModels({
      baseUrl: body.baseUrl || active.baseUrl || '',
      apiKey: body.apiKey || active.apiKey || '',
      modelsUrl: body.modelsUrl || active.modelsUrl || '',
      apiFormat: body.apiFormat || active.apiFormat || 'openai',
      headers: body.headers != null ? body.headers : (active.headers || ''),
    });
    return send(res, 200, r);
  }

  // 自动检测接口地址：把候选地址逐个探一遍，找到能用的那个并记住。
  // 中转站地址形态不一（根域名 / 补 /v1 / 带 /api/claudecode 之类子路径），
  // 让用户去猜不现实 —— 借鉴 cc-switch 的 endpointCandidates 思路。
  if (pathname === '/api/settings/detect' && req.method === 'POST') {
    const body = await readBody(req);
    const s = ai.loadSettings();
    const target = body && body.id
      ? (s.profiles || []).find(p => p.id === body.id)
      : null;
    const probe = target || {
      baseUrl: (body && body.baseUrl) || '',
      apiKey: (body && body.apiKey) || '',
      model: (body && body.model) || '',
      apiFormat: (body && body.apiFormat) || 'openai',
    };
    if (!probe.apiKey && target && target.hasKey && body.apiKey) probe.apiKey = body.apiKey;
    try {
      const r = await ai.detectEndpoint(probe);
      if (r.ok && target) {
        // 记住它，后续调用直接走这个地址
        const next = (s.profiles || []).map(p => p.id === target.id
          ? Object.assign({}, p, { resolvedUrl: r.url, resolvedFormat: r.format })
          : p);
        ai.saveSettings({ profiles: next });
      }
      return send(res, 200, { ok: r.ok, url: r.url || '', format: r.format || '', hint: r.hint || '', tried: r.tried || [] });
    } catch (e) {
      return send(res, 200, { ok: false, hint: String(e.message || e), tried: [] });
    }
  }

  if (pathname === '/api/settings/test' && req.method === 'POST') {
    const body = await readBody(req);
    // 传 all: true 就并发测完所有已保存的服务商，界面可一键「全部测速」
    if (body && body.all) {
      const s = ai.loadSettings();
      const list = (s.profiles || []).filter(p => p.baseUrl && p.model && p.apiKey);
      const out = await Promise.all(list.map(async p => {
        try {
          const r = await ai.testConnection(p);
          return { id: p.id, ok: true, ms: r.ms };
        } catch (e) {
          return { id: p.id, ok: false, error: String(e.message || e).slice(0, 120) };
        }
      }));
      return send(res, 200, { ok: true, results: out });
    }
    try {
      const r = await ai.testConnection(body);
      return send(res, 200, { ok: true, result: r });
    } catch (e) {
      return send(res, 200, { ok: false, error: String(e.message || e) });
    }
  }

  if (pathname === '/api/sync/status') {
    return send(res, 200, sync.getSyncStatus());
  }

  if (pathname === '/api/sync/run' && req.method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, sync.startFullSync({ maxMessages: body.maxMessages, by: body.by || 'API' }));
  }

  if (pathname === '/api/source/resolve' && req.method === 'POST') {
    const body = await readBody(req);
    try { return send(res, 200, await source.resolve(String(body.input || ''))); }
    catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
  }

  if (pathname === '/api/source/import' && req.method === 'POST') {
    const body = await readBody(req);
    const input = String(body.input || '').trim();
    if (!input) return send(res, 400, { error: 'empty input' });
    const j = source.startImport(input, { maxMessages: Number(body.maxMessages || 2000) });
    return send(res, 200, { ok: true, job: j });
  }

  if (pathname === '/api/source/jobs') {
    return send(res, 200, { jobs: source.listJobs(), sources: store.listSources() });
  }

  const mJob = pathname.match(/^\/api\/source\/job\/([\w]+)$/);
  if (mJob) {
    const j = source.getJob(mJob[1]);
    return j ? send(res, 200, j) : send(res, 404, { error: 'not found' });
  }

  if (pathname === '/api/sources') {
    if (req.method === 'GET') return send(res, 200, { sources: store.listSources() });
  }

  const mSrc = pathname.match(/^\/api\/sources\/(.+)$/);
  if (mSrc && req.method === 'DELETE') {
    const ok = store.removeSource(decodeURIComponent(mSrc[1]));
    return send(res, 200, { ok: ok, sources: store.listSources() });
  }

  if (pathname === '/api/bot') {
    if (req.method === 'GET') return send(res, 200, { config: bot.publicConfig(), status: bot.getStatus() });
    if (req.method === 'POST') {
      const body = await readBody(req);
      bot.saveConfig(body);
      if (body.restart !== false) bot.restart();
      return send(res, 200, { config: bot.publicConfig(), status: bot.getStatus() });
    }
  }

  if (pathname === '/api/bot/status') {
    return send(res, 200, { config: bot.publicConfig(), status: bot.getStatus() });
  }

  if (pathname === '/api/bot/stop' && req.method === 'POST') {
    bot.stop();
    return send(res, 200, { ok: true, config: bot.publicConfig(), status: bot.getStatus() });
  }

  if (pathname === '/api/bot/test' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const me = await bot.getMe(body.token || undefined);
      return send(res, 200, { ok: true, me: { id: me.id, username: me.username, name: me.first_name } });
    } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
  }

  if (pathname === '/api/bot/preview' && req.method === 'POST') {
    const body = await readBody(req);
    const clean = {};
    for (const k of Object.keys(body || {})) if (body[k] !== undefined && body[k] !== null && body[k] !== '') clean[k] = body[k];
    const d = bot.buildDigest(clean);
    return send(res, 200, { ok: true, html: d.html, count: d.count });
  }

  if (pathname === '/api/bot/push' && req.method === 'POST') {
    const body = await readBody(req);
    const clean = {};
    for (const k of Object.keys(body || {})) if (body[k] !== undefined && body[k] !== null && body[k] !== '') clean[k] = body[k];
    try {
      const r = await bot.pushDigest(clean.chatId || undefined, clean);
      return send(res, 200, { ok: true, sent: r.sent, chatId: r.chatId });
    } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
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
      const posts = await rag.retrieve(question, filters, ai.loadSettings().topK || 14);
      ev({ type: 'sources', items: posts.map(p => ({ id: p.id, date: p.date, channel: p.channel, category: p.category, text: String(p.text || '').slice(0, 160), url: p.url, value: p.value })) });
      // 注意：API Key 存在每个服务商档案里（profiles[].apiKey），
      // 顶层 settings 根本没有 apiKey 字段。原先写成 settings.apiKey，
      // 恒为 undefined，导致 AI 问答永远走「未配置模型」的降级分支。
      if (!ai.hasKey()) {
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
  try {
    const r = bot.start();
    const b = bot.publicConfig();
    if (r.started) console.log('电报机器人: 已启动' + (b.pushChatId ? '，推送目标 ' + b.pushChatId : ''));
    else if (b.hasToken) console.log('电报机器人: 未启用（' + r.reason + '）');
  } catch (e) { console.log('电报机器人启动失败:', String(e.message || e)); }
});
