// 向量模型对比（修正版）：向量按下标对齐存放，任何一批失败都不会错位
import * as ai from './ai.mjs';
import { DatabaseSync } from 'node:sqlite';

const KEY = process.env.GITEE_KEY || '';
const SAMPLE = Number(process.env.SAMPLE || 1200);
const QUERIES = ['怎么白嫖服务器', '有没有便宜的国外主机', '不用信用卡就能注册的国外服务', '学生党怎么省钱买软件', 'AI 写代码哪个好用'];

const d = new DatabaseSync('app/data/intel.db', { readOnly: true });
const rows = d.prepare("SELECT id, text FROM posts WHERE value >= 5 AND LENGTH(text) >= 20 AND is_rep = 1 ORDER BY value DESC LIMIT ?").all(SAMPLE);
d.close();
const texts = rows.map(r => String(r.text).slice(0, 512));
console.log('样本 ' + texts.length + ' 条');

const norm = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
// 关键：按下标存放，缺失的留 null，绝不用 push
function rank(vecs, qv, k) {
  const out = [];
  for (let i = 0; i < vecs.length; i++) if (vecs[i]) out.push({ i: i, s: cos(qv, vecs[i]) });
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, k);
}

// ---- A. 本机 ----
console.log('');
console.log('=== A. 本机 Xenova/bge-small-zh-v1.5 ===');
const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = 'app/data/models';
const localPipe = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype: 'fp32' });
const localVecs = new Array(texts.length).fill(null);
let t0 = Date.now();
for (let i = 0; i < texts.length; i += 32) {
  const out = await localPipe(texts.slice(i, i + 32), { pooling: 'cls', normalize: true });
  const arr = out.tolist();
  for (let k = 0; k < arr.length; k++) localVecs[i + k] = norm(arr[k]);
}
const localOk = localVecs.filter(Boolean).length;
const localMs = Date.now() - t0;
console.log('  ' + localVecs[0].length + ' 维  ' + localOk + '/' + texts.length + ' 条成功  ' + (localMs / localOk).toFixed(0) + 'ms/条');
console.log('  13.2 万条预计 ' + (localMs / localOk * 132263 / 60000).toFixed(0) + ' 分钟，存储 ' + (132263 * localVecs[0].length / 1048576).toFixed(0) + ' MB');

// ---- B. 模力方舟 ----
console.log('');
console.log('=== B. 模力方舟 bge-m3 ===');
ai.saveSettings({ embedBaseUrl: 'https://ai.gitee.com/v1', embedModel: 'bge-m3', embedApiKey: KEY });
const giteeVecs = new Array(texts.length).fill(null);
const BATCH = 16;
let fails = 0;
t0 = Date.now();
let elapsed = 0;
for (let i = 0; i < texts.length; i += BATCH) {
  try {
    const r = await ai.embed(texts.slice(i, i + BATCH));
    for (let k = 0; k < r.vectors.length; k++) giteeVecs[i + k] = norm(r.vectors[k]);
  } catch (e) { fails += Math.min(BATCH, texts.length - i); }
  if (i % 320 === 0 && i > 0) {
    const ok = giteeVecs.filter(Boolean).length;
    elapsed = Date.now() - t0;
    console.log('  ... ' + i + '/' + texts.length + '  成功 ' + ok + '  失败 ' + fails + '  ' + (elapsed / Math.max(1, ok)).toFixed(0) + 'ms/条');
  }
}
const giteeOk = giteeVecs.filter(Boolean).length;
const giteeMs = Date.now() - t0;
const giteeDim = giteeVecs.find(Boolean).length;
console.log('  ' + giteeDim + ' 维  ' + giteeOk + '/' + texts.length + ' 条成功  失败 ' + fails);
if (giteeOk) {
  console.log('  平均 ' + (giteeMs / giteeOk).toFixed(0) + 'ms/条（含重试耗时）');
  console.log('  13.2 万条预计 ' + (giteeMs / giteeOk * 132263 / 60000).toFixed(0) + ' 分钟，存储 ' + (132263 * giteeDim / 1048576).toFixed(0) + ' MB');
}

// ---- C. 质量对比 ----
if (giteeOk > 100) {
  console.log('');
  console.log('='.repeat(80));
  console.log('检索质量对比（同样查询，各自余弦最高的 4 条）');
  console.log('='.repeat(80));
  for (const q of QUERIES) {
    const lq = await localPipe([q], { pooling: 'cls', normalize: true });
    const lqv = norm(lq.tolist()[0]);
    const gqv = norm((await ai.embed([q])).vectors[0]);
    const lr = rank(localVecs, lqv, 4);
    const gr = rank(giteeVecs, gqv, 4);
    console.log('');
    console.log('■ ' + q);
    console.log('  本机 bge-small:');
    for (const x of lr) console.log('    ' + x.s.toFixed(3) + '  ' + texts[x.i].replace(/\s+/g, ' ').slice(0, 62));
    console.log('  模力方舟 bge-m3:');
    for (const x of gr) console.log('    ' + x.s.toFixed(3) + '  ' + texts[x.i].replace(/\s+/g, ' ').slice(0, 62));
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Top-10 重合度 / 分数分布（分数越分散说明区分度越好）');
  console.log('='.repeat(80));
  for (const q of QUERIES) {
    const lq = await localPipe([q], { pooling: 'cls', normalize: true });
    const lqv = norm(lq.tolist()[0]);
    const gqv = norm((await ai.embed([q])).vectors[0]);
    const lAll = rank(localVecs, lqv, 10), gAll = rank(giteeVecs, gqv, 10);
    const l10 = new Set(lAll.map(x => x.i));
    const same = gAll.filter(x => l10.has(x.i)).length;
    const spread = (r) => (r[0].s - r[r.length - 1].s).toFixed(3);
    console.log('  ' + q.padEnd(24) + ' 重合 ' + String(same).padStart(2) + '/10   本机分差 ' + spread(lAll) + '  方舟分差 ' + spread(gAll));
  }

  // ---- D. 重排 ----
  console.log('');
  console.log('='.repeat(80));
  console.log('重排增益（模力方舟 bge-reranker-v2-m3）');
  console.log('='.repeat(80));
  const rq = '不用信用卡就能注册的国外服务';
  const gqv = norm((await ai.embed([rq])).vectors[0]);
  const cand = rank(giteeVecs, gqv, 20);
  try {
    ai.saveSettings({ rerankBaseUrl: 'https://ai.gitee.com/v1', rerankModel: 'bge-reranker-v2-m3', rerankApiKey: KEY });
    const t1 = Date.now();
    const rr = await ai.rerank(rq, cand.map(c => texts[c.i]));
    console.log('查询「' + rq + '」  重排 20 条耗时 ' + (Date.now() - t1) + 'ms');
    console.log('');
    console.log('  重排前（纯向量）');
    for (const c of cand.slice(0, 5)) console.log('    ' + c.s.toFixed(3) + '  ' + texts[c.i].replace(/\s+/g, ' ').slice(0, 56));
    console.log('  重排后（cross-encoder）');
    for (const h of rr.results.slice(0, 5)) console.log('    ' + h.score.toFixed(3) + '  ' + texts[cand[h.index].i].replace(/\s+/g, ' ').slice(0, 56));
  } catch (e) { console.log('  重排失败: ' + String(e.message).slice(0, 150)); }
}
