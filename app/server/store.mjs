// SQLite store: search, facets, lookup
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { splitTerms, toGram } from '../../core/text.mjs';
import { buildQuery, orExpr } from '../../core/query.mjs';
import { orderBy, orderBySimple, bm25Expr } from '../../core/rank.mjs';
import { clusterKey } from '../../core/cluster.mjs';
import { fromBuffer } from '../../core/vector.mjs';

export { splitTerms };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');

let db = null;
let countCache = { n: 0, at: 0 };

// 检索计数缓存（60 秒，最多 300 条）。任何写入都会清空。
const COUNT_TTL = 60000;
const COUNT_MAX = 300;
const qCounts = new Map();
function cachedCount(key, produce) {
  const hit = qCounts.get(key);
  const now = Date.now();
  if (hit && now - hit.at < COUNT_TTL) return hit.n;
  const n = produce();
  if (qCounts.size >= COUNT_MAX) qCounts.clear();
  qCounts.set(key, { n: n, at: now });
  return n;
}
function clearCounts() { qCounts.clear(); countCache = { n: 0, at: 0 }; }

// ---------- 表结构 ----------
// store 是唯一写入方，schema 也由 store 负责，避免出现第二套建表逻辑
const SQL_POSTS = [
  'CREATE TABLE posts(',
  '  id INTEGER PRIMARY KEY,',
  '  channel TEXT NOT NULL,',
  '  msg_id INTEGER NOT NULL,',
  '  date TEXT, ts INTEGER, views INTEGER, media TEXT,',
  '  text TEXT, category TEXT, categories TEXT, tags TEXT, hashtags TEXT,',
  '  value REAL, content REAL, url TEXT, links TEXT, domains TEXT, lp_title TEXT,',
  "  source TEXT DEFAULT 'channel', author TEXT DEFAULT '', group_title TEXT DEFAULT ''",
  '  , cluster_key TEXT, rep_id INTEGER, cluster_size INTEGER DEFAULT 1, is_rep INTEGER DEFAULT 1',
  ')',
].join('\n');

function createSchema() {
  db.exec(SQL_POSTS);
  db.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
  // 单字分词索引：CJK 逐字成词，ASCII 保持整词。
  // 相比 trigram，词典从海量三字串降到约一万个汉字，索引更小；
  // 且任意长度查询都能转成短语匹配，2 字词不再退化成全表 LIKE 扫描。
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(text_gram, tags_gram, domains, channel, content='', tokenize='unicode61')");
  db.exec("CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, kind TEXT, title TEXT, members TEXT, url TEXT, added_at TEXT, last_sync TEXT, imported INTEGER DEFAULT 0, note TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS job_runs(job_key TEXT NOT NULL, run_date TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, detail TEXT, PRIMARY KEY(job_key, run_date))");
  db.exec("CREATE TABLE IF NOT EXISTS favorites(post_id INTEGER PRIMARY KEY, tags TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL, tags TEXT DEFAULT '', min_value REAL DEFAULT 0, enabled INTEGER DEFAULT 1, created_at TEXT, last_hit_at TEXT, hit_count INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS app_state(k TEXT PRIMARY KEY, v TEXT)");
  db.exec('CREATE TABLE IF NOT EXISTS embeddings(post_id INTEGER PRIMARY KEY, vec BLOB, dim INTEGER, norm REAL, model TEXT, at TEXT)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_lookup ON posts(channel, msg_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_cluster ON posts(cluster_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_rep ON posts(rep_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_isrep ON posts(is_rep)');
}

