// 发现可抓取的公开频道：从库内高频 @ 提及中挖候选，逐个探测 t.me/s/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../app/server/store.mjs';
import { fetchHtml } from '../core/net.mjs';
import { parseMessages } from '../core/parse.mjs';
import { decodeEntities } from '../core/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'output');
const CONC = Number(process.env.CONC || 8);
const TOPN = Number(process.env.TOPN || 260);

const NOISE = new Set('version namespace description author grant match latest gmail include exclude icon name license homepage support downloadurl updateurl require resource connect run-at noframes antifeature iconurl email date copyright website docs example test todo param args media import export type interface enum struct class return throws deprecated since see file module package project app api url http https www com org net channel group bot'.split(' '));

// 主题相关性：标题/简介命中这些词，说明和我们的关注点一致
const THEME = ['ai', '人工智能', '大模型', 'gpt', 'claude', 'gemini', 'agent', '智能体', '开源', 'github', '工具', '软件', '羊毛', '免费', '白嫖', '优惠', '福利', 'vps', '服务器', '节点', '机场', '订阅', '副业', '赚钱', '变现', '创业', '教程', '资源', '科技', '数码', '破解', 'nas', 'docker', 'python', 'linux', '前端', '后端', '程序员', '独立开发', '自动化', '爬虫'];

console.log('步骤 1/2：从数据库挖掘候选账号…');
const men = new Map();
store.forEachPost({ size: 5000 }, (batch) => {
  for (const it of batch) {
    const re = /@([A-Za-z][A-Za-z0-9_]{4,31})/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(it.text || ''))) {
      const k = m[1];
      if (NOISE.has(k.toLowerCase())) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      men.set(k, (men.get(k) || 0) + 1);
    }
  }
});

const known = new Set(store.listSources().map(s => s.id.toLowerCase()));
const candidates = [...men.entries()]
  .filter(e => !known.has(e[0].toLowerCase()))
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOPN);
console.log('  候选 ' + candidates.length + ' 个（已排除已添加的 ' + known.size + ' 个来源）');

console.log('步骤 2/2：探测 t.me/s/ …');
const results = [];
let idx = 0;
async function worker() {
  while (idx < candidates.length) {
    const [name, count] = candidates[idx++];
    const url = 'https://t.me/s/' + name;
    try {
      const html = await fetchHtml(url, 2);
      if (!html) { results.push({ name: name, mentions: count, kind: 'unreachable' }); continue; }
      const msgs = parseMessages(html, name);
      const title = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '');
      const desc = decodeEntities((html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1] || '');
      const extra = decodeEntities(((html.match(/tgme_page_extra[^>]*>([^<]*)</) || [])[1] || '').trim());
      const isChannel = /subscribers?/i.test(extra) || msgs.length > 0;
      const hay = (title + ' ' + desc).toLowerCase();
      const theme = THEME.filter(k => hay.includes(k));
      results.push({
        name: name, mentions: count,
        kind: isChannel ? 'channel' : 'group',
        title: title, desc: desc.slice(0, 120), extra: extra,
        msgs: msgs.length, themeHits: theme.length, theme: theme.slice(0, 6),
        status: msgs.length > 0 ? 'scrapable' : 'no-preview',
      });
    } catch (e) {
      results.push({ name: name, mentions: count, kind: 'error', error: String(e.message).slice(0, 60) });
    }
    if (idx % 40 === 0) console.log('  已探测 ' + idx + '/' + candidates.length);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const scrapable = results.filter(r => r.status === 'scrapable').sort((a, b) => (b.themeHits - a.themeHits) || (b.mentions - a.mentions));
const groups = results.filter(r => r.kind === 'group');
const dead = results.filter(r => r.status === 'no-preview' || r.kind === 'unreachable' || r.kind === 'error');

console.log('\n=== 结果 ===');
console.log('可抓取的公开频道: ' + scrapable.length);
console.log('群组（无公开预览）: ' + groups.length);
console.log('无预览/不可达: ' + dead.length);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'candidates.json'), JSON.stringify(results, null, 2));

const L = ['# 候选情报源（自动探测）', '', '> 来源：库内 85 万条帖子中被 @ 提及的账号，逐个访问 t.me/s/ 探测。', '> 只有**公开频道**能抓到消息；群组 Telegram 不提供公开预览。', '', '## 可抓取的公开频道（按主题相关度排序）', '', '| 账号 | 提及 | 订阅数 | 主题命中 | 近期消息 | 简介 |', '|---|---|---|---|---|---|'];
for (const r of scrapable.slice(0, 150)) {
  L.push('| [@' + r.name + '](https://t.me/' + r.name + ') | ' + r.mentions + ' | ' + (r.extra || '-') + ' | ' + (r.theme.slice(0, 4).join('/') || '-') + ' | ' + r.msgs + ' | ' + String(r.title || '').replace(/\|/g, '/').slice(0, 40) + ' |');
}
L.push('', '## 群组（抓不到消息，只能记录）', '', '| 账号 | 提及 | 成员数 | 名称 |', '|---|---|---|---|');
for (const r of groups.slice(0, 60)) L.push('| @' + r.name + ' | ' + r.mentions + ' | ' + (r.extra || '-') + ' | ' + String(r.title || '').replace(/\|/g, '/').slice(0, 36) + ' |');
fs.writeFileSync(path.join(OUT, '分类报告', '97-候选情报源.md'), L.join('\n'), 'utf8');
console.log('已写入 output/分类报告/97-候选情报源.md 与 data/candidates.json');
console.log('\n主题相关度最高的 25 个：');
for (const r of scrapable.slice(0, 25)) console.log('  @' + r.name.padEnd(22) + '提及' + String(r.mentions).padStart(4) + '  ' + String(r.extra).padEnd(22) + r.theme.slice(0, 4).join('/'));
