// 本地日报：到点生成今日简报、弹 Windows 通知、存 app_state 供前端读取。
// 与 Telegram 解耦：不读不写 pushedIds；机器人不开也工作。
import * as bot from './bot.mjs';
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import * as sync from './sync.mjs';
import { toast } from './notify.mjs';

const LATEST_KEY = 'briefing:latest';
const LAST_DATE_KEY = 'briefing:lastDate';
const LAST_SYNC_KEY = 'briefing:lastSync';
const CHECK_MS = 5 * 60 * 1000;

// 本地日期（bot.mjs 的 lastPushDate 用 UTC 是历史遗留，新键不沿用）
function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function slim(it) {
  return {
    id: it.id, channel: it.channel, category: it.category, value: it.value, date: it.date,
    url: it.url, link: (it.links && it.links[0]) || '',
    text: String(it.text || '').replace(/\s+/g, ' ').slice(0, 240),
  };
}

export function getLatest() {
  const raw = store.getState(LATEST_KEY, '');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function previewSelection(filters) {
  const items = bot.selectDigestItems({ ...(filters || {}), candidateLimit: 80 });
  return { items: items.map(slim), count: items.length };
}

export async function generateSelection(filters, selectedIds, now) {
  const ids = [...new Set((Array.isArray(selectedIds) ? selectedIds : [])
    .filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 80);
  const allowed = new Set(bot.selectDigestItems({ ...(filters || {}), candidateLimit: 80 }).map(p => p.id));
  const chosen = new Set(ids.filter(id => allowed.has(id)));
  const items = store.getPostsByIds([...chosen])
    .filter(p => chosen.has(p.id))
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, Math.min(Number(filters && filters.pushLimit) || Number(bot.loadConfig().pushLimit) || 8, 80));
  const cfg = Object.assign({}, bot.loadConfig(), filters || {});
  const intro = items.length && cfg.aiDigest && ai.hasKey() ? await bot.digestSummary(items, cfg) : '';
  const t = now instanceof Date ? now : now == null ? new Date() : new Date(now);
  const data = { date: dateStr(t), generatedAt: t.getTime(), count: items.length, intro: intro, items: items.map(slim) };
  const body = intro || (items[0] ? ('[' + items[0].category + '·' + items[0].value + '分] ' + items[0].text) : '本次没有选择简报条目');
  await toast('筛选简报 · ' + items.length + ' 条', body);
  return data;
}

let generating = null;

export function generate(opts, now) {
  if (generating) return generating;
  generating = build(opts, now || new Date()).finally(() => { generating = null; });
  return generating;
}

async function build(opts, now) {
  const o = Object.assign({}, bot.loadConfig(), opts || {});
  const items = bot.selectDigestItems(o).slice(0, o.pushLimit || 8);
  let intro = '';
  if (items.length && o.aiDigest && ai.hasKey()) intro = await bot.digestSummary(items, o);
  const data = { date: dateStr(now), generatedAt: now.getTime(), count: items.length, intro: intro, items: items.map(slim) };
  store.setState(LATEST_KEY, JSON.stringify(data));
  store.setState(LAST_DATE_KEY, data.date);
  const body = intro || (items[0] ? ('[' + items[0].category + '·' + items[0].value + '分] ' + items[0].text) : '今天没有新的高分条目');
  await toast('今日简报 · ' + items.length + ' 条精选', body);
  return data;
}

export async function generateIfDue(now, opts) {
  const t = now || new Date();
  const cfg = Object.assign({}, bot.loadConfig(), opts || {});
  const hour = Number(cfg.pushHour == null ? 9 : cfg.pushHour);
  const today = dateStr(t);
  if (store.getState(LAST_DATE_KEY, '') === today) return { skipped: 'already', date: today };
  if (t.getHours() < hour) return { skipped: 'before-hour', hour: hour };
  if (cfg.syncReady === false) return { skipped: 'sync-pending' };
  if (cfg.syncBeforeGenerate === true) {
    if (sync.isRunning()) return { skipped: 'sync-pending' };
    const last = sync.getSyncStatus().lastSync;
    if (!last || last.date !== today) {
      const started = sync.startFullSync({ by: '日报前自动同步', maxMessages: cfg.syncMaxMessages || 2000 });
      if (!started || !started.started || !started.completion) return { skipped: 'sync-start-failed', error: started && started.error || '无法启动同步' };
      let syncResult;
      try { syncResult = await started.completion; }
      catch (e) { return { skipped: 'sync-failed', error: String(e.message || e) }; }
      if (!syncResult || !syncResult.ok) return { skipped: 'sync-failed', error: syncResult && syncResult.error || '同步失败' };
      return { generated: await generate(opts, t), sync: syncResult };
    }
  }
  return { generated: await generate(opts, t) };
}

let timer = null;
let startupTimer = null;
function check() {
  generateIfDue().catch(e => console.error('[briefing] 自动生成失败：', String(e.message || e)));
}
export function start() {
  if (timer) return { started: false, reason: '已在运行' };
  timer = setInterval(check, CHECK_MS);
  startupTimer = setTimeout(() => { startupTimer = null; check(); }, 5000);
  return { started: true };
}
export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  return { stopped: true };
}