function migrate() {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(r => String(r.name));
  if (cols.indexOf('source') < 0) db.exec("ALTER TABLE posts ADD COLUMN source TEXT DEFAULT 'channel'");
  if (cols.indexOf('author') < 0) db.exec("ALTER TABLE posts ADD COLUMN author TEXT DEFAULT ''");
  if (cols.indexOf('group_title') < 0) db.exec("ALTER TABLE posts ADD COLUMN group_title TEXT DEFAULT ''");
  if (cols.indexOf('cluster_key') < 0) db.exec('ALTER TABLE posts ADD COLUMN cluster_key TEXT');
  if (cols.indexOf('rep_id') < 0) db.exec('ALTER TABLE posts ADD COLUMN rep_id INTEGER');
  if (cols.indexOf('cluster_size') < 0) db.exec('ALTER TABLE posts ADD COLUMN cluster_size INTEGER DEFAULT 1');
  if (cols.indexOf('is_rep') < 0) db.exec('ALTER TABLE posts ADD COLUMN is_rep INTEGER DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_lookup ON posts(channel, msg_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_cluster ON posts(cluster_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_rep ON posts(rep_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_isrep ON posts(is_rep)');
  db.exec("CREATE TABLE IF NOT EXISTS job_runs(job_key TEXT NOT NULL, run_date TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, detail TEXT, PRIMARY KEY(job_key, run_date))");
  db.exec("CREATE TABLE IF NOT EXISTS favorites(post_id INTEGER PRIMARY KEY, tags TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS subscriptions(id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL, tags TEXT DEFAULT '', min_value REAL DEFAULT 0, enabled INTEGER DEFAULT 1, created_at TEXT, last_hit_at TEXT, hit_count INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS app_state(k TEXT PRIMARY KEY, v TEXT)");
  db.exec('CREATE TABLE IF NOT EXISTS embeddings(post_id INTEGER PRIMARY KEY, vec BLOB, dim INTEGER, norm REAL, model TEXT, at TEXT)');
}

function ensureSchema() {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'").get();
  // 建表失败是硬错误，必须抛出；迁移失败可以忽略（例如只读打开旧库）
  if (!has) { createSchema(); return; }
  try { migrate(); } catch (e) { /* 只读打开或迁移失败不应阻断服务 */ }
}

export function close() {
  if (db) { try { db.close(); } catch (e) {} db = null; }
}

export function open() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH, { readOnly: false });
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA cache_size=-160000');
  db.exec('PRAGMA mmap_size=1073741824');
  ensureSchema();
  return db;
}

// ---------- 唯一写入入口 ----------
const POST_COLS = 'channel,msg_id,date,ts,views,media,text,category,categories,tags,hashtags,value,content,url,links,domains,lp_title,source,author,group_title';
const POST_PH = '?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?';

function recToRow(rec) {
  return [
    rec.channel, rec.msgId, rec.date || '', rec.ts || 0, rec.views || 0, rec.media || '',
    rec.text || '', rec.category || '', rec.categories || '', rec.tags || '', rec.hashtags || '',
    rec.value || 0, rec.content || 0, rec.url || '', rec.links || '', rec.domains || '', rec.lpTitle || '',
    rec.source || 'group', rec.author || '', rec.groupTitle || '',
  ];
}

// 增量写入：频道抓取 / 群消息 / 网页采集全部走这里，按 (channel, msg_id) 幂等
export function insertPost(rec) {
  const d = open();
  const exists = d.prepare('SELECT id FROM posts WHERE channel = ? AND msg_id = ? LIMIT 1').get(rec.channel, rec.msgId);
  if (exists) return { inserted: false, id: exists.id, reason: 'duplicate' };
  // 同事件聚簇：同键的条目归到同一代表，信息流默认只显示代表
  const ckey = clusterKey(String(rec.links || '').split(/\s+/).filter(Boolean));
  let repId = null, csize = 1;
  if (ckey) {
    // 只在「另一个频道」已有同键代表时聚合；同频道反复出现的同一链接是签名，不是同一事件
    const ex = d.prepare('SELECT id, cluster_size FROM posts WHERE cluster_key = ? AND rep_id = id AND channel != ? LIMIT 1').get(ckey, rec.channel);
    if (ex) {
      repId = Number(ex.id);
      csize = (Number(ex.cluster_size) || 1) + 1;
      d.prepare('UPDATE posts SET cluster_size = ? WHERE id = ?').run(csize, repId);
    }
  }
  const info = d.prepare('INSERT INTO posts(' + POST_COLS + ',cluster_key,rep_id,cluster_size,is_rep) VALUES(' + POST_PH + ',?,?,?,?)').run(
    ...recToRow(rec), ckey, repId, csize, repId === null ? 1 : 0
  );
  const id = Number(info.lastInsertRowid);
  if (repId === null) d.prepare('UPDATE posts SET rep_id = ? WHERE id = ?').run(id, id);
  d.prepare('INSERT INTO posts_fts(rowid,text_gram,tags_gram,domains,channel) VALUES(?,?,?,?,?)').run(
    id, toGram(rec.text || ''), toGram(rec.tags || ''), rec.domains || '', rec.channel
  );
  clearCounts();
  return { inserted: true, id: id, clustered: repId !== null, repId: repId === null ? id : repId, clusterSize: csize };
}

export const insertGroupPost = insertPost;

