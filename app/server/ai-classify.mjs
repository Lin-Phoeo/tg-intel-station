// AI 辅助分类与价值评估。
//
// 规则分类器是关键词打分：多类目得分接近时会选错，而且看不出「这条到底有没有用」。
// 价值分也只是「类目基础分 + 标签加成 + 浏览量」的粗估。
// 这两件事交给模型判断准得多，但 90 万条全跑不现实 —— 所以这个模块的重点是
// 「限定范围 + 可续跑 + 随时可停 + 能整体回滚」。
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import { CATS } from '../../core/classify.mjs';

const CAT_KEYS = CATS.map(c => c.key).concat(['其他']);
// 每批交给模型多少条。
// 单次调用的延迟基本固定（实测最简请求也要 70 秒以上），
// 所以批量越大、摊到每条上的时间越少 —— 但太大模型容易漏行，20 是稳妥值。
const BATCH = 20;

let state = {
  running: false, done: 0, total: 0, failed: 0, skipped: 0,
  startedAt: null, finishedAt: null, current: '', rate: 0, eta: 0,
  model: '', error: null, scope: null, stop: false,
};

const rateWin = [];
function pushRate(done, at) {
  rateWin.push({ done: done, at: at });
  while (rateWin.length > 10) rateWin.shift();
  if (rateWin.length < 2) return 0;
  const a = rateWin[0], b = rateWin[rateWin.length - 1];
  const dt = (b.at - a.at) / 1000;
  if (dt <= 0) return 0;
  const r = (b.done - a.done) / dt;
  state.rate = +r.toFixed(2);
  const left = state.total - done;
  state.eta = r > 0 ? Math.floor(left / r) : 0;
  return r;
}

export function getStatus() {
  return {
    running: state.running, done: state.done, total: state.total, failed: state.failed,
    current: state.current, rate: state.rate, etaSec: state.running ? state.eta : 0,
    startedAt: state.startedAt, finishedAt: state.finishedAt,
    elapsed: state.startedAt ? Math.floor(((state.finishedAt || Date.now()) - state.startedAt) / 1000) : 0,
    model: state.model, error: state.error, scope: state.scope,
    labeled: store.aiLabelStats().labeled,
    finishAt: state.running && state.eta ? Date.now() + state.eta * 1000 : 0,
  };
}

// 让模型按「序号|类目|分值|理由」逐行输出。
// 试过让它返回 JSON 数组：偶尔会多一层包裹、少一个逗号、或者把中文引号打成英文，
// 一旦解析失败整批就白跑了。定长分隔的行格式容错高得多 —— 坏行跳过即可，不影响其它行。
function buildPrompt(posts) {
  const lines = [];
  lines.push('你是内容分类与价值评估器。下面有多条 Telegram 帖子，请逐条判断。');
  lines.push('');
  lines.push('可选类目（必须从这里选，不要新造）：' + CAT_KEYS.join(' / '));
  lines.push('');
  lines.push('价值分 0-10，标准是「对想找项目、工具、优惠的技术人有多有用」：');
  lines.push('8-10 能直接用的项目/工具/优惠，信息完整、带链接');
  lines.push('5-7  有用但不完整，或者需要自己折腾');
  lines.push('2-4  有点信息量，但偏资讯、讨论、提问');
  lines.push('0-1  闲聊、纯转发、广告、没有实质内容');
  lines.push('');
  lines.push('每条输出一行，格式固定为：');
  lines.push('序号|类目|价值分|理由（不超过 12 字）');
  lines.push('');
  lines.push('除了这些行，不要输出任何其它内容（不要标题、不要解释、不要代码块）。');
  lines.push('');
  lines.push('=== 帖子 ===');
  posts.forEach((p, i) => {
    const t = String(p.text || '').replace(/\s+/g, ' ').slice(0, 380);
    lines.push((i + 1) + '. ' + t);
  });
  return lines.join('\n');
}

