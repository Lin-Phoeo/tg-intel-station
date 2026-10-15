// 检索编排：关键词 + 向量双路召回，用 RRF 融合。
//
// 参考 Cormack et al. 2009 以及主流实践（Azure AI Search、Chroma、MongoDB
// 的混合检索都默认用 RRF）：
//
//   · 稠密（向量）与稀疏（BM25/关键词）的失效方式互补 ——
//     向量强在改述与同义，弱在生僻专名；关键词反之。
//   · 收益来自「两者不一致」时各自补上对方漏掉的那一半。
//   · **融合必须用排名而不是分数**：BM25 分数无上界、余弦在 [-1,1]，
//     两者尺度不可比，任何直接加权都会让一方悄然主导。
//     RRF 只看名次：score = Σ 1/(k + rank)，k 取经典值 60，无需调参。
//
// 此前 retrieve() 只走关键词分支，14 万条向量在 RAG 里完全没被用上。
import * as ai from './ai.mjs';
import * as store from './store.mjs';
import * as semantic from './semantic.mjs';

// RRF 的经典常数（Cormack 2009）。论文与各家实现都用 60。
const RRF_K = 60;

// 时效型查询（含「本周 / 最新」等意图）才启用日期衰减。
// 门控是关键：全局套衰减会打烂普通查询（旧但正解的帖会被压掉）。
// 只有查询本身在问「最近 / 本周」时，才让新鲜度参与排序。
const TEMPORAL_RE = /本周|这周|本月|这个月|今天|今日|昨天|最新|最近|近期|近日|这几天|当下|当前|现在|实时/;
// 半衰期（天）：情报/限免帖时效性强，取两周量级。age=h 时权重减半。
const RECENCY_HALF_LIFE_DAYS = 10;
// 时效查询扩大召回池：正解可能语义分不高、靠「最新」才该顶上来，
// 普通 FANOUT(40) 根本捞不到它（实测 Epic 本周帖在向量第 130 名）。
const TEMPORAL_FANOUT = 240;

function isTemporalQuery(q) {
  return TEMPORAL_RE.test(String(q || ''));
}

// 指数半衰期衰减：final = sc × 2^(-age/h)。未来时间戳取中性 1.0。
function recencyDecay(dateStr, now) {
  if (!dateStr) return 1;
  const t = Date.parse(String(dateStr) + 'T00:00:00');
  if (isNaN(t)) return 1;
  const age = Math.max(0, (now - t) / 86400000);
  return Math.pow(2, -age / RECENCY_HALF_LIFE_DAYS);
}

// 用排名做融合。传入若干「已按相关度排好序」的列表，返回融合后的 id 顺序。
export function rrf(lists) {
  const score = new Map();
  for (const list of lists) {
    if (!list || !list.length) continue;
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id != null ? list[i].id : list[i];
      score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1));
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(e => ({ id: e[0], sc: e[1] }));
}