// 批量写入（仅首次建库用）：只写主表，最后统一重建 FTS，比逐条写索引快一个数量级
export function bulkInsertPosts(rows) {
  const d = open();
  const stmt = d.prepare('INSERT OR REPLACE INTO posts(id,' + POST_COLS + ') VALUES(?,' + POST_PH + ')');
  let n = 0;
  d.exec('BEGIN');
  for (const row of rows) { stmt.run(row.id, ...recToRow(row)); n++; }
  d.exec('COMMIT');
  clearCounts();
  return n;
}

// 重建全文索引。内容表是 contentless，必须由本层按 toGram 规则逐条写入。
export function rebuildFts() {
  const d = open();
  d.exec('DROP TABLE IF EXISTS posts_fts');
  d.exec("CREATE VIRTUAL TABLE posts_fts USING fts5(text_gram, tags_gram, domains, channel, content='', tokenize='unicode61')");
  const ins = d.prepare('INSERT INTO posts_fts(rowid, text_gram, tags_gram, domains, channel) VALUES(?,?,?,?,?)');
  let last = 0, n = 0;
  while (true) {
    const rows = d.prepare('SELECT id, text, tags, domains, channel FROM posts WHERE id > ? ORDER BY id LIMIT 20000').all(last);
    if (!rows.length) break;
    d.exec('BEGIN');
    for (const r of rows) ins.run(r.id, toGram(r.text || ''), toGram(r.tags || ''), String(r.domains || ''), String(r.channel || ''));
    d.exec('COMMIT');
    last = rows[rows.length - 1].id;
    n += rows.length;
    if (n % 200000 === 0) console.log('  已索引 ' + n.toLocaleString());
  }
  d.exec("INSERT INTO posts_fts(posts_fts) VALUES('optimize')");
  clearCounts();
  return n;
}

// ---------- 来源管理（用户手动添加的链接）----------
export function listSources() {
  const d = open();
  return d.prepare('SELECT * FROM sources ORDER BY added_at DESC').all();
}

export function getSource(id) {
  const d = open();
  return d.prepare('SELECT * FROM sources WHERE id = ?').get(id) || null;
}

export function upsertSource(s) {
  const d = open();
  const cur = getSource(s.id) || {};
  const merged = Object.assign({ id: s.id, kind: '', title: '', members: '', url: '', added_at: new Date().toISOString(), last_sync: '', imported: 0, note: '' }, cur, s);
  d.prepare('INSERT INTO sources(id,kind,title,members,url,added_at,last_sync,imported,note) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, members=excluded.members, url=excluded.url, last_sync=excluded.last_sync, imported=excluded.imported, note=excluded.note').run(
    merged.id, merged.kind, merged.title, merged.members, merged.url, merged.added_at, merged.last_sync, merged.imported, merged.note
  );
  return getSource(s.id);
}

export function removeSource(id) {
  const d = open();
  const n = getSource(id);
  d.prepare('DELETE FROM sources WHERE id = ?').run(id);
  return !!n;
}

export function countByChannel(channel) {
  const d = open();
  const r = d.prepare('SELECT COUNT(*) AS n FROM posts WHERE channel = ?').get(channel);
  return r ? r.n : 0;
}

export function groupStats() {
  const d = open();
  const r = d.prepare("SELECT COUNT(*) AS n FROM posts WHERE source = 'group'").get();
  const g = d.prepare("SELECT channel, group_title, COUNT(*) AS n FROM posts WHERE source = 'group' GROUP BY channel ORDER BY n DESC LIMIT 20").all();
  return { total: r ? r.n : 0, groups: g };
}

const SELECT_COLS = 'p.id,p.channel,p.msg_id,p.date,p.ts,p.views,p.media,p.text,p.category,p.categories,p.tags,p.hashtags,p.value,p.content,p.url,p.links,p.domains,p.lp_title,p.rep_id,p.cluster_size';

function rowToPost(r) {
  return {
    id: r.id, channel: r.channel, msgId: r.msg_id, date: r.date, ts: r.ts, views: r.views, media: r.media,
    text: r.text, category: r.category, categories: (r.categories || '').split(',').filter(Boolean),
    tags: (r.tags || '').split(',').filter(Boolean), hashtags: (r.hashtags || '').split(',').filter(Boolean),
    value: r.value, content: r.content, url: r.url,
    links: (r.links || '').split(/\s+/).filter(Boolean),
    domains: (r.domains || '').split(/\s+/).filter(Boolean),
    lpTitle: r.lp_title || '',
    repId: r.rep_id == null ? null : Number(r.rep_id),
    clusterSize: r.cluster_size == null ? 1 : Number(r.cluster_size),
  };
}

