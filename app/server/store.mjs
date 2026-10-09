// SQLite store: search, facets, lookup
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');

let db = null;
export function open() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH, { readOnly: false });
  db.exec('PRAGMA cache_size=-160000');
  db.exec('PRAGMA mmap_size=1073741824');
  return db;
}

const FTS_SPECIAL = /["'*():^\-]/g;

export function splitTerms(q) {
  return String(q || '')
    .replace(/[，。！？、；：""''（）【】《》,.!?;:()\[\]{}<>|\\/]/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function ftsExpr(terms) {
  const good = terms.map(t => t.replace(FTS_SPECIAL, '')).filter(t => [...t].length >= 3);
  if (!good.length) return null;
  return good.map(t => '"' + t + '"').join(' AND ');
}

const SELECT_COLS = 'p.id,p.channel,p.msg_id,p.date,p.ts,p.views,p.media,p.text,p.category,p.categories,p.tags,p.hashtags,p.value,p.content,p.url,p.links,p.domains,p.lp_title';

function rowToPost(r) {
  return {
    id: r.id, channel: r.channel, msgId: r.msg_id, date: r.date, ts: r.ts, views: r.views, media: r.media,
    text: r.text, category: r.category, categories: (r.categories || '').split(',').filter(Boolean),
    tags: (r.tags || '').split(',').filter(Boolean), hashtags: (r.hashtags || '').split(',').filter(Boolean),
    value: r.value, content: r.content, url: r.url,
    links: (r.links || '').split(/\s+/).filter(Boolean),
    domains: (r.domains || '').split(/\s+/).filter(Boolean),
    lpTitle: r.lp_title || '',
  };
}

export function search(opts) {
  const { q = '', category = '', tags = [], channel = '', from = '', to = '', sort = 'relevance', page = 1, size = 30, minValue = 0 } = opts;
  const d = open();
  const where = [];
  const params = [];

  if (category) { where.push('p.category = ?'); params.push(category); }
  if (channel) { where.push('p.channel = ?'); params.push(channel); }
  if (from) { where.push('p.date >= ?'); params.push(from); }
  if (to) { where.push('p.date <= ?'); params.push(to); }
  if (minValue) { where.push('p.value >= ?'); params.push(minValue); }
  for (const t of tags) { where.push("(',' || p.tags || ',') LIKE ?"); params.push('%,' + t + ',%'); }

  const terms = splitTerms(q);
  const longTerms = terms.filter(t => [...t].length >= 3);
  const shortTerms = terms.filter(t => [...t].length < 3);
  const expr = longTerms.length ? ftsExpr(longTerms) : null;
  const offset = (Math.max(1, page) - 1) * size;

  let rows = [];
  let total = 0;
  let mode = 'browse';

  if (expr) {
    mode = 'fts';
    const where2 = where.slice();
    const params2 = params.slice();
    for (const t of shortTerms) { where2.push('p.text LIKE ?'); params2.push('%' + t + '%'); }
    const w = where2.length ? ' AND ' + where2.join(' AND ') : '';
    const orderSql = sort === 'date' ? 'p.date DESC, p.ts DESC'
      : sort === 'views' ? 'p.views DESC'
      : sort === 'value' ? 'p.value DESC, p.ts DESC'
      : '(bm25(posts_fts, 8.0, 3.0, 2.0, 1.0) - p.value * 0.5) ASC';
    const sql = 'SELECT ' + SELECT_COLS + ', bm25(posts_fts, 8.0, 3.0, 2.0, 1.0) AS rank FROM posts_fts f JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ?' + w + ' ORDER BY ' + orderSql + ' LIMIT ? OFFSET ?';
    rows = d.prepare(sql).all(expr, ...params2, size, offset);
    const c = d.prepare('SELECT COUNT(*) AS n FROM (SELECT f.rowid FROM posts_fts f JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ?' + w + ' LIMIT 20000)').get(expr, ...params2);
    total = c ? c.n : 0;
  } else if (terms.length) {
    // short query fallback: LIKE scan, bounded by other filters
    mode = 'like';
    const likeW = where.slice();
    const likeP = params.slice();
    for (const t of terms) { likeW.push('p.text LIKE ?'); likeP.push('%' + t + '%'); }
    const w = likeW.length ? ' WHERE ' + likeW.join(' AND ') : '';
    const orderSql = sort === 'date' ? 'p.date DESC' : sort === 'views' ? 'p.views DESC' : 'p.value DESC, p.ts DESC';
    rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p' + w + ' ORDER BY ' + orderSql + ' LIMIT ? OFFSET ?').all(...likeP, size, offset);
    const lc = d.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM posts p' + w + ' LIMIT 20000)').get(...likeP);
    total = lc ? lc.n : 0;
  } else {
    mode = 'browse';
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const orderSql = sort === 'date' ? 'p.date DESC, p.ts DESC' : sort === 'views' ? 'p.views DESC' : sort === 'relevance' ? 'p.value DESC, p.ts DESC' : 'p.value DESC, p.ts DESC';
    rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p' + w + ' ORDER BY ' + orderSql + ' LIMIT ? OFFSET ?').all(...params, size, offset);
    const c = where.length === 0
      ? d.prepare('SELECT COUNT(*) AS n FROM posts').get()
      : d.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM posts p' + w + ' LIMIT 20000)').get(...params);
    total = c ? c.n : 0;
  }

  return { mode, total, page: Number(page), size: Number(size), items: rows.map(rowToPost) };
}

export function getPost(id) {
  const d = open();
  const r = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p WHERE p.id = ?').get(Number(id));
  return r ? rowToPost(r) : null;
}

export function keyTerms(text) {
  const out = [];
  const cjk = String(text || '').match(/[\u4e00-\u9fa5]{3,}/g) || [];
  for (const run of cjk.slice(0, 4)) {
    for (let i = 0; i + 4 <= run.length && out.length < 6; i += 4) out.push(run.slice(i, i + 4));
  }
  const lat = String(text || '').match(/[A-Za-z][A-Za-z0-9_.+-]{2,}/g) || [];
  for (const w of lat.slice(0, 6)) out.push(w);
  return [...new Set(out)];
}

function ftsExprOr(terms) {
  const good = terms.map(t => t.replace(FTS_SPECIAL, '')).filter(t => [...t].length >= 3);
  if (!good.length) return null;
  return good.map(t => '"' + t + '"').join(' OR ');
}

export function related(id, limit = 8) {
  const d = open();
  const p = getPost(id);
  if (!p) return [];
  const expr = ftsExprOr(keyTerms(p.text));
  if (!expr) return [];
  const rows = d.prepare('SELECT ' + SELECT_COLS + ', bm25(posts_fts, 8.0, 3.0, 2.0, 1.0) AS rank FROM posts_fts f JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ? AND p.id != ? ORDER BY rank ASC LIMIT ?').all(expr, Number(id), limit);
  return rows.map(rowToPost);
}

export function facets() {
  const d = open();
  const cats = d.prepare('SELECT category AS k, COUNT(*) AS n FROM posts GROUP BY category ORDER BY n DESC').all();
  const chans = d.prepare('SELECT channel AS k, COUNT(*) AS n FROM posts GROUP BY channel ORDER BY n DESC').all();
  const meta = Object.fromEntries(d.prepare('SELECT k,v FROM meta').all().map(r => [r.k, r.v]));
  return { categories: cats, channels: chans, meta };
}

export function topTags(limit = 40) {
  const d = open();
  const rows = d.prepare("SELECT tags FROM posts WHERE value >= 4 AND tags != '' LIMIT 120000").all();
  const m = new Map();
  for (const r of rows) for (const t of (r.tags || '').split(',')) if (t) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => ({ k: e[0], n: e[1] }));
}

export function textOf(id) {
  const d = open();
  const r = d.prepare('SELECT text, channel, date, url, value FROM posts WHERE id = ?').get(Number(id));
  return r || null;
}
