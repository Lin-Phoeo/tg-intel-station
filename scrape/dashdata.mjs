import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PER = Number(process.env.DASH_PER_CAT || 3500);
const byCat = new Map();
const rl = readline.createInterface({ input: fs.createReadStream(path.join(ROOT, 'data', 'valuable.jsonl')), crlfDelay: Infinity });
let n = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  let it; try { it = JSON.parse(line); } catch (e) { continue; }
  n++;
  const c = it.primary || '其他';
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(it);
}
const picked = [];
const report = [];
for (const e of byCat) {
  e[1].sort((a, b) => b.value - a.value || (b.views || 0) - (a.views || 0));
  const take = e[1].slice(0, PER);
  picked.push(...take);
  report.push(e[0] + ': 总 ' + e[1].length + ' -> 收录 ' + take.length);
}
picked.sort((a, b) => b.value - a.value || (b.views || 0) - (a.views || 0));
const dash = picked.map(it => [
  (it.date || '').slice(0, 10), it.channel, it.primary, (it.tags || []).join(','), it.value, it.views == null ? 0 : it.views,
  (it.text || '').replace(/\s*\n+\s*/g, ' ').slice(0, 360),
  (it.links && it.links[0]) || (it.lp && it.lp[0] && it.lp[0].u) || '', it.url,
]);
fs.writeFileSync(path.join(ROOT, 'data', 'dashboard.json'), JSON.stringify(dash), 'utf8');
console.log('source total', n);
console.log(report.join('\n'));
console.log('dashboard items:', dash.length);