// 关键词分支：沿用原来的多路召回（整句 / 分词 / n-gram），带特异性加权。
function keywordRank(question, filters, limit) {
  filters = Object.assign({}, filters, { page: 1 });
  const seen = new Map();
  const hits = new Map();
  const push = (items, weight, key) => {
    for (const it of items) {
      const prev = seen.get(it.id);
      const tags = it.tags || [];
      let sc = (weight || 1) * (1 + (it.value || 0) / 4);
      if (it.date && it.date > '2026-04') sc *= 1.18;
      if (tags.includes('免费') || tags.includes('限时')) sc *= 1.3;
      if ((it.links || []).length) sc *= 1.15;
      if (tags.includes('风险')) sc *= 0.5;
      if (/求推荐|求助|请问|怎么弄|有没有人|吗？|\?$/.test(String(it.text || '').slice(0, 80))) sc *= 0.6;
      if (String(it.text || '').length < 45) sc *= 0.55;
      if (!prev || sc > prev.sc) seen.set(it.id, { post: it, sc: sc });
      if (key) {
        let s = hits.get(it.id);
        if (!s) { s = new Set(); hits.set(it.id, s); }
        s.add(key);
      }
    }
  };

  const q = String(question || '').trim();
  const whole = q.replace(/[?？。，,！!]/g, ' ').trim();
  if ([...whole].length >= 3) {
    try { push(store.search(Object.assign({}, filters, { q: whole, size: 12, sort: 'relevance', count: false })).items, 1.4, 'whole'); } catch (e) {}
  }
  const topic = ai.stripQuestionPatterns(q) || q;
  const terms = store.splitTerms(topic).filter(t => [...t].length >= 2 && !ai.isStop(t));
  for (const t of terms.slice(0, 6)) {
    try {
      const r = store.search(Object.assign({}, filters, { q: t, size: 8, sort: 'relevance' }));
      let w = 1.0;
      const total = Number(r.total || 0);
      if (total > 200) w *= 1 / (1 + Math.log10(total / 200) * 0.8);
      push(r.items, w, 't:' + t);
    } catch (e) {}
  }
  const cjk = topic.match(/[\u4e00-\u9fa5]{3,}/g) || [];
  const frags = [];
  for (const run of cjk) for (const f of ai.cjkFragments(run)) if (frags.indexOf(f) < 0) frags.push(f);
  frags.sort((a, b) => b.length - a.length);
  for (const frag of frags.slice(0, 10)) {
    let w = frag.length >= 4 ? 0.9 : (frag.length === 3 ? 0.8 : 0.6);
    try {
      const r = store.search(Object.assign({}, filters, { q: frag, size: 6, sort: 'relevance' }));
      const total = Number(r.total || 0);
      if (total > 200) w *= 1 / (1 + Math.log10(total / 200) * 0.8);
      push(r.items, w, 'f:' + frag);
    } catch (e) {}
  }
  if (!seen.size) {
    try { push(store.search(Object.assign({}, filters, { q: '', size: 6, sort: 'value', count: false })).items, 0.15, 'fallback'); } catch (e) {}
  }
  const scored = [...seen.values()].map(x => {
    const n = (hits.get(x.post.id) || new Set()).size;
    return { post: x.post, sc: x.sc * (1 + 0.7 * Math.max(0, n - 1)) };
  });
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, limit || 40).map(x => x.post);
}

// 向量分支：把查询向量化后与库内向量比余弦。没有索引或嵌入失败就当空分支，
// 由 RRF 自然退化成纯关键词检索 —— 不会让整个问答挂掉。
async function vectorRank(question, filters, limit) {
  try {
    const r = await semantic.semanticSearch(question, limit || 40);
    if (!r || !r.ok || !r.items || !r.items.length) return [];
    const allowed = new Set(store.filterPostIds(r.items.map(p => p.id), filters));
    return r.items.filter(p => allowed.has(p.id));
  } catch (e) { return []; }
}

// 交给重排器精排的候选条数。太少则召回里靠后的正解没机会翻身，
// 太多则重排请求变大、变慢（Gitee 单次上限 25 条，内部会分批）。
const RERANK_N = 30;

// 重排阶段的硬性预算。超时就直接用融合顺序。
// 检索必须保证「有界延迟」—— 一个可选阶段的抖动不该让用户干等。
// 实测正常重排约 450ms，3.5 秒留足余量，又能在对方抽风时及时止损。
const RERANK_BUDGET_MS = 3500;

// 用 cross-encoder 对候选精排。失败就返回 null，调用方退回融合顺序 ——
// 重排是「锦上添花」，不该因为它挂了就让整个问答不可用。
//
// 关键是外面那层 Promise.race：不是「等它失败」，而是「到点就走」。
// 之前重排单次超时 60 秒、重试 2 次，加上分批并发，
// 一次查询最坏能卡 3 分钟 —— 实测确实把整条链路挂住过。
async function rerankIds(question, ids) {
  if (!ids.length) return null;
  return await Promise.race([
    rerankOnce(question, ids),
    new Promise((resolve) => setTimeout(() => resolve(null), RERANK_BUDGET_MS)),
  ]);
}

