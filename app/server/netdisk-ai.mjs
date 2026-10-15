// 网盘资源 AI 整理：归类、打标签、写简介、规范标题。
// 复刻 ai-classify.mjs 的范式：定长行输出、坏行跳过、可停、可续跑。
import * as store from './store.mjs';
import * as ai from './ai.mjs';

export const ND_CATS = ['软件工具', '教程课程', '影视', '音乐', '游戏', '电子书', '素材模板', '系统镜像', '办公文档', '其他'];
const BATCH = 15;

let state = { running: false, done: 0, total: 0, failed: 0, skipped: 0, current: '', startedAt: null, finishedAt: null, error: null, stop: false };

export function getStatus() { return Object.assign({}, state, { pending: store.netdiskPendingCount() }); }
export function requestStop() { state.stop = true; return true; }

export function buildPrompt(rows) {
  const lines = [];
  lines.push('你在整理网盘资源清单。下面每条给出资源名和原帖片段，请判断它是什么。');
  lines.push('');
  lines.push('可选类别（必须从这里选）：' + ND_CATS.join(' / '));
  lines.push('');
  lines.push('每条输出一行，格式固定为：');
  lines.push('序号|类别|标签(逗号分隔,最多3个)|一句话简介(不超过30字)|规范标题(不超过30字)');
  lines.push('');
  lines.push('除了这些行不要输出任何其它内容。');
  lines.push('');
  lines.push('=== 资源 ===');
  rows.forEach((r, i) => {
    const t = String(r.text || '').replace(/\s+/g, ' ').slice(0, 200);
    lines.push((i + 1) + '. ' + (r.title || '') + ' ｜ ' + t);
  });
  return lines.join('\n');
}

export function parseAnswer(text, rows) {
  const byIndex = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[|｜]\s*([^|｜]+?)\s*[|｜]\s*([^|｜]*?)\s*[|｜]\s*([^|｜]*?)\s*[|｜]\s*(.*)$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= rows.length) continue;
    let cat = String(m[2]).trim();
    if (ND_CATS.indexOf(cat) < 0) {
      const hit = ND_CATS.find(k => cat.indexOf(k) >= 0 || k.indexOf(cat) >= 0);
      cat = hit || '其他';
    }
    byIndex[idx] = {
      id: rows[idx].id, category: cat,
      tags: String(m[3]).trim().slice(0, 60),
      summary: String(m[4]).trim().slice(0, 60),
      aiTitle: String(m[5] || '').trim().slice(0, 60),
    };
  }
  const out = [];
  for (let i = 0; i < rows.length; i++) if (byIndex[i]) out.push(byIndex[i]);
  return out;
}

export async function runOrganize(opts) {
  if (state.running) return { ok: false, error: '已有整理任务在进行中' };
  const o = opts || {};
  const limit = Number(o.limit || 0);
  const total = store.netdiskPendingCount();
  const target = limit > 0 ? Math.min(limit, total) : total;
  if (!target) return { ok: false, error: '没有待整理的网盘条目' };

  state = { running: true, done: 0, total: target, failed: 0, skipped: 0, current: '', startedAt: Date.now(), finishedAt: null, error: null, stop: false };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    while (state.done + state.failed + state.skipped < target) {
      if (state.stop) break;
      const want = Math.min(BATCH, target - state.done - state.failed - state.skipped);
      const rows = store.netdiskPending(want);
      if (!rows.length) break;
      state.current = String(rows[0].title || '').slice(0, 40);
      let answer = '';
      try {
        answer = await ai.completeLLM([
          { role: 'system', content: '你只输出规定格式的行，不输出任何其它内容。' },
          { role: 'user', content: buildPrompt(rows) },
        ], o.profileId || undefined);
      } catch (e) {
        state.failed += rows.length;
        state.error = String(e.message || e).slice(0, 200);
        if (state.failed >= BATCH * 3) break;
        await sleep(1200);
        continue;
      }
      const parsed = parseAnswer(answer, rows);
      if (parsed.length) { store.netdiskSaveAi(parsed); state.done += parsed.length; }
      // 整批解析不出来时批次不会变化，必须把它计为已处理，否则会原地无限空转
      if (parsed.length < rows.length) state.skipped += rows.length - parsed.length;
      await sleep(120);
    }
  } catch (e) { state.error = String(e.message || e).slice(0, 300); }

  state.running = false; state.finishedAt = Date.now(); state.current = '';
  return { ok: !state.error, done: state.done, failed: state.failed, skipped: state.skipped, error: state.error || null };
}

export function startOrganize(opts) {
  if (state.running) return { ok: false, error: '已有整理任务在进行中' };
  if (!ai.hasKey()) return { ok: false, error: '还没配置 AI 模型' };
  runOrganize(opts).catch(e => { state.running = false; state.error = String(e.message || e); state.finishedAt = Date.now(); });
  return { ok: true, started: true, total: Number((opts && opts.limit) || 0) || store.netdiskPendingCount() };
}
