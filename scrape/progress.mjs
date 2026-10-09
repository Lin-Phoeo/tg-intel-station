// 实时进度监控：node scrape/progress.mjs
// 在终端里持续刷新后台任务的进度，不用一直点界面。
const B = process.env.API || 'http://127.0.0.1:8317';
const INTERVAL = Number(process.env.INTERVAL || 3000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', amber: '\x1b[33m', violet: '\x1b[35m', cyan: '\x1b[36m', red: '\x1b[31m',
};

function bar(pct, width) {
  const w = width || 40;
  const n = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  return '█'.repeat(n) + C.dim + '░'.repeat(w - n) + C.reset;
}
function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '--';
  if (sec < 60) return Math.round(sec) + ' 秒';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' 分钟';
  return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

let first = true;
async function tick() {
  let sem, sync, fac;
  try {
    sem = await (await fetch(B + '/api/semantic/status')).json();
  } catch (e) {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(C.red + '连不上服务（' + B + '）' + C.reset);
    console.log(C.dim + '确认「启动情报站.cmd」开着' + C.reset);
    return;
  }
  try { sync = await (await fetch(B + '/api/sync/status')).json(); } catch (e) {}
  try { fac = await (await fetch(B + '/api/facets')).json(); } catch (e) {}

  const out = [];
  out.push('');
  out.push(C.bold + '  电报情报站 · 后台任务进度' + C.reset + C.dim + '   ' + stamp() + C.reset);
  out.push(C.dim + '  ' + '─'.repeat(64) + C.reset);

  // 向量化
  const st = (sem && sem.stats) || {};
  const indexed = Number(st.indexed || 0);
  const eligible = Number(st.eligible || 0);
  const running = !!(sem && sem.running);
  const done = running ? (sem.done || 0) : indexed;
  const total = running ? (sem.total || 0) : eligible;
  const pct = total ? (done / total) * 100 : (eligible ? 100 : 0);
  const color = running ? C.violet : (indexed >= eligible && eligible ? C.green : C.amber);

  out.push('');
  out.push('  ' + color + (running ? '⟳ 向量化进行中' : (indexed >= eligible && eligible ? '✓ 向量索引已完成' : '⚠ 向量索引未完成')) + C.reset);
  out.push('  ' + color + bar(pct, 44) + C.reset + '  ' + C.bold + pct.toFixed(1) + '%' + C.reset);
  out.push('  ' + C.dim + done.toLocaleString() + ' / ' + total.toLocaleString() + ' 条' +
    (sem && sem.failed ? '   失败 ' + C.amber + sem.failed + C.reset + C.dim : '') +
    (sem && sem.model ? '   模型 ' + sem.model : '') +
    (sem && sem.dim ? ' · ' + sem.dim + ' 维' : '') + C.reset);

  if (running && sem.startedAt && done > 50) {
    const speed = (Date.now() - sem.startedAt) / done;
    const left = (total - done) * speed;
    out.push('  ' + C.dim + speed.toFixed(0) + 'ms/条   已用 ' + fmtDur((Date.now() - sem.startedAt) / 1000) +
      '   剩余 ' + C.cyan + fmtDur(left / 1000) + C.reset + C.dim +
      '   预计 ' + new Date(Date.now() + left).toLocaleTimeString('zh-CN') + ' 完成' + C.reset);
  } else if (!running && total > done) {
    out.push('  ' + C.amber + '未在运行 —— 到界面上点「继续向量化」' + C.reset);
  }
  if (sem && sem.error) out.push('  ' + C.red + String(sem.error).split('\n')[0].slice(0, 70) + C.reset);

  // 一键补齐
  if (sync && sync.running) {
    out.push('');
    const sp = sync.total ? (sync.done / sync.total) * 100 : 0;
    out.push('  ' + C.cyan + '⟳ 一键补齐进行中' + C.reset + C.dim + '   ' + sync.done + '/' + sync.total + ' 个来源' + C.reset);
    out.push('  ' + C.cyan + bar(sp, 44) + C.reset + C.dim + '  新增 ' + (sync.imported || 0) + ' 条' + C.reset);
    if (sync.current) out.push('  ' + C.dim + '正在抓：' + String(sync.current).slice(0, 46) + C.reset);
  } else if (sync && sync.lastSync) {
    out.push('');
    out.push('  ' + C.dim + '上次一键补齐：' + sync.lastSync.date + '  新增 ' + sync.lastSync.imported + ' 条' + C.reset);
  }

  // 库总量
  if (fac) {
    out.push('');
    out.push(C.dim + '  ' + '─'.repeat(64) + C.reset);
    out.push('  ' + C.dim + '库内总计 ' + Number(fac.meta.count).toLocaleString() + ' 条   分组 ' +
      fac.categories.length + ' 类   频道 ' + fac.channels.length + ' 个' + C.reset);
  }
  out.push('');
  out.push(C.dim + '  每 ' + (INTERVAL / 1000) + ' 秒刷新一次，Ctrl+C 退出（关掉也不影响后台任务）' + C.reset);
  out.push('');

  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(out.join('\n') + '\n');
  first = false;
}

process.on('SIGINT', () => { process.stdout.write('\x1b[2J\x1b[H'); console.log('已退出监控（后台任务不受影响）\n'); process.exit(0); });

await tick();
while (true) { await sleep(INTERVAL); await tick(); }
