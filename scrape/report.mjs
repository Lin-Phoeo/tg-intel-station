// Generate human-readable reports and CSV exports
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, '分类报告'), { recursive: true });
fs.mkdirSync(path.join(OUT, '数据'), { recursive: true });

const MD_CAP = Number(process.env.MD_CAP || 1200);
const DASH_CAP = Number(process.env.DASH_CAP || 30000);

const items = [];
const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATA, 'valuable.jsonl')), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try { items.push(JSON.parse(line)); } catch (e) {}
}
console.log('loaded valuable items:', items.length);

const stats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8'));
const fmtD = (d) => (d || '').slice(0, 10);

function oneLine(it, max) {
  max = max || 220;
  let t = (it.text || '').replace(/\s*\n+\s*/g, ' ｜ ').trim();
  if (t.length > max) t = t.slice(0, max) + '…';
  return t;
}
function linkStr(it) {
  const u = (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '';
  if (!u) return '';
  const label = it.domains && it.domains[0] ? it.domains[0] : (it.lp && it.lp[0] && it.lp[0].s) || '链接';
  return '[' + label + '](' + u + ')';
}

const byCat = new Map();
for (const it of items) {
  const k = it.primary || '其他';
  if (!byCat.has(k)) byCat.set(k, []);
  byCat.get(k).push(it);
}
const CAT_ORDER = ['羊毛优惠', '项目副业', '实用工具', '开源项目', 'AI与科技', '服务器网络', '账号会员', '学习资源', '数码硬件', '资讯热点', '其他'];
const files = [];
let idx = 0;
for (const cat of CAT_ORDER) {
  const arr = byCat.get(cat);
  if (!arr || !arr.length) continue;
  arr.sort((a, b) => b.value - a.value || (b.ts || 0) - (a.ts || 0));
  idx++;
  const fn = String(idx).padStart(2, '0') + '-' + cat + '.md';
  const lines = [];
  lines.push('# ' + cat + '（精选 ' + Math.min(arr.length, MD_CAP) + ' / 共 ' + arr.length + ' 条）', '');
  lines.push('> 已过滤广告/垃圾/黑产 ｜ 按「价值分」排序 ｜ 完整数据见 output/数据/ 目录', '');
  const shown = arr.slice(0, MD_CAP);
  const byMonth = new Map();
  for (const it of shown) {
    const mo = fmtD(it.date).slice(0, 7) || '未知';
    if (!byMonth.has(mo)) byMonth.set(mo, []);
    byMonth.get(mo).push(it);
  }
  for (const entry of [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    lines.push('## ' + entry[0], '');
    for (const it of entry[1]) {
      const tag = it.tags && it.tags.length ? '**[' + it.tags.slice(0, 3).join('·') + ']** ' : '';
      lines.push('- ' + tag + oneLine(it) + '  ' + linkStr(it));
      lines.push('  <sub>' + fmtD(it.date) + ' · @' + it.channel + ' · 浏览 ' + (it.views == null ? '-' : it.views) + ' · 分数 ' + it.value + ' · [原文](' + it.url + ')</sub>');
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, '分类报告', fn), lines.join('\n'), 'utf8');
  files.push({ cat: cat, fn: fn, n: arr.length });
  console.log('wrote', fn, arr.length);
}

const top = [...items].sort((a, b) => b.value - a.value || (b.views || 0) - (a.views || 0)).slice(0, 500);
const tl = ['# 全网价值 TOP 500', '', '> 综合价值分 = 分类权重 + 免费/限时标签 + 链接(尤其 GitHub) + 热度 + 时效', ''];
let lastC = null;
for (const it of top) {
  if (it.primary !== lastC) { tl.push('', '## ' + it.primary, ''); lastC = it.primary; }
  tl.push('- ' + oneLine(it, 260) + '  ' + linkStr(it));
  tl.push('  <sub>' + fmtD(it.date) + ' · @' + it.channel + ' · 浏览 ' + (it.views == null ? '-' : it.views) + ' · ' + it.value + '分 · [原文](' + it.url + ')</sub>');
}
fs.writeFileSync(path.join(OUT, '分类报告', '00-全网价值TOP500.md'), tl.join('\n'), 'utf8');

const dom = new Map();
for (const it of items) for (const d of it.domains || []) dom.set(d, (dom.get(d) || 0) + 1);
const domTop = [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300);
const dl = ['# 高频资源网站 TOP 300', '', '> 被频道反复推荐的域名，通常代表值得收藏的工具/资源站。', '', '| 排名 | 域名 | 出现次数 |', '|---|---|---|'];
domTop.forEach((e, i) => dl.push('| ' + (i + 1) + ' | [' + e[0] + '](https://' + e[0] + ') | ' + e[1] + ' |'));
fs.writeFileSync(path.join(OUT, '分类报告', '98-高频资源网站TOP300.md'), dl.join('\n'), 'utf8');

const men = new Map();
for (const it of items) {
  const re = /@([A-Za-z][A-Za-z0-9_]{4,31})/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(it.text || ''))) if (!seen.has(m[1])) { seen.add(m[1]); men.set(m[1], (men.get(m[1]) || 0) + 1); }
}
const menTop = [...men.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
const ml = ['# 被高频推荐的 Telegram 频道/账号 TOP 200', '', '> 可作为继续扩充信源的候选。', '', '| 排名 | 账号 | 被提及次数 |', '|---|---|---|'];
menTop.forEach((e, i) => ml.push('| ' + (i + 1) + ' | [@' + e[0] + '](https://t.me/' + e[0] + ') | ' + e[1] + ' |'));
fs.writeFileSync(path.join(OUT, '分类报告', '99-推荐频道账号TOP200.md'), ml.join('\n'), 'utf8');

const chVal = {};
const tagCnt = {};
for (const it of items) {
  chVal[it.channel] = (chVal[it.channel] || 0) + 1;
  for (const t of it.tags || []) tagCnt[t] = (tagCnt[t] || 0) + 1;
}
fs.writeFileSync(path.join(DATA, 'insights.json'), JSON.stringify({
  valuableTotal: items.length,
  perChannelValuable: chVal,
  topDomains: domTop.slice(0, 120),
  topMentions: menTop.slice(0, 100),
  topTags: Object.entries(tagCnt).sort((a, b) => b[1] - a[1]),
}, null, 2));
console.log('insights written');

const head = ['日期', '频道', '分类', '标签', '价值分', '浏览', '正文摘要', '链接', '原文'];
const csvLines = [head.join(',')];
for (const it of items) {
  const cells = [
    fmtD(it.date), it.channel, it.primary, (it.tags || []).join(' '), it.value, it.views == null ? '' : it.views,
    (it.text || '').replace(/\s*\n+\s*/g, ' ').slice(0, 500),
    (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '', it.url,
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
  csvLines.push(cells.join(','));
}
const csvPath = path.join(OUT, '数据', '精华内容-' + items.length + '条.csv');
fs.writeFileSync(csvPath, '\ufeff' + csvLines.join('\r\n'), 'utf8');
console.log('wrote', csvPath, items.length, 'rows');

const dash = items.slice().sort((a, b) => b.value - a.value).slice(0, DASH_CAP).map(it => [
  fmtD(it.date), it.channel, it.primary, (it.tags || []).join(','), it.value, it.views == null ? 0 : it.views,
  (it.text || '').replace(/\s*\n+\s*/g, ' ').slice(0, 400),
  (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '', it.url,
]);
fs.writeFileSync(path.join(DATA, 'dashboard.json'), JSON.stringify(dash), 'utf8');
console.log('dashboard items:', dash.length);

const catIdx = {};
CAT_ORDER.forEach((c, i) => { catIdx[c] = i; });
const sorted = items.slice().sort((a, b) => ((catIdx[a.primary] == null ? 99 : catIdx[a.primary]) - (catIdx[b.primary] == null ? 99 : catIdx[b.primary])) || b.value - a.value);
const sOut = fs.createWriteStream(path.join(DATA, 'valuable_sorted.jsonl'));
for (const it of sorted) sOut.write(JSON.stringify(it) + '\n');
await new Promise(r => sOut.end(r));
console.log('sorted written:', sorted.length);

const cOut = fs.createWriteStream(path.join(OUT, '数据', '全部有效内容.csv'));
cOut.write('\ufeff' + head.join(',') + '\r\n');
let cn = 0;
const rl2 = readline.createInterface({ input: fs.createReadStream(path.join(DATA, 'clean.jsonl')), crlfDelay: Infinity });
for await (const line of rl2) {
  if (!line.trim()) continue;
  let it; try { it = JSON.parse(line); } catch (e) { continue; }
  const cells = [
    fmtD(it.date), it.channel, it.primary, (it.tags || []).join(' '), it.value, it.views == null ? '' : it.views,
    (it.text || '').replace(/\s*\n+\s*/g, ' ').slice(0, 300),
    (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '', it.url,
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"');
  cOut.write(cells.join(',') + '\r\n');
  cn++;
}
await new Promise(r => cOut.end(r));
console.log('all-valid CSV rows:', cn);
fs.writeFileSync(path.join(DATA, 'report_index.json'), JSON.stringify({ files: files, total: items.length, cleanCsvRows: cn }, null, 2));
console.log('DONE reports');
