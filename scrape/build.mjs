// Build cleaned + classified datasets from raw scraped segments
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { classify, normalizeText, fnv } from './classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

const PRIORITY = ["JIKE0906", "goodlearnclub", "iGitHub", "zaihuapd", "piracy6", "pgkj666", "baipiaou", "qiuyuezt", "QingLongAndroid", "linuxdoit", "linux_do_channel"];

const meta = JSON.parse(fs.readFileSync(path.join(RAW, '_channels.json'), 'utf8'));
const TITLES = Object.fromEntries(meta.map(m => [m.ch, m.title]));

const chDirs = fs.readdirSync(RAW, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
const ordered = [...chDirs].sort((a, b) => (PRIORITY.indexOf(a) + 99) % 100 - (PRIORITY.indexOf(b) + 99) % 100);

const cleanOut = fs.createWriteStream(path.join(DATA, 'clean.jsonl'));
const valOut = fs.createWriteStream(path.join(DATA, 'valuable.jsonl'));

const seenIds = new Set();
const seenHash = new Set();
const stats = { total: 0, dupId: 0, dupText: 0, spam: 0, clean: 0, valuable: 0, byChannel: {}, byCat: {}, byTag: {}, dates: {} };
const VAL_MIN = 3.0;

function key(...a) { return a.join("\u0001"); }

async function processFile(ch, file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (!m || typeof m.i !== 'number') continue;
    stats.total++;
    const idk = key(ch, m.i);
    if (seenIds.has(idk)) { stats.dupId++; continue; }
    seenIds.add(idk);

    const c = classify(m);
    if (c.text.length > 25) {
      const hk = key(fnv(c.text), c.text.length);
      if (seenHash.has(hk)) { stats.dupText++; continue; }
      seenHash.add(hk);
    }

    const rec = {
      channel: ch,
      channelTitle: TITLES[ch] || ch,
      id: m.i,
      url: 'https://t.me/' + ch + '/' + m.i,
      date: m.d,
      ts: m.ts,
      views: m.v,
      media: m.m || "",
      text: c.text,
      primary: c.primary,
      cats: c.cats,
      tags: c.tags,
      hashtags: c.hashtags.slice(0, 6),
      value: c.value,
      content: c.content,
      spam: c.spam,
      links: c.links.slice(0, 10),
      domains: c.domains.slice(0, 8),
      lp: m.lp,
      fwd: m.fw || undefined,
    };

    stats.byChannel[ch] = (stats.byChannel[ch] || 0) + 1;
    if (rec.date) { const d = rec.date.slice(0, 7); stats.dates[d] = (stats.dates[d] || 0) + 1; }

    if (c.spam >= 4 || (c.spam >= 3 && c.text.length < 80)) { stats.spam++; continue; }
    stats.clean++;
    stats.byCat[rec.primary] = (stats.byCat[rec.primary] || 0) + 1;
    for (const t of rec.tags) stats.byTag[t] = (stats.byTag[t] || 0) + 1;

    cleanOut.write(JSON.stringify(rec) + "\n");
    if (c.content >= 2 && rec.text.length >= 10) {
      stats.valuable++;
      valOut.write(JSON.stringify(rec) + "\n");
    }
  }
}

async function main() {
  for (const ch of ordered) {
    const dir = path.join(RAW, ch);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
    let n = 0;
    for (const f of files) { await processFile(ch, path.join(dir, f)); n++; }
    console.log(ch + ': ' + files.length + ' segments processed; running total=' + stats.total);
  }
  await new Promise(r => cleanOut.end(r));
  await new Promise(r => valOut.end(r));

  const dates = Object.entries(stats.dates).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const summary = {
    generatedAt: new Date().toISOString(),
    channels: TITLES,
    totals: { raw: stats.total, dupId: stats.dupId, dupText: stats.dupText, spam: stats.spam, clean: stats.clean, valuable: stats.valuable },
    byChannel: stats.byChannel, byCategory: stats.byCat, byTag: stats.byTag,
    dateRange: dates.length ? [dates[0][0], dates[dates.length - 1][0]] : [],
    byMonth: Object.fromEntries(dates),
  };
  fs.writeFileSync(path.join(DATA, 'stats.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary.totals));
  console.log('categories:', JSON.stringify(stats.byCat));
  console.log('byChannel:', JSON.stringify(stats.byChannel));
}
main().catch(e => { console.error(e); process.exit(1); });