// ---------- 收藏（落库，不再只存在浏览器里）----------
export function listFavorites() {
  const d = open();
  const rows = d.prepare('SELECT ' + SELECT_COLS + ', f.tags AS fav_tags, f.note AS fav_note, f.created_at AS fav_at FROM favorites f JOIN posts p ON p.id = f.post_id ORDER BY f.created_at DESC').all();
  return rows.map(r => Object.assign(rowToPost(r), {
    favTags: String(r.fav_tags || '').split(',').filter(Boolean),
    favNote: r.fav_note || '',
    favAt: r.fav_at || '',
  }));
}

export function isFavorite(postId) {
  const d = open();
  return !!d.prepare('SELECT 1 AS x FROM favorites WHERE post_id = ?').get(Number(postId));
}

export function addFavorite(postId, tags, note) {
  const d = open();
  d.prepare('INSERT OR REPLACE INTO favorites(post_id, tags, note, created_at) VALUES(?,?,?,?)')
    .run(Number(postId), (tags || []).join(','), note || '', new Date().toISOString());
  return true;
}

export function removeFavorite(postId) {
  const d = open();
  const r = d.prepare('DELETE FROM favorites WHERE post_id = ?').run(Number(postId));
  return Number(r.changes) > 0;
}

export function favoriteIds() {
  const d = open();
  return d.prepare('SELECT post_id FROM favorites').all().map(r => Number(r.post_id));
}

// ---------- 关键词订阅 ----------
export function listSubscriptions() {
  const d = open();
  return d.prepare('SELECT * FROM subscriptions ORDER BY id DESC').all().map(r => ({
    id: Number(r.id), keyword: r.keyword, tags: String(r.tags || '').split(',').filter(Boolean),
    minValue: Number(r.min_value || 0), enabled: Number(r.enabled) === 1,
    createdAt: r.created_at, lastHitAt: r.last_hit_at, hitCount: Number(r.hit_count || 0),
  }));
}

