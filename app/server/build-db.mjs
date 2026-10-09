// 首次建库 / 全量重建：从 data/raw 导入
//   data/raw/<频道>/seg_*.jsonl  批量抓取的原始分段（紧凑格式）
//   data/raw/_live/*.jsonl       增量采集的追加日志（已规范化）
// 本脚本不自己拼 SQL，全部经由 store 的统一写入入口。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import { classify } from '../../core/classify.mjs';
import { fnv } from '../../core/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');
const RAW = process.env.RAW_DIR || path.join(ROOT, 'data', 'raw');
const LIMIT = Number(process.env.LIMIT || 0);
const BATCH = 20000;

const PRIORITY = ['JIKE0906', 'goodlearnclub', 'iGitHub', 'zaihuapd', 'piracy6', 'pgkj666', 'baipiaou', 'qiuyuezt', 'QingLongAndroid', 'linuxdoit', 'linux_do_channel'];

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }

const t0 = Date.now();
store.open();

const stats = { raw: 0, dupId: 0, dupText: 0, spam: 0, clean: 0, byChannel: {} };
const seenIds = new Set();
const seenHash = new Set();
let id = 0;
let buf = [];

function flush() { if (buf.length) { store.bulkInsertPosts(buf); buf = []; } }

function emit(rec) {
  id++;
  buf.push(Object.assign({ id: id, source: 'channel' }, rec));
  if (buf.length >= BATCH) flush();
  return LIMIT > 0 && id >= LIMIT;
}

// ---- 原始分段（紧凑格式）----
async function readSeg(ch, file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch (e) { continue; }
    if (!m || typeof m.i !== 'number') continue;
    stats.raw++;
    const idk = ch + '\u0001' + m.i;
    if (seenIds.has(idk)) { stats.dupId++; continue; }
    seenIds.add(idk);

    const c = classify(m);
    if (c.text.length > 25) {
      const hk = fnv(c.text) + ':' + c.text.length;
      if (seenHash.has(hk)) { stats.dupText++; continue; }
      seenHash.add(hk);
    }
    if (c.spam >= 4 || (c.spam >= 3 && c.text.length < 80)) { stats.spam++; continue; }

    stats.clean++;
    stats.byChannel[ch] = (stats.byChannel[ch] || 0) + 1;
    const done = emit({
      channel: ch, msgId: m.i, date: (m.d || '').slice(0, 10), ts: m.ts || 0,
      views: m.v || 0, media: m.m || '', text: c.text,
      category: c.primary, categories: c.cats.join(','), tags: c.tags.join(','), hashtags: c.hashtags.slice(0, 6).join(','),
      value: c.value, content: c.content, url: 'https://t.me/' + ch + '/' + m.i,
      links: c.links.slice(0, 10).join(' '), domains: c.domains.slice(0, 8).join(' '),
      lpTitle: m.lp && m.lp.length ? (m.lp[0].t || '') : '',
    });
    if (done) return true;
  }
  return false;
}

// ---- 增量日志（已规范化）----
async function readLive(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch (e) { continue; }
    if (!r || !r.channel || typeof r.msgId !== 'number') continue;
    stats.raw++;
    const idk = r.channel + '\u0001' + r.msgId;
    if (seenIds.has(idk)) { stats.dupId++; continue; }
    seenIds.add(idk);
    const text = String(r.text || '');
    if (text.length > 25) {
      const hk = fnv(text) + ':' + text.length;
      if (seenHash.has(hk)) { stats.dupText++; continue; }
      seenHash.add(hk);
    }
    stats.clean++;
    stats.byChannel[r.channel] = (stats.byChannel[r.channel] || 0) + 1;
    const done = emit({
      channel: r.channel, msgId: r.msgId, date: (r.date || '').slice(0, 10), ts: r.ts || 0,
      views: r.views || 0, media: r.media || '', text: text,
      category: r.category || '其他', categories: r.categories || '', tags: r.tags || '', hashtags: r.hashtags || '',
      value: r.value || 0, content: r.content || 0, url: r.url || '',
      links: r.links || '', domains: r.domains || '', lpTitle: r.lpTitle || '',
      source: r.source || 'group',
    });
    if (done) return true;
  }
  return false;
}

const chDirs = fs.existsSync(RAW)
  ? fs.readdirSync(RAW, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name)
  : [];
const ordered = chDirs.slice().sort((a, b) => {
  const ia = PRIORITY.indexOf(a), ib = PRIORITY.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

outer:
for (const ch of ordered) {
  const dir = path.join(RAW, ch);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  for (const f of files) { if (await readSeg(ch, path.join(dir, f))) break outer; }
  console.log(ch + ': ' + files.length + ' 段; 累计 ' + stats.raw);
}

const liveDir = path.join(RAW, '_live');
if (fs.existsSync(liveDir)) {
  const liveFiles = fs.readdirSync(liveDir).filter(f => f.endsWith('.jsonl')).sort();
  for (const f of liveFiles) { if (await readLive(path.join(liveDir, f))) break; }
  console.log('_live: ' + liveFiles.length + ' 个日志文件');
}

flush();
const tInsert = Date.now();
store.rebuildFts();
const tFts = Date.now();

const d = new DatabaseSync(DB_PATH);
d.exec("INSERT OR REPLACE INTO meta(k,v) VALUES('count','" + id + "'),('built','" + new Date().toISOString() + "')");
d.close();

console.log(JSON.stringify({
  rows: id,
  insertSec: +((tInsert - t0) / 1000).toFixed(1),
  ftsSec: +((tFts - tInsert) / 1000).toFixed(1),
  totalSec: +((tFts - t0) / 1000).toFixed(1),
  dbMB: +(fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1),
  stats: stats,
}, null, 2));
