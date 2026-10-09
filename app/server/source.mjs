// 按链接抓取内容进库：支持 Telegram 公开频道 + 任意网页；群组只能记录来源
import * as store from './store.mjs';
import { parseMessages, parseLink, extractWeb } from '../../core/parse.mjs';
import { fetchHtml } from '../../core/net.mjs';
import { decodeEntities } from '../../core/text.mjs';
import { classify } from '../../core/classify.mjs';
import { appendRaw } from './rawlog.mjs';

export { parseLink };

// ---------------- 解析来源类型 ----------------
export async function resolve(input) {
  const p = parseLink(input);
  if (!p) return { ok: false, error: '无法识别的链接。支持：t.me/频道名、t.me/s/频道名、@频道名、任意 http(s) 网址' };
  if (p.kind === 'invite') return { ok: true, kind: 'invite', url: p.url, note: '这是私密群/频道的邀请链接，未加入前 Telegram 不提供任何公开内容。' };
  if (p.kind === 'private') return { ok: true, kind: 'private', url: p.url, note: '这是私密频道链接（/c/），Telegram 不提供公开预览。' };

  if (p.kind === 'web') {
    const html = await fetchHtml(p.url);
    if (!html) return { ok: false, error: '网页抓取失败（网络或该站禁止抓取）' };
    const info = extractWeb(html, p.url);
    return { ok: true, kind: 'web', url: p.url, host: p.host, title: info.title, preview: info.text.slice(0, 180), existing: 0 };
  }

  const html = await fetchHtml('https://t.me/s/' + p.username);
  if (!html) return { ok: false, error: '访问 t.me 失败' };
  const msgs = parseMessages(html, p.username);
  const title = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
  const members = decodeEntities(((html.match(/tgme_page_extra[^>]*>([^<]*)</) || [])[1] || '').trim());
  const existing = store.countByChannel(p.username);

  if (!msgs.length) {
    return {
      ok: true, kind: 'unscrapable', username: p.username, url: 'https://t.me/' + p.username,
      title: title, members: members, existing: existing,
      note: title ? ('「' + title + '」是群组或未开放预览的频道' + (members ? '（' + members + '）' : '') + '。Telegram 只对公开频道提供消息预览页，群组消息任何人都抓不到。')
        : '该链接没有公开消息预览。',
    };
  }
  return { ok: true, kind: 'channel', username: p.username, url: 'https://t.me/' + p.username, title: title, existing: existing };
}

// ---------------- 导入 ----------------
const jobs = new Map();
let seq = 0;

export function getJob(id) { return jobs.get(id) || null; }
export function listJobs() { return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20); }

function newJob(input) {
  const id = 'job' + (++seq) + '_' + Date.now().toString(36);
  const j = { id: id, input: input, status: 'running', phase: '解析链接', imported: 0, skipped: 0, scanned: 0, total: 0, error: null, startedAt: Date.now(), finishedAt: null, kind: '', title: '', note: '' };
  jobs.set(id, j);
  return j;
}

// 入库 + 落原始日志：保证任何一次导入都可在 data/raw 中找到来源
function toPost(rec) {
  const r = store.insertPost(rec);
  if (r.inserted) appendRaw(rec);
  return r;
}

export function startImport(input, opts) {
  const j = newJob(input);
  run(j, input, opts || {}).catch(e => {
    j.status = 'failed'; j.error = String(e.message || e); j.finishedAt = Date.now();
  });
  return j;
}

// 可复用的导入实现：把进度写进传入的 target（与 job 同结构），供「一键补齐」逐源调用
export { run as importInto };

