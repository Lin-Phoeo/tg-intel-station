const B = 'http://127.0.0.1:8317';
const j = async (u) => { const r = await fetch(B + u); return r.json(); };
const rows = [];
for (const q of ['免费', '中转站', 'claude', '免费 VPS', '开源', '白嫖', 'AI', '节点 订阅', 'VPS']) {
  let best = 1e9, r0 = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    r0 = await j('/api/search?q=' + encodeURIComponent(q) + '&size=30');
    best = Math.min(best, Date.now() - t0);
  }
  if (!r0) { rows.push(String(q).padEnd(14) + '无响应'); continue; }
  rows.push(String(q).padEnd(14) + String(r0.mode || '?').padEnd(8) + String(Number(r0.total || 0).toLocaleString()).padEnd(11) + best + 'ms');
}
console.log('查询'.padEnd(14) + '模式'.padEnd(8) + '命中'.padEnd(11) + '耗时');
console.log('-'.repeat(44));
for (const r of rows) console.log(r);
const s = await j('/api/search?q=' + encodeURIComponent('免费') + '&size=5');
console.log('\n=== 搜「免费」前 5 ===');
for (const it of (s.items || [])) console.log('  ' + String(it.text).replace(/\s+/g, ' ').slice(0, 70));
const s2 = await j('/api/search?q=' + encodeURIComponent('中转站') + '&size=3');
console.log('\n=== 搜「中转站」前 3 ===');
for (const it of (s2.items || [])) console.log('  ' + String(it.text).replace(/\s+/g, ' ').slice(0, 70));