export function upsertSubscription(rec) {
  const d = open();
  if (rec.id) {
    d.prepare('UPDATE subscriptions SET keyword=?, tags=?, min_value=?, enabled=? WHERE id=?')
      .run(rec.keyword, (rec.tags || []).join(','), rec.minValue || 0, rec.enabled === false ? 0 : 1, Number(rec.id));
    return Number(rec.id);
  }
  const info = d.prepare('INSERT INTO subscriptions(keyword, tags, min_value, enabled, created_at) VALUES(?,?,?,?,?)')
    .run(rec.keyword, (rec.tags || []).join(','), rec.minValue || 0, rec.enabled === false ? 0 : 1, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function removeSubscription(id) {
  const d = open();
  return Number(d.prepare('DELETE FROM subscriptions WHERE id = ?').run(Number(id)).changes) > 0;
}

// 逐条订阅去检索，返回命中情况（供界面「检查命中」与补齐后提醒使用）
export function checkSubscriptions(sinceTs) {
  const subs = listSubscriptions().filter(s => s.enabled);
  const out = [];
  for (const s of subs) {
    let r;
    try {
      r = search({ q: s.keyword, tags: s.tags, minValue: s.minValue, since: sinceTs || 0, sort: 'date', size: 5 });
    } catch (e) { r = { total: 0, items: [] }; }
    out.push({ id: s.id, keyword: s.keyword, tags: s.tags, count: r.total, items: r.items });
  }
  return out;
}

export function markSubscriptionHit(id, count) {
  const d = open();
  d.prepare('UPDATE subscriptions SET last_hit_at = ?, hit_count = hit_count + ? WHERE id = ?')
    .run(new Date().toISOString(), count, Number(id));
}

// ---------- 应用状态（上次访问时间等）----------
export function getState(k, def) {
  const d = open();
  const r = d.prepare('SELECT v FROM app_state WHERE k = ?').get(k);
  return r ? r.v : (def === undefined ? null : def);
}

export function setState(k, v) {
  const d = open();
  d.prepare('INSERT OR REPLACE INTO app_state(k, v) VALUES(?,?)').run(k, String(v));
  return true;
}

// ---------- 向量（语义检索）----------
export function embedStats() {
  const d = open();
  const r = d.prepare('SELECT COUNT(*) AS n, MIN(dim) AS dim, MAX(model) AS model FROM embeddings').get();
  const total = d.prepare('SELECT COUNT(*) AS n FROM posts WHERE value >= ?').get(4);
  return { indexed: r ? Number(r.n) : 0, dim: r && r.dim ? Number(r.dim) : 0, model: (r && r.model) || '', eligible: total ? Number(total.n) : 0 };
}

// 取还需要向量化的帖子。只做价值分达标的，避免给 87 万条全量算。
export function postsNeedingEmbedding(limit, minValue) {
  const d = open();
  return d.prepare('SELECT p.id, p.text FROM posts p LEFT JOIN embeddings e ON e.post_id = p.id WHERE e.post_id IS NULL AND p.value >= ? AND LENGTH(p.text) >= 15 ORDER BY p.value DESC LIMIT ?')
    .all(Number(minValue == null ? 4 : minValue), Number(limit || 64))
    .map(r => ({ id: Number(r.id), text: String(r.text || '') }));
}

export function saveEmbeddings(rows) {
  const d = open();
  const stmt = d.prepare('INSERT OR REPLACE INTO embeddings(post_id, vec, dim, norm, model, at) VALUES(?,?,?,?,?,?)');
  const at = new Date().toISOString();
  d.exec('BEGIN');
  for (const r of rows) stmt.run(r.id, r.vec, r.dim, r.norm, r.model || '', at);
  d.exec('COMMIT');
  return rows.length;
}

export function loadEmbeddings() {
  const d = open();
  return d.prepare('SELECT post_id, vec, norm FROM embeddings').all()
    .map(r => ({ id: Number(r.post_id), vec: fromBuffer(r.vec), norm: Number(r.norm) || 127 }));
}

export function clearEmbeddings() { open().exec('DELETE FROM embeddings'); return true; }

export function getPostsByIds(ids) {
  const d = open();
  if (!ids.length) return [];
  const ph = ids.map(function () { return '?'; }).join(',');
  return d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p WHERE p.id IN (' + ph + ')').all(...ids.map(Number)).map(rowToPost);
}

// 同一事件的其他来源
export function clusterMembers(repId) {
  const d = open();
  return d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p WHERE p.rep_id = ? ORDER BY p.value DESC, p.ts DESC LIMIT 50')
    .all(Number(repId)).map(rowToPost);
}

export function search(opts) {
  const { q = '', category = '', tags = [], channel = '', from = '', to = '', since = 0, sort = 'relevance', page = 1, size = 30, minValue = 0, collapse = true } = opts;
  const d = open();
  const where = [];
  const params = [];

  if (category) { where.push('p.category = ?'); params.push(category); }
  if (channel) { where.push('p.channel = ?'); params.push(channel); }
  if (from) { where.push('p.date >= ?'); params.push(from); }
  if (to) { where.push('p.date <= ?'); params.push(to); }
  if (since) { where.push('p.ts > ?'); params.push(Number(since)); }
  if (minValue) { where.push('p.value >= ?'); params.push(minValue); }
  for (const t of tags) { where.push("(',' || p.tags || ',') LIKE ?"); params.push('%,' + t + ',%'); }
  // 同事件聚合：默认只显示每个簇的代表条目。is_rep 有索引，计数与分页都是索引扫描。
  // （is_rep 尚未回填时默认值为 1，等价于不折叠，对老数据安全）
  if (collapse) where.push('p.is_rep = 1');

  const qy = buildQuery(q, { mode: 'gram' });
  const terms = qy.terms;
  const expr = qy.expr;
  const offset = (Math.max(1, page) - 1) * size;

  let rows = [];
  let total = 0;
  let mode = 'browse';

  if (expr) {
    mode = 'fts';
    const w = where.length ? ' AND ' + where.join(' AND ') : '';
    const orderSql = orderBy(sort);
    // 必须用 CROSS JOIN 强制以 FTS 为驱动表。
    // 若写成普通 JOIN，优化器会选「先扫 is_rep=1 的 56 万行、再逐行回探 FTS」的计划，
    // 实测单次要 7 秒；强制顺序后同样的计数只需 35ms。
    const sql = 'SELECT ' + SELECT_COLS + ', ' + bm25Expr() + ' AS rank FROM posts_fts f CROSS JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ?' + w + ' ORDER BY ' + orderSql + ' LIMIT ? OFFSET ?';
    try {
      rows = d.prepare(sql).all(expr, ...params, size, offset);
      total = cachedCount(expr + '|' + where.join('|') + '|' + params.join(','), () => {
        const c = d.prepare('SELECT COUNT(*) AS n FROM posts_fts f CROSS JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ?' + w).get(expr, ...params);
        return c ? c.n : 0;
      });
    } catch (e) {
      // 索引缺失或损坏时回退 LIKE，保证功能可用
      mode = 'like';
      const likeW = where.slice();
      const likeP = params.slice();
      for (const t of terms) { likeW.push('p.text LIKE ?'); likeP.push('%' + t + '%'); }
      const lw = likeW.length ? ' WHERE ' + likeW.join(' AND ') : '';
      rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p' + lw + ' ORDER BY ' + orderBySimple(sort) + ' LIMIT ? OFFSET ?').all(...likeP, size, offset);
      const lc = d.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM posts p' + lw + ' LIMIT 20000)').get(...likeP);
      total = lc ? lc.n : 0;
    }
  } else {
    mode = 'browse';
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const orderSql = orderBySimple(sort);
    rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p' + w + ' ORDER BY ' + orderSql + ' LIMIT ? OFFSET ?').all(...params, size, offset);
    // 折叠条件命中 idx_posts_isrep；其余筛选条件下的总量按真实值统计
    const c = d.prepare('SELECT COUNT(*) AS n FROM posts p' + w).get(...params);
    total = c ? c.n : 0;
  }

  return { mode, total, page: Number(page), size: Number(size), items: rows.map(rowToPost) };
}

// 按 id 键集分页遍历（避免大 OFFSET），供报告生成等批量场景使用
export function forEachPost(opts, onBatch) {
  const o = opts || {};
  const d = open();
  const where = [];
  const params = [];
  if (o.category) { where.push('p.category = ?'); params.push(o.category); }
  if (o.minValue) { where.push('p.value >= ?'); params.push(o.minValue); }
  if (o.from) { where.push('p.date >= ?'); params.push(o.from); }
  where.push('p.id > ?');
  const w = ' WHERE ' + where.join(' AND ');
  const size = Math.min(20000, o.size || 5000);
  let last = 0, total = 0;
  while (true) {
    const rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM posts p' + w + ' ORDER BY p.id LIMIT ?').all(...params, last, size);
    if (!rows.length) break;
    const items = rows.map(rowToPost);
    total += items.length;
    onBatch(items);
    last = rows[rows.length - 1].id;
    if (rows.length < size) break;
  }
  return total;
}

// 遍历「有价值」条目，并补齐报告层沿用的旧字段名（primary / cats）
export function forEachValuable(onBatch, opts) {
  const o = opts || {};
  const contentMin = o.contentMin == null ? 2 : o.contentMin;
  return forEachPost({ minValue: o.minValue == null ? 2 : o.minValue, size: o.size || 5000 }, (batch) => {
    const out = [];
    for (const p of batch) {
      if ((p.content || 0) < contentMin) continue;
      if ((p.text || '').length < 10) continue;
      p.primary = p.category;
      p.cats = p.categories;
      out.push(p);
    }
    if (out.length) onBatch(out);
  });
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

export function related(id, limit = 8) {
  const d = open();
  const p = getPost(id);
  if (!p) return [];
  const expr = orExpr(keyTerms(p.text));
  if (!expr) return [];
  const rows = d.prepare('SELECT ' + SELECT_COLS + ', ' + bm25Expr() + ' AS rank FROM posts_fts f CROSS JOIN posts p ON p.id = f.rowid WHERE posts_fts MATCH ? AND p.id != ? ORDER BY rank ASC LIMIT ?').all(expr, Number(id), limit);
  return rows.map(rowToPost);
}

// 实时行数（30 秒缓存）：增量导入后总数会变，不能再用建库时写死的 meta.count
export function liveCount() {
  if (Date.now() - countCache.at < 30000) return countCache.n;
  const d = open();
  const r = d.prepare('SELECT COUNT(*) AS n FROM posts').get();
  countCache = { n: r ? r.n : 0, at: Date.now() };
  return countCache.n;
}
export function invalidateCount() { clearCounts(); }

export function facets() {
  const d = open();
  const cats = d.prepare('SELECT category AS k, COUNT(*) AS n FROM posts GROUP BY category ORDER BY n DESC').all();
  const chans = d.prepare('SELECT channel AS k, COUNT(*) AS n FROM posts GROUP BY channel ORDER BY n DESC LIMIT 60').all();
  const meta = Object.fromEntries(d.prepare('SELECT k,v FROM meta').all().map(r => [r.k, r.v]));
  meta.count = String(liveCount());
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
