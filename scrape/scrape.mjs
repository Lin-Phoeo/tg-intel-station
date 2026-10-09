// Full-history scraper for Telegram public channels via t.me/s preview
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMessages } from '../core/parse.mjs';
import { decodeEntities } from '../core/text.mjs';
import { fetchHtml } from '../core/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
fs.mkdirSync(RAW, { recursive: true });

const ALL = ["JIKE0906","goodlearnclub","iGitHub","piracy6","linuxdoit","linux_do_channel",
             "zaihuapd","qiuyuezt","pgkj666","baipiaou","QingLongAndroid"];

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const channels = only.length ? only : ALL;
const CONC = Number(process.env.CONC || 32);
const SEG_SPAN = Number(process.env.SEG_SPAN || 12000);

async function runSegment(t, outFile, stat) {
  const stream = fs.createWriteStream(outFile, { flags: 'w' });
  let before = t.top + 1;
  let written = 0;
  while (true) {
    const html = await fetchHtml(`https://t.me/s/${t.ch}?before=${before}`);
    if (!html) break;
    const msgs = parseMessages(html, t.ch);
    if (!msgs.length) break;
    for (const m of msgs) stream.write(JSON.stringify(m) + "\n");
    written += msgs.length;
    stat.reqs++;
    const min = msgs.reduce((a, m) => Math.min(a, m.i), Infinity);
    if (min <= t.bottom) break;
    if (min >= before) break;
    before = min;
  }
  await new Promise(r => stream.end(r));
  return written;
}

async function main() {
  const tasks = [];
  const metaAll = [];
  for (const ch of channels) {
    const dir = path.join(RAW, ch);
    fs.mkdirSync(dir, { recursive: true });
    const first = await fetchHtml(`https://t.me/s/${ch}`);
    if (!first) { console.log(`!! ${ch}: fetch failed`); continue; }
    const msgs = parseMessages(first, ch);
    if (!msgs.length) { console.log(`!! ${ch}: no public messages (group/private)`); continue; }
    const title = decodeEntities((first.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || ch);
    const desc = decodeEntities((first.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || "");
    const latest = msgs.reduce((a, m) => Math.max(a, m.i), 0);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ channel: ch, title, desc, latest }, null, 2));
    metaAll.push({ ch, title, desc, latest });
    const segs = [];
    for (let top = latest, idx = 0; top > 0; top -= SEG_SPAN, idx++) {
      segs.push({ ch, idx, top, bottom: Math.max(1, top - SEG_SPAN) });
    }
    tasks.push(...segs);
    console.log(`${ch}: "${title}" latest=${latest} segments=${segs.length} desc=${desc.slice(0,60).replace(/\n/g,' ')}`);
  }
  fs.writeFileSync(path.join(RAW, '_channels.json'), JSON.stringify(metaAll, null, 2));

  console.log(`\n=== ${tasks.length} segments, concurrency ${CONC}, span ${SEG_SPAN} ===\n`);
  const stat = { reqs: 0 }; let cursor = 0, done = 0;
  const started = Date.now();
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      const t = tasks[idx];
      const dir = path.join(RAW, t.ch);
      const outFile = path.join(dir, `seg_${String(t.idx).padStart(4, '0')}.jsonl`);
      if (fs.existsSync(outFile + '.done')) { done++; continue; }
      const n = await runSegment(t, outFile, stat);
      fs.writeFileSync(outFile + '.done', JSON.stringify({ finished: Date.now(), messages: n, reqs: stat.reqs }));
      done++;
      const el = (Date.now() - started) / 1000;
      console.log(`[${done}/${tasks.length}] ${t.ch} seg${t.idx} ids ${t.bottom}-${t.top} msgs=${n} reqs=${stat.reqs} ${el.toFixed(0)}s`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, worker));
  console.log(`\nDONE. total requests=${stat.reqs} elapsed=${((Date.now()-started)/1000/60).toFixed(1)}min`);
}
main().catch(e => { console.error(e); process.exit(1); });
