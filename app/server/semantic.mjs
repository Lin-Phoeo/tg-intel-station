// 语义检索：用向量模型把帖子转成向量，查询时按余弦相似度排序。
//
// 范围取舍：只给价值分达标的帖子建索引（默认 value >= 4，约 12 万条）。
// 全量 87 万条向量的存储与算力都不划算，而低分内容本来也不值得语义召回。
import * as ai from './ai.mjs';
import * as store from './store.mjs';
import { normalize, quantizeInt8, normInt8, toBuffer, topK } from '../../core/vector.mjs';

// 阶段：让界面能说清楚「现在在干嘛、走到哪一步」
export const STAGES = [
  { key: 'preparing', label: '准备' },
  { key: 'loading', label: '载入模型' },
  { key: 'embedding', label: '向量化' },
  { key: 'finalizing', label: '收尾' },
];

let state = {
  running: false, done: 0, total: 0, failed: 0,
  startedAt: null, finishedAt: null, error: null, model: '', dim: 0,
  stage: '', stageText: '', current: '', rate: 0, eta: 0, batches: 0,
};

// 滑动窗口算实时速率：只保留最近 20 批
const rateWin = [];
function pushRate(done, at) {
  rateWin.push({ done: done, at: at });
  while (rateWin.length > 20) rateWin.shift();
  if (rateWin.length < 2) return;
  const a = rateWin[0], b = rateWin[rateWin.length - 1];
  const dt = (b.at - a.at) / 1000;
  if (dt <= 0) return;
  const per = (b.done - a.done) / dt;          // 条/秒
  state.rate = +per.toFixed(2);
  state.eta = per > 0 ? Math.round((state.total - state.done) / per) : 0;
}

function setStage(key, text) {
  state.stage = key;
  state.stageText = text || '';
}

let vecCache = null;   // { at, items }

export function getStatus() {
  const elapsed = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
  return Object.assign({}, state, {
    stats: store.embedStats(),
    cached: vecCache ? vecCache.items.length : 0,
    stages: STAGES,
    elapsed: elapsed,
    // 前端直接可用，不必自己算
    etaSec: state.running ? state.eta : 0,
    finishAt: state.running && state.eta ? Date.now() + state.eta * 1000 : 0,
  });
}

function invalidate() { vecCache = null; }

// 向量集合常驻内存：12 万条 int8 约 120MB，每次查询都从库里读太慢
function loadVectors() {
  if (vecCache) return vecCache.items;
  const items = store.loadEmbeddings();
  vecCache = { at: Date.now(), items: items };
  return items;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 分批把帖子送去向量化。可反复调用，会跳过已索引的。
export async function buildIndex(opts) {
  if (state.running) return { ok: false, error: '已有向量化任务在进行中' };
  const o = opts || {};
  const minValue = o.minValue == null ? 4 : o.minValue;
  // 默认 16：实测远程向量接口在批次 32 时会超时，16 稳定且总耗时相近
  const batch = Math.max(1, Math.min(128, Number(o.batch || 16)));
  // 截断长度：模型上下文约 512 token（中文约 768 字），取 512 字几乎不丢信息，
  // 但能把单条耗时从 45ms 压到 35ms（13 万条少跑 25 分钟）。
  const maxChars = Math.max(64, Math.min(2000, Number(o.maxChars || 512)));
  const maxBatches = Number(o.maxBatches || 0);   // 0 表示不限

  const stats = store.embedStats();
  const todo = Math.max(0, stats.eligible - stats.indexed);
  rateWin.length = 0;
  state = {
    running: true, done: 0, total: todo, failed: 0,
    startedAt: Date.now(), finishedAt: null, error: null,
    model: stats.model || '', dim: stats.dim || 0,
    stage: '', stageText: '', current: '', rate: 0, eta: 0, batches: 0,
  };
  setStage('preparing', todo > 0 ? ('待处理 ' + todo.toLocaleString() + ' 条') : '检查待处理数量');

  if (todo === 0) {
    state.running = false; state.finishedAt = Date.now();
    return { ok: true, skipped: true, reason: '所有达标帖子都已建立向量' };
  }

  // 记录已有向量的模型与维度，用于第一批算完后做一致性校验
  const existingModel = stats.model || '';
  const existingDim = stats.dim || 0;

  let batches = 0;
  try {
    while (maxBatches === 0 || batches < maxBatches) {
      setStage('preparing', '取出下一批待处理内容');
      const rows = store.postsNeedingEmbedding(batch, minValue);
      if (!rows.length) break;

      // 第一条的内容作为「现在正在处理什么」的样本，让进度看得见摸得着
      state.current = String(rows[0].text || '').replace(/\s+/g, ' ').slice(0, 56);
      state.batches = batches + 1;
      setStage(batches === 0 ? 'loading' : 'embedding',
        batches === 0 ? '首次调用向量服务（本机模型需先载入）' : ('第 ' + (batches + 1) + ' 批 · 每批 ' + batch + ' 条'));

      let r;
      try {
        r = await ai.embed(rows.map(x => String(x.text).slice(0, maxChars)));
      } catch (e) {
        state.error = String(e.message || e);
        state.detail = e.detail || null;
        break;
      }
      if (!r || !r.vectors || r.vectors.length !== rows.length) {
        state.error = '向量服务返回条数与请求不一致';
        break;
      }
      state.model = r.model;
      // 防呆：与已有向量的模型/维度不一致时立即中止。
      // 混用会让大部分向量因维度不符被 topK 静默跳过，表现成「检索结果莫名变少」。
      if (existingModel && r.model && r.model !== existingModel) {
        state.error = '已有 ' + stats.indexed + ' 条向量是用「' + existingModel + '」建的，' +
          '当前配置解析到的是「' + r.model + '」。两者不能混用，请先清空索引再重建。';
        break;
      }
      if (existingDim && r.vectors[0] && r.vectors[0].length !== existingDim) {
        state.error = '已有向量的维度是 ' + existingDim + '，本次是 ' + r.vectors[0].length + '，无法混用。请先清空索引。';
        break;
      }
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const v = r.vectors[i];
        if (!v || !v.length) { state.failed++; continue; }
        const q = quantizeInt8(normalize(v));
        out.push({ id: rows[i].id, vec: toBuffer(q), dim: q.length, norm: normInt8(q), model: r.model });
      }
      state.dim = out.length ? out[0].dim : state.dim;
      store.saveEmbeddings(out);
      state.done += out.length;
      batches++;
      pushRate(state.done, Date.now());
      invalidate();
      await sleep(60);
    }
  } catch (e) {
    state.error = String(e.message || e);
  }

  setStage('done', state.error ? '已中断' : '全部完成');
  state.running = false;
  state.finishedAt = Date.now();
  state.rate = 0;
  state.current = '';
  return {
    ok: !state.error, done: state.done, failed: state.failed,
    model: state.model, dim: state.dim, error: state.error || null, detail: state.detail || null,
  };
}