// 解析模型输出。坏行直接跳过，不让一行毁掉整批。
function parseAnswer(text, posts) {
  const out = [];
  const byIndex = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*[|｜]\s*([^|｜]+?)\s*[|｜]\s*(-?[\d.]+)\s*(?:[|｜]\s*(.*))?$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= posts.length) continue;
    let cat = String(m[2]).trim();
    // 模型偶尔会写成「羊毛优惠类」或带空格，做个归一
    if (CAT_KEYS.indexOf(cat) < 0) {
      const hit = CAT_KEYS.find(k => cat.indexOf(k) >= 0 || k.indexOf(cat) >= 0);
      cat = hit || '其他';
    }
    let v = Number(m[3]);
    if (!isFinite(v)) v = 0;
    v = Math.max(0, Math.min(10, v));
    byIndex[idx] = { category: cat, value: +v.toFixed(1), reason: String(m[4] || '').trim().slice(0, 20) };
  }
  for (let i = 0; i < posts.length; i++) {
    const r = byIndex[i];
    if (r) out.push({ id: posts[i].id, category: r.category, value: r.value, reason: r.reason, orig_category: posts[i].category, orig_value: posts[i].value });
  }
  return out;
}

// 分类专用的服务商。没单独指定就沿用当前对话的服务商。
export function classifyProfileId() {
  try { return store.getState('classifyProfileId', '') || ''; } catch (e) { return ''; }
}

export function requestStop() { state.stop = true; return true; }

export async function runClassify(opts) {
  if (state.running) return { ok: false, error: '已有标注任务在进行中' };
  const o = opts || {};
  const scope = o.scope || { scope: 'other' };
  const limit = Number(o.limit || 0);          // 0 表示不限量

  const total = store.countAiCandidates(scope);
  const target = limit > 0 ? Math.min(limit, total) : total;
  if (!target) return { ok: false, error: '该范围内没有待标注的帖子' };

  state = {
    running: true, done: 0, total: target, failed: 0, skipped: 0,
    startedAt: Date.now(), finishedAt: null, current: '', rate: 0, eta: 0,
    model: '', error: null, scope: scope, stop: false,
  };
  rateWin.length = 0;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    while (state.done + state.failed < target) {
      if (state.stop) break;
      const want = Math.min(BATCH, target - state.done - state.failed);
      const posts = store.nextAiBatch(scope, want);
      if (!posts.length) break;

      state.current = String(posts[0].text || '').replace(/\s+/g, ' ').slice(0, 60);
      let answer = '';
      try {
        answer = await ai.completeLLM([
          { role: 'system', content: '你只输出规定格式的行，不输出任何其它内容。' },
          { role: 'user', content: buildPrompt(posts) },
        ], (o && o.profileId) || classifyProfileId());
      } catch (e) {
        state.failed += posts.length;
        state.error = String(e.message || e).slice(0, 200);
        // 连续失败说明是配置层面的问题（密钥、模型、地址），没必要继续硬跑
        if (state.failed >= BATCH * 3) break;
        await sleep(1200);
        continue;
      }

      const parsed = parseAnswer(answer, posts);
      if (parsed.length) {
        for (const r of parsed) r.model = state.model || '';
        store.saveAiLabels(parsed);
        state.done += parsed.length;
      }
      const missed = posts.length - parsed.length;
      if (missed > 0) state.skipped += missed;
      pushRate(state.done, Date.now());
      await sleep(120);   // 给别的请求留点余地，也避免打太狠被限流
    }
  } catch (e) {
    state.error = String(e.message || e).slice(0, 300);
  }

  state.running = false;
  state.finishedAt = Date.now();
  state.current = '';
  state.rate = 0;
  return { ok: !state.error, done: state.done, failed: state.failed, skipped: state.skipped, error: state.error || null };
}

export function startClassify(opts) {
  if (state.running) return { ok: false, error: '已有标注任务在进行中' };
  const scope = (opts && opts.scope) || { scope: 'other' };
  const total = store.countAiCandidates(scope);
  const limit = Number((opts && opts.limit) || 0);
  runClassify(opts).catch(e => {
    state.running = false;
    state.error = String(e.message || e);
    state.finishedAt = Date.now();
  });
  const p = ai.activeProfile();
  state.model = (p && p.model) || '';
  return { ok: true, started: true, total: limit > 0 ? Math.min(limit, total) : total };
}

export function preview(scope, n) {
  const rows = store.nextAiBatch(scope, Number(n || 5));
  return rows.map(r => ({ id: r.id, category: r.category, value: r.value, text: r.text.replace(/\s+/g, ' ').slice(0, 90) }));
}