async function run(j, input, opts) {
  const r = await resolve(input);
  j.kind = r.kind; j.title = r.title || ''; j.note = r.note || '';
  if (!r.ok) { j.status = 'failed'; j.error = r.error; j.finishedAt = Date.now(); return; }

  if (r.kind === 'unscrapable' || r.kind === 'invite' || r.kind === 'private') {
    store.upsertSource({ id: (r.username || r.url), kind: r.kind, title: r.title || '', members: r.members || '', url: r.url, last_sync: new Date().toISOString(), imported: 0, note: r.note || '' });
    j.status = 'unsupported'; j.finishedAt = Date.now(); return;
  }

  if (r.kind === 'web') {
    j.phase = '抓取网页';
    const html = await fetchHtml(r.url);
    if (!html) { j.status = 'failed'; j.error = '网页抓取失败'; j.finishedAt = Date.now(); return; }
    const info = extractWeb(html, r.url);
    const cls = classify({ t: info.text, lk: [r.url], lp: [], v: 0, ts: Math.floor(Date.now() / 1000), d: new Date().toISOString() });
    const res = toPost({
      channel: 'web_' + (r.host || 'site'), msgId: Math.floor(Date.now() / 1000) % 2000000000,
      date: new Date().toISOString().slice(0, 10), ts: Math.floor(Date.now() / 1000),
      text: cls.text, category: cls.primary, categories: (cls.cats || []).join(','),
      tags: (cls.tags || []).join(','), hashtags: (cls.hashtags || []).join(','),
      value: cls.value, content: cls.content, url: r.url,
      links: [r.url].join(' '), domains: (r.host || ''), source: 'web', author: '网页采集', groupTitle: info.title || r.host,
    });
    j.imported = res.inserted ? 1 : 0; j.skipped = res.inserted ? 0 : 1; j.scanned = 1; j.total = 1;
    store.upsertSource({ id: r.url, kind: 'web', title: info.title || r.host, url: r.url, last_sync: new Date().toISOString(), imported: j.imported, note: '' });
    j.status = 'done'; j.phase = '完成'; j.finishedAt = Date.now();
    return;
  }

  // 公开频道
  j.phase = '抓取频道';
  const max = opts.maxMessages || 2000;
  const html0 = await fetchHtml('https://t.me/s/' + r.username);
  const first = parseMessages(html0, r.username);
  if (!first.length) { j.status = 'failed'; j.error = '没有解析到消息'; j.finishedAt = Date.now(); return; }
  let before = Math.max.apply(null, first.map(m => m.i)) + 1;
  let guard = 0;
  while (j.scanned < max && guard++ < 3000) {
    const html = guard === 1 ? html0 : await fetchHtml('https://t.me/s/' + r.username + '?before=' + before);
    const msgs = parseMessages(html || '', r.username);
    if (!msgs.length) break;
    for (const m of msgs) {
      if (j.scanned >= max) break;
      j.scanned++;
      const cls = classify(m);
      if (!cls.text && !(m.lk || []).length) { j.skipped++; continue; }
      const rec = {
        channel: r.username, msgId: m.i,
        date: (m.d || '').slice(0, 10), ts: m.ts || 0,
        text: cls.text, category: cls.primary, categories: (cls.cats || []).join(','),
        tags: (cls.tags || []).join(','), hashtags: (cls.hashtags || []).join(','),
        value: cls.value, content: cls.content, url: 'https://t.me/' + r.username + '/' + m.i,
        links: (cls.links || []).join(' '), domains: (cls.domains || []).join(' '),
        source: 'channel', author: '', groupTitle: r.title || '',
      };
      try { const res = toPost(rec); if (res.inserted) j.imported++; else j.skipped++; }
      catch (e) { j.skipped++; }
    }
    const min = msgs.reduce((a, m) => Math.min(a, m.i), Infinity);
    if (min >= before) break;
    before = min;
    if (guard % 10 === 0) await new Promise(r2 => setTimeout(r2, 60));
  }
  store.upsertSource({ id: r.username, kind: 'channel', title: r.title || r.username, url: r.url, last_sync: new Date().toISOString(), imported: j.imported, note: '' });
  j.status = 'done'; j.phase = '完成'; j.finishedAt = Date.now();
}
