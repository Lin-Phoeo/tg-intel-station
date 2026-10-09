// Build the SQLite search database from clean.jsonl
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIMIT = Number(process.env.LIMIT || 0);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }

const SQL_POSTS = [
  'CREATE TABLE posts(',
  '  id INTEGER PRIMARY KEY,',
  '  channel TEXT NOT NULL,',
  '  msg_id INTEGER NOT NULL,',
  '  date TEXT, ts INTEGER, views INTEGER, media TEXT,',
  '  text TEXT, category TEXT, categories TEXT, tags TEXT, hashtags TEXT,',
  '  value REAL, content REAL, url TEXT, links TEXT, domains TEXT, lp_title TEXT',
  ')',
].join('\n');

const t0 = Date.now();
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=OFF');
db.exec('PRAGMA temp_store=MEMORY');
db.exec('PRAGMA cache_size=-200000');
db.exec(SQL_POSTS);
db.exec('CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT)');
db.exec("CREATE VIRTUAL TABLE posts_fts USING fts5(text, tags, domains, channel, content='posts', content_rowid='id', tokenize='trigram')");

const ins = db.prepare('INSERT OR REPLACE INTO posts(id,channel,msg_id,date,ts,views,media,text,category,categories,tags,hashtags,value,content,url,links,domains,lp_title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

const rl = readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'data', 'clean.jsonl')), crlfDelay: Infinity });
let id = 0, batch = 0;
db.exec('BEGIN');
for await (const line of rl) {
  if (!line.trim()) continue;
  let it; try { it = JSON.parse(line); } catch (e) { continue; }
  id++;
  const lpTitle = it.lp && it.lp.length ? (it.lp[0].t || '') : '';
  ins.run(
    id, it.channel, it.id, (it.date || '').slice(0, 10), it.ts || 0, it.views || 0, it.media || '',
    it.text || '', it.primary || '', (it.cats || []).join(','), (it.tags || []).join(','), (it.hashtags || []).join(','),
    it.value || 0, it.content || 0, it.url || '', (it.links || []).join(' '), (it.domains || []).join(' '), lpTitle
  );
  if (++batch >= 5000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
  if (LIMIT && id >= LIMIT) break;
}
db.exec('COMMIT');
const tInsert = Date.now();
db.exec("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
db.exec("INSERT INTO posts_fts(posts_fts) VALUES('optimize')");
const tFts = Date.now();
db.exec("INSERT INTO meta(k,v) VALUES('count','" + id + "'),('built','" + new Date().toISOString() + "')");
db.close();

const size = fs.statSync(DB_PATH).size;
console.log(JSON.stringify({
  rows: id,
  insertSec: +((tInsert - t0) / 1000).toFixed(1),
  ftsSec: +((tFts - tInsert) / 1000).toFixed(1),
  totalSec: +((tFts - t0) / 1000).toFixed(1),
  dbMB: +(size / 1024 / 1024).toFixed(1),
  per1kMB: +((size / 1024 / 1024) / (id / 1000)).toFixed(3),
}, null, 2));
