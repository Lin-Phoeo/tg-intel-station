// 一键补齐：把 sources 表里所有来源按顺序增量抓一遍。
// 默认不做后台定时器；日报到点时可显式等待一次同步完成。
import * as store from './store.mjs';
import { importInto } from './source.mjs';

let state = {
  running: false, startedAt: null, finishedAt: null,
  total: 0, done: 0, imported: 0, skipped: 0, scanned: 0,
  current: '', sources: [], error: null, startedBy: '',
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

export function getSyncStatus() { return Object.assign({}, state, { lastSync: lastSyncInfo() }); }
export function isRunning() { return state.running; }
export function syncableSources() { return store.listSources().filter(s => s.kind === 'channel' || s.kind === 'web'); }

export async function runFullSync(opts) {
  if (state.running) return { ok: false, error: '已有同步任务在进行中' };
  const o = opts || {};
  const maxMessages = Number(o.maxMessages || 2000);
  const sources = syncableSources();
  if (!sources.length) return { ok: false, error: '还没有可同步的来源。先在「按链接抓取」里添加频道。' };

  let idBefore = 0;
  try { idBefore = Number(Object.values(store.open().prepare('SELECT COALESCE(MAX(id),0) m FROM posts').get())[0]) || 0; } catch (e) {}
  state = {
    running: true, startedAt: Date.now(), finishedAt: null,
    total: sources.length, done: 0, imported: 0, skipped: 0, scanned: 0,
    current: '', sources: [], error: null, startedBy: String(o.by || '未知'),
    highlights: [],
  };

  for (const s of sources) {
    state.current = s.title || s.id;
    const target = {
      id: 'sync', input: s.id, status: 'running', phase: '抓取中',
      imported: 0, skipped: 0, scanned: 0, total: 0, error: null,
      kind: '', title: s.title || '', note: '', startedAt: Date.now(), finishedAt: null,
    };
    try { await importInto(target, s.url || s.id, { maxMessages }); }
    catch (e) { target.status = 'failed'; target.error = String(e.message || e); }
    state.imported += target.imported || 0;
    state.skipped += target.skipped || 0;
    state.scanned += target.scanned || 0;
    state.done++;
    state.sources.push({
      id: s.id, title: s.title || s.id, kind: s.kind,
      status: target.status || 'done', imported: target.imported || 0,
      skipped: target.skipped || 0, scanned: target.scanned || 0,
      error: target.error || null, note: target.note || '',
    });
    await new Promise(r => setTimeout(r, 300));
  }

  state.running = false;
  state.finishedAt = Date.now();
  state.current = '';
  try {
    const d = store.open();
    const rows = d.prepare('SELECT id, text, category, channel, date, value, url FROM posts WHERE id > ? AND value >= 7 AND is_rep = 1 ORDER BY value DESC LIMIT 20').all(idBefore);
    state.highlights = rows.map(r => ({
      id: Number(r.id), category: r.category, channel: r.channel, date: r.date,
      value: Number(r.value) || 0, title: String(r.text || '').split('\n')[0].slice(0, 90),
    }));
  } catch (e) { state.highlights = []; }

  try {
    const d = store.open();
    const today = new Date().toISOString().slice(0, 10);
    d.prepare("INSERT OR REPLACE INTO job_runs(job_key,run_date,status,started_at,finished_at,detail) VALUES('manual_sync',?,?,?,?,?)").run(
      today, 'done', new Date(state.startedAt).toISOString(), new Date(state.finishedAt).toISOString(),
      JSON.stringify({ imported: state.imported, scanned: state.scanned, sources: sources.length }),
    );
  } catch (e) {}

  const failedSources = state.sources.filter(s => s.status === 'failed').map(s => ({ id: s.id, error: s.error }));

  // 一键补齐完成后跑一次增量网盘扫描（纯本地、不联网）。失败不阻断同步结果。
  try {
    const netdisk = await import('./netdisk.mjs');
    netdisk.startScan('incremental');
  } catch (e) { /* 扫描失败不影响同步 */ }

  return {
    ok: true, imported: state.imported, skipped: state.skipped, scanned: state.scanned,
    sources: sources.length, failed: failedSources.length, failedSources,
    elapsed: state.finishedAt - state.startedAt, highlights: state.highlights,
  };
}

export function startFullSync(opts) {
  if (state.running) return { ok: false, error: '已有同步任务在进行中' };
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  runFullSync(opts).then(resolveCompletion, (e) => {
    state.running = false;
    state.error = String(e.message || e);
    state.finishedAt = Date.now();
    rejectCompletion(e);
  });
  return { ok: true, started: true, total: syncableSources().length, completion };
}