async function rerankOnce(question, ids) {
  try {
    const posts = store.getPostsByIds(ids);
    const byId = {};
    for (const p of posts) byId[p.id] = p;
    const ordered = ids.map(id => byId[id]).filter(Boolean);
    if (ordered.length < 2) return null;
    const r = await ai.rerank(question, ordered.map(p => String(p.text || '').slice(0, 1200)));
    if (!r || !r.results || !r.results.length) return null;
    return r.results.map(h => ordered[h.index]).filter(Boolean).map(p => p.id);
  } catch (e) { return null; }
}

// 混合检索主入口：关键词 + 向量双路召回 → RRF 融合 → cross-encoder 精排。
//
// 三段各司其职：
//   召回  —— 两路互补，谁也别漏（实测混合把 MRR 从 0.466 提到 0.547）
//   融合  —— RRF 只看名次，避开分数尺度不可比的问题
//   精排  —— cross-encoder 逐条读 query+doc，把真正贴题的顶上来
//              （实测再加这一段，MRR 0.547 → 0.606，命中率 63% → 69%）
export async function retrieve(question, filters, topK, opts) {
  const want = topK || 14;
  const temporal = isTemporalQuery(question);
  const FANOUT = temporal ? TEMPORAL_FANOUT : Math.max(40, want * 3);
  const kw = keywordRank(question, filters, FANOUT);
  const vec = await vectorRank(question, filters, FANOUT);
  let fused = rrf([kw, vec]);
  if (!fused.length) return [];

  // 时效型查询：对融合分乘以日期衰减，让「本周/最新」的那条顶上来。
  // 只在门控命中时启用，普通查询完全不受影响。
  if (temporal) {
    const postById = new Map();
    for (const p of kw) postById.set(p.id, p);
    for (const p of vec) if (!postById.has(p.id)) postById.set(p.id, p);
    const now = Date.now();
    fused = fused
      .map(e => ({ id: e.id, sc: e.sc * recencyDecay((postById.get(e.id) || {}).date, now) }))
      .sort((a, b) => b.sc - a.sc);
  }

  let ids = fused.slice(0, want).map(x => x.id);

  // 重排默认**关闭**，这是测出来的结论，不是偷懒。
  //
  // 换成 Qwen3-Embedding-8B 之后，在 23 条评测集上比过四个重排器：
  //     不重排                Hit@10 19/23   MRR 0.656
  //     bge-reranker-v2-m3    19/23          0.656   92ms
  //     Qwen3-Reranker-8B     19/23          0.657   2595ms
  //     Qwen3-Reranker-4B     19/23          0.500   687ms
  //     Qwen3-Reranker-0.6B   19/23          0.573   385ms
  // 没有一个能提升命中率，三个反而拉低 MRR。
  // （用 bge-small 时重排还有 +6pt，说明**召回够强时重排的边际价值趋近于零**。）
  // 既然不带来质量收益，就没理由再付 450ms 延迟和一次外部依赖的可靠性风险。
  //
  // 需要时仍可显式打开：retrieve(q, f, k, { rerank: true })。
  if (opts && opts.rerank === true) {
    const pool = fused.slice(0, Math.max(RERANK_N, want)).map(x => x.id);
    const rr = await rerankIds(question, pool);
    if (rr && rr.length) ids = rr.slice(0, want);
  }

  const posts = store.getPostsByIds(ids);
  const byId = {};
  for (const p of posts) byId[p.id] = p;
  return ids.map(id => byId[id]).filter(Boolean);
}

// 诊断用：返回两路各自的排名，便于评测脚本对比。
export async function retrieveDetailed(question, filters, topK) {
  const FANOUT = Math.max(40, (topK || 14) * 3);
  const kw = keywordRank(question, filters, FANOUT);
  const vec = await vectorRank(question, filters, FANOUT);
  return { keyword: kw, vector: vec, fused: rrf([kw, vec]) };
}
