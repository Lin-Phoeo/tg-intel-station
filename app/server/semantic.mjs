// 语义检索：用向量模型把帖子转成向量，查询时按余弦相似度排序。
//
// 范围取舍：只给价值分达标的帖子建索引（默认 value >= 4，约 12 万条）。
// 全量 87 万条向量的存储与算力都不划算，而低分内容本来也不值得语义召回。
import * as ai from './ai.mjs';
import * as store from './store.mjs';
import { normalize, quantizeInt8, normInt8, toBuffer, topK } from '../../core/vector.mjs';

let state = {
  running: false, done: 0, total: 0, failed: 0,
  startedAt: null, finishedAt: null, error: null, model: '', dim: 0,
};

let vecCache = null;   // { at, items }

export function getStatus() {
  return Object.assign({}, state, { stats: store.embedStats(), cached: vecCache ? vecCache.items.length : 0 });
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
  const batch = Math.max(1, Math.min(64, Number(o.batch || 32)));
  const maxBatches = Number(o.maxBatches || 0);   // 0 表示不限

  const stats = store.embedStats();
  const todo = Math.max(0, stats.eligible - stats.indexed);
  state = {
    running: true, done: 0, total: todo, failed: 0,
    startedAt: Date.now(), finishedAt: null, error: null,
    model: stats.model || '', dim: stats.dim || 0,
  };

  if (todo === 0) {
    state.running = false; state.finishedAt = Date.now();
    return { ok: true, skipped: true, reason: '所有达标帖子都已建立向量' };
  }

  let batches = 0;
  try {
    while (maxBatches === 0 || batches < maxBatches) {
      const rows = store.postsNeedingEmbedding(batch, minValue);
      if (!rows.length) break;
      let r;
      try {
        r = await ai.embed(rows.map(x => String(x.text).slice(0, 2000)));
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
      invalidate();
      await sleep(60);
    }
  } catch (e) {
    state.error = String(e.message || e);
  }

  state.running = false;
  state.finishedAt = Date.now();
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