export function startBuild(opts) {
  if (state.running) return { ok: false, error: '已有向量化任务在进行中' };
  buildIndex(opts).catch(e => { state.running = false; state.error = String(e.message || e); state.finishedAt = Date.now(); });
  return { ok: true, started: true, stats: store.embedStats() };
}

// 语义检索：把查询向量化，与库内向量做余弦比对。
// 注意这是「字面之外」的召回——搜「怎么白嫖服务器」也能命中讲 VPS 优惠的帖子。
export async function semanticSearch(query, k) {
  const items = loadVectors();
  if (!items.length) return { ok: false, error: '还没有建立向量索引', items: [] };
  let r;
  try { r = await ai.embed([String(query).slice(0, 2000)]); }
  catch (e) { return { ok: false, error: String(e.message || e), items: [] }; }
  const q = quantizeInt8(normalize(r.vectors[0]));
  const qn = normInt8(q);
  const hits = topK(q, qn, items, k || 200);
  const posts = store.getPostsByIds(hits.map(h => h.id));
  const byId = {};
  for (const p of posts) byId[p.id] = p;
  const out = [];
  for (const h of hits) {
    const p = byId[h.id];
    if (p) out.push(Object.assign({ score: +h.score.toFixed(4) }, p));
  }
  return { ok: true, model: r.model, dim: q.length, count: out.length, items: out };
}

// 带重排的语义检索：先用向量粗排召回一批，再用 cross-encoder 精排。
// 粗排负责「找得到」，精排负责「排得准」，合起来比单用向量明显更准。
export async function rerankedSearch(query, k, recall) {
  const base = await semanticSearch(query, Math.max(Number(recall || 60), Number(k || 30)));
  if (!base.ok || !base.items.length) return base;
  let rr;
  try {
    rr = await ai.rerank(query, base.items.map(p => String(p.text).slice(0, 1200)));
  } catch (e) {
    // 重排不可用时退回纯向量结果，而不是整体失败
    return Object.assign({}, base, {
      items: base.items.slice(0, k || 30),
      rerankError: String(e.message || e),
      rerankDetail: e.detail || null,
    });
  }
  const out = [];
  for (const h of rr.results) {
    const p = base.items[h.index];
    if (p) out.push(Object.assign({ rerankScore: h.score }, p));
  }
  return { ok: true, model: base.model, rerankModel: rr.model, count: out.length, items: out.slice(0, k || 30) };
}

export function clearIndex() { store.clearEmbeddings(); invalidate(); return true; }
