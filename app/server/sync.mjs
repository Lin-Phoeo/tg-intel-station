// 一键补齐：把 sources 表里所有来源按顺序增量抓一遍。
// 设计上不做后台定时器 —— 由用户在界面上手动触发，可控、可预期、不偷偷跑。
import * as store from './store.mjs';
import { importInto } from './source.mjs';

let state = {
  running: false, startedAt: null, finishedAt: null,
  total: 0, done: 0, imported: 0, skipped: 0, scanned: 0,
  current: '', sources: [], error: null,
  // 谁触发的这次同步。之前不留痕迹，用户发现帖子变多了没法查是哪来的。
  startedBy: '',
};

function lastSyncInfo() {
  try {
    const d = store.open();
    const r = d.prepare("SELECT run_date, finished_at, detail FROM job_runs WHERE job_key = 'manual_sync' ORDER BY run_date DESC LIMIT 1").get();
    if (!r) return null;
    let detail = {};
    try { detail = JSON.parse(r.detail || '{}'); } catch (e) {}
    return { date: r.run_date, finishedAt: r.finished_at, imported: detail.imported || 0, scanned: detail.scanned || 0, sources: detail.sources || 0 };
  } catch (e) { return null; }
}

export function getSyncStatus() {
  return Object.assign({}, state, { lastSync: lastSyncInfo() });
}

export function isRunning() { return state.running; }

// 同步哪些来源：频道与网页（群组类来源本来就抓不到，跳过）
export function syncableSources() {
  return store.listSources().filter(s => s.kind === 'channel' || s.kind === 'web');
}

export async function runFullSync(opts) {
  if (state.running) return { ok: false, error: '已有同步任务在进行中' };
  const o = opts || {};
  const maxMessages = Number(o.maxMessages || 2000);

  const sources = syncableSources();
  if (!sources.length) return { ok: false, error: '还没有可同步的来源。先在「按链接抓取」里添加频道。' };

  // 记下同步前的最大 id，结束后据此挑出「本次新入库的高分内容」。
  // 帖子表没有入库时间字段，用自增 id 判断最可靠。
  let idBefore = 0;
  try { idBefore = Number(Object.values(store.open().prepare('SELECT COALESCE(MAX(id),0) m FROM posts').get())[0]) || 0; } catch (e) {}

  state = {
    running: true, startedAt: Date.now(), finishedAt: null,
    total: sources.length, done: 0, imported: 0, skipped: 0, scanned: 0,
    current: '', sources: [], error: null,
    startedBy: String(o.by || '未知'),
    highlights: [],
  };

  for (const s of sources) {
    state.current = s.title || s.id;
    const target = {
      id: 'sync', input: s.id, status: 'running', phase: '抓取中',
      imported: 0, skipped: 0, scanned: 0, total: 0,
      error: null, kind: '', title: s.title || '', note: '',
      startedAt: Date.now(), finishedAt: null,
    };
    try {
      await importInto(target, s.url || s.id, { maxMessages: maxMessages });
    } catch (e) {
      target.status = 'failed';
      target.error = String(e.message || e);
    }
    state.imported += target.imported || 0;
    state.skipped += target.skipped || 0;
    state.scanned += target.scanned || 0;
    state.done++;
    state.sources.push({
      id: s.id, title: s.title || s.id, kind: s.kind,
      status: target.status || 'done',
      imported: target.imported || 0, skipped: target.skipped || 0, scanned: target.scanned || 0,
      error: target.error || null, note: target.note || '',
    });
    await new Promise(r => setTimeout(r, 300));
  }

  state.running = false;
  state.finishedAt = Date.now();
  state.current = '';

  // 挑出本次新增里的高分内容（价值分 ≥ 7），供界面即时提醒。
  // 真正值钱的帖子很少，与其等用户翻列表，不如直接把它们端到眼前。
  try {
    const d = store.open();
    const rows = d.prepare('SELECT id, text, category, channel, date, value, url FROM posts WHERE id > ? AND value >= 7 AND is_rep = 1 ORDER BY value DESC LIMIT 20').all(idBefore);
    state.highlights = rows.map(r => ({
      id: Number(r.id), category: r.category, channel: r.channel,
      date: r.date, value: Number(r.value) || 0,
      title: String(r.text || '').split('\n')[0].slice(0, 90),
    }));
  } catch (e) { state.highlights = []; }

  try {
    const d = store.open();
    const today = new Date().toISOString().slice(0, 10);
    d.prepare("INSERT OR REPLACE INTO job_runs(job_key,run_date,status,started_at,finished_at,detail) VALUES('manual_sync',?,?,?,?,?)").run(
      today, 'done', new Date(state.startedAt).toISOString(), new Date(state.finishedAt).toISOString(),
      JSON.stringify({ imported: state.imported, scanned: state.scanned, sources: sources.length })
    );
  } catch (e) {}

  return {
    ok: true, imported: state.imported, skipped: state.skipped, scanned: state.scanned,
    sources: sources.length, elapsed: state.finishedAt - state.startedAt,
    highlights: state.highlights,
  };
}

export function startFullSync(opts) {
  if (state.running) return { ok: false, error: '已有同步任务在进行中' };
  runFullSync(opts).catch(e => {
    state.running = false;
    state.error = String(e.message || e);
    state.finishedAt = Date.now();
  });
  return { ok: true, started: true, total: syncableSources().length };
}
