// 全量回填聚簇：给每条计算 cluster_key，同键的归到一个代表
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterKey } from '../core/cluster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'app', 'data', 'intel.db');

const t0 = Date.now();
const d = new DatabaseSync(DB_PATH);
d.exec('PRAGMA cache_size=-200000');
d.exec('PRAGMA synchronous=OFF');

console.log('步骤 1/3：计算 cluster_key …');
const upd = d.prepare('UPDATE posts SET cluster_key = ? WHERE id = ?');
const groups = new Map();
let last = 0, n = 0, keyed = 0;
while (true) {
  const rows = d.prepare('SELECT id, channel, links, value, text FROM posts WHERE id > ? ORDER BY id LIMIT 20000').all(last);
  if (!rows.length) break;
  d.exec('BEGIN');
  for (const r of rows) {
    n++;
    const key = clusterKey(String(r.links || '').split(/\s+/).filter(Boolean));
    upd.run(key, r.id);
    if (key) {
      keyed++;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id: r.id, value: r.value || 0, len: String(r.text || '').length, ch: r.channel });
    }
  }
  d.exec('COMMIT');
  last = rows[rows.length - 1].id;
  if (n % 200000 === 0) console.log('  已处理 ' + n.toLocaleString());
}
console.log('  合计 ' + n.toLocaleString() + ' 条，其中可聚簇 ' + keyed.toLocaleString() + ' 条，形成 ' + groups.size.toLocaleString() + ' 个键');

console.log('步骤 2/3：重置代表 …');
d.exec('UPDATE posts SET rep_id = id, cluster_size = 1, is_rep = 1');

console.log('步骤 3/3：写入代表与簇大小 …');
const setRep = d.prepare('UPDATE posts SET rep_id = ?, cluster_size = ?, is_rep = ? WHERE id = ?');
let merged = 0, clusters = 0;
d.exec('BEGIN');
let batch = 0;
for (const [, arr] of groups) {
  if (arr.length < 2) continue;
  // 必须跨频道：同一链接在单个频道反复出现属于签名/固定栏目，不是同一事件
  if (new Set(arr.map(x => x.ch)).size < 2) continue;
  clusters++;
  // 代表：价值分最高，其次正文最长
  arr.sort((a, b) => (b.value - a.value) || (b.len - a.len));
  const rep = arr[0].id;
  for (const it of arr) { setRep.run(rep, arr.length, it.id === rep ? 1 : 0, it.id); merged++; }
  if (++batch % 5000 === 0) { d.exec('COMMIT'); d.exec('BEGIN'); }
}
d.exec('COMMIT');
d.exec('CREATE INDEX IF NOT EXISTS idx_posts_cluster ON posts(cluster_key)');
d.exec('CREATE INDEX IF NOT EXISTS idx_posts_rep ON posts(rep_id)');
d.exec('CREATE INDEX IF NOT EXISTS idx_posts_isrep ON posts(is_rep)');
d.close();

console.log('\n=== 完成 ===');
console.log('参与聚合的条目: ' + merged.toLocaleString() + '（归属 ' + clusters.toLocaleString() + ' 个事件簇）');
console.log('即信息流可减少重复展示 ' + Math.max(0, merged - clusters).toLocaleString() + ' 条');
console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
