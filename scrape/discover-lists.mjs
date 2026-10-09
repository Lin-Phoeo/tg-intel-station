// 从公开的精选列表仓库提取 Telegram 频道，过滤主题后逐个探测
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../app/server/store.mjs';
import { fetchHtml } from '../core/net.mjs';
import { parseMessages } from '../core/parse.mjs';
import { decodeEntities } from '../core/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONC = Number(process.env.CONC || 8);

const LISTS = [
  'https://raw.githubusercontent.com/awesome-telegram/awesome-telegram-chinese/main/README.md',
  'https://raw.githubusercontent.com/nonomal/rectg/main/README.md',
  'https://raw.githubusercontent.com/redkio/Telegramchannel/master/README.md',
];

// 我们关心的主题词：命中才值得加
const WANT = ['ai', '人工智能', '大模型', 'gpt', 'claude', 'chatgpt', 'agent', '智能体', '开源', 'github', '工具', '软件', 'app', '羊毛', '免费', '白嫖', '优惠', '福利', 'vps', '服务器', '节点', '订阅', '副业', '赚钱', '变现', '创业', '教程', '资源', '科技', '数码', '破解', 'nas', 'docker', 'python', 'linux', '前端', '后端', '程序员', '开发', '自动化', '爬虫', '设计', '运营', '效率', '导航', '博客'];
const SKIP = ['色情', '博彩', '赌博', '成人', '约炮', 'porn', 'sex', '赌', '彩票', '招嫖', '洗钱', '跑分'];

console.log('步骤 1/3：抓取精选列表…');
const found = new Map();   // username -> { line, src }
for (const url of LISTS) {
  const txt = await fetchHtml(url, 2);
  if (!txt) { console.log('  跳过（抓取失败）: ' + url); continue; }
  let n = 0;
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (SKIP.some(k => lower.includes(k))) continue;
    const us = new Set();
    let m;
    const re1 = /t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})/g;
    while ((m = re1.exec(line))) us.add(m[1]);
    const re2 = /@([A-Za-z][A-Za-z0-9_]{4,31})/g;
    while ((m = re2.exec(line))) us.add(m[1]);
    for (const u of us) { if (!found.has(u)) { found.set(u, { line: line, src: url.split('/')[4] }); n++; } }
  }
  console.log('  ' + url.split('/')[4] + ': 提取 ' + n + ' 个账号');
}
console.log('  合计去重后 ' + found.size + ' 个');

console.log('步骤 2/3：按主题过滤…');
const known = new Set(store.listSources().map(s => s.id.toLowerCase()));
const themed = [...found.entries()].filter(([u, v]) => {
  if (known.has(u.toLowerCase())) return false;
  const hay = (u + ' ' + v.line).toLowerCase();
  return WANT.some(k => hay.includes(k));
});
console.log('  命中主题且未添加的: ' + themed.length);

console.log('步骤 3/3：探测 t.me/s/ …');
const results = [];
let idx = 0;
async function worker() {
  while (idx < themed.length) {
    const [name, meta] = themed[idx++];
    try {
      const html = await fetchHtml('https://t.me/s/' + name, 2);
      if (!html) { results.push({ name: name, status: 'unreachable', line: meta.line }); continue; }
      const msgs = parseMessages(html, name);
      const title = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
      const desc = decodeEntities((html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '');
      results.push({ name: name, status: msgs.length > 0 ? 'scrapable' : 'no-preview', title: title, desc: desc.slice(0, 100), msgs: msgs.length, line: meta.line.slice(0, 120), src: meta.src });
    } catch (e) { results.push({ name: name, status: 'error', line: meta.line }); }
    if (idx % 60 === 0) console.log('  已探测 ' + idx + '/' + themed.length);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const ok = results.filter(r => r.status === 'scrapable').sort((a, b) => b.msgs - a.msgs);
console.log('\n=== 可抓取 ' + ok.length + ' 个 ===');
for (const r of ok.slice(0, 45)) console.log('  @' + r.name.padEnd(24) + String(r.msgs).padStart(3) + ' 条  ' + String(r.title).slice(0, 34));
fs.writeFileSync(path.join(ROOT, 'data', 'candidates2.json'), JSON.stringify(results, null, 2));
console.log('\n已写入 data/candidates2.json');
