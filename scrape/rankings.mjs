import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'output', '分类报告');

const EXCLUDE = /(^|\.)linux\.do$|(^|\.)t\.me$|(^|\.)telegram\.org$|(^|\.)telesco\.pe$|(^|\.)ldstatic\.com$|^127\.0\.0\.1$|(^|\.)telegram\.me$|(^|\.)t\.lg$|^localhost$/;
const NOISE = new Set('version namespace description author grant match latest gmail include exclude icon name license homepage support downloadurl updateurl require resource connect run-at noframes antifeature iconurl email date copyright website docs example test todo param args media import export type interface enum struct class return throws deprecated since see file module package project app api url http https www com org net'.split(' '));
const FILEHOST = /quark\.cn|baidu\.com|lanzou|123pan|aliyundrive|alipan|115\.com|weiyun|ctfile|uguu|mypikpak|lanzoui|lanzoux/;

const dom = new Map(), domFile = new Map(), men = new Map();
let n = 0;
const rl = readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'data', 'valuable.jsonl')), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let it; try { it = JSON.parse(line); } catch (e) { continue; }
  n++;
  for (const d of it.domains || []) {
    if (EXCLUDE.test(d)) continue;
    if (FILEHOST.test(d)) domFile.set(d, (domFile.get(d) || 0) + 1);
    else dom.set(d, (dom.get(d) || 0) + 1);
  }
  const re = /@([A-Za-z][A-Za-z0-9_]{4,31})/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(it.text || ""))) {
    const k = m[1];
    if (NOISE.has(k.toLowerCase())) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    men.set(k, (men.get(k) || 0) + 1);
  }
}
const top = [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300);
const L = ['# 高频资源网站 TOP 300', '', '> 已剔除 Telegram / linux.do 自身域名与网盘链接，剩下的就是频道们反复推荐的**工具站、资源站、资讯源**。', '> 出现次数越高，说明被越多不同帖子验证过，越值得优先收藏。', '', '| 排名 | 域名 | 出现次数 |', '|---|---|---|'];
top.forEach((e, i) => L.push('| ' + (i + 1) + ' | [' + e[0] + '](https://' + e[0] + ') | ' + e[1] + ' |'));
const tf = [...domFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
L.push('', '## 附：高频网盘/文件中转站 TOP 60', '', '> 频道分享资源的主要落脚点，配合具体条目使用。', '', '| 排名 | 域名 | 出现次数 |', '|---|---|---|');
tf.forEach((e, i) => L.push('| ' + (i + 1) + ' | [' + e[0] + '](https://' + e[0] + ') | ' + e[1] + ' |'));
fs.writeFileSync(path.join(OUT, '98-高频资源网站TOP300.md'), L.join('\n'), 'utf8');

const mt = [...men.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
const M = ['# 被高频推荐的 Telegram 频道/账号 TOP 200', '', '> 已剔除脚本元数据（@version/@author 等）与邮箱域名等噪音，可作为继续扩充信源的候选。', '', '| 排名 | 账号 | 被提及次数 |', '|---|---|---|'];
mt.forEach((e, i) => M.push('| ' + (i + 1) + ' | [@' + e[0] + '](https://t.me/' + e[0] + ') | ' + e[1] + ' |'));
fs.writeFileSync(path.join(OUT, '99-推荐频道账号TOP200.md'), M.join('\n'), 'utf8');
console.log('scanned', n);
console.log('TOP TOOL DOMAINS:');
top.slice(0, 45).forEach((e, i) => console.log('  ' + (i + 1) + '. ' + e[0] + '  ' + e[1]));
console.log('TOP MENTIONS:');
mt.slice(0, 25).forEach((e, i) => console.log('  ' + (i + 1) + '. @' + e[0] + '  ' + e[1]));
