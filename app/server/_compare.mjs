// 向量模型对比：同一个帖子样本，本机 bge-small-zh vs 模力方舟 bge-m3
import * as ai from './ai.mjs';
import { DatabaseSync } from 'node:sqlite';

const KEY = process.env.GITEE_KEY || '';
const SAMPLE = Number(process.env.SAMPLE || 2500);
const QUERIES = [
  '怎么白嫖服务器',
  '有没有便宜的国外主机',
  '不用信用卡就能注册的国外服务',
  '学生党怎么省钱买软件',
  'AI 写代码哪个好用',
];

// ---------- 1. 取样本 ----------
const d = new DatabaseSync('app/data/intel.db', { readOnly: true });
const rows = d.prepare("SELECT id, text FROM posts WHERE value >= 5 AND LENGTH(text) >= 20 AND is_rep = 1 ORDER BY value DESC LIMIT ?").all(SAMPLE);
d.close();
const texts = rows.map(r => String(r.text).slice(0, 512));
console.log('样本 ' + texts.length + ' 条（价值分 >= 5 且去重后的代表条目）');

const norm = (v) => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ---------- 2. 本机模型 ----------
console.log('');
console.log('=== A. 本机 Xenova/bge-small-zh-v1.5 ===');
const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = 'app/data/models';
const localPipe = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype: 'fp32' });
let t0 = Date.now();
const localVecs = [];
for (let i = 0; i < texts.length; i += 32) {
  const out = await localPipe(texts.slice(i, i + 32), { pooling: 'cls', normalize: true });
  for (const v of out.tolist()) localVecs.push(norm(v));
}
const localMs = Date.now() - t0;
const localDim = localVecs[0].length;
console.log('  ' + localDim + ' 维  ' + texts.length + ' 条耗时 ' + (localMs / 1000).toFixed(1) + 's  =  ' + (localMs / texts.length).toFixed(0) + 'ms/条');
console.log('  13.2 万条预计 ' + (localMs / texts.length * 132263 / 60000).toFixed(0) + ' 分钟，存储约 ' + (132263 * localDim / 1048576).toFixed(0) + ' MB');

// ---------- 3. 模力方舟 bge-m3 ----------
console.log('');
console.log('=== B. 模力方舟 bge-m3 ===');
if (!KEY) { console.log('  缺少密钥，跳过'); }
else {
  ai.saveSettings({ embedBaseUrl: 'https://ai.gitee.com/v1', embedModel: 'bge-m3', embedApiKey: KEY });
  t0 = Date.now();
  const giteeVecs = [];
  let failed = 0;
  for (let i = 0; i < texts.length; i += 32) {
    try {
      const r = await ai.embed(texts.slice(i, i + 32));
      for (const v of r.vectors) giteeVecs.push(norm(v));
    } catch (e) { failed += texts.slice(i, i + 32).length; if (failed > 64) { console.log('  连续失败，中止: ' + String(e.message).slice(0, 120)); break; } }
  }
  const giteeMs = Date.now() - t0;
  const giteeDim = giteeVecs.length ? giteeVecs[0].length : 0;
  console.log('  ' + giteeDim + ' 维  ' + giteeVecs.length + ' 条耗时 ' + (giteeMs / 1000).toFixed(1) + 's  =  ' + (giteeMs / Math.max(1, giteeVecs.length)).toFixed(0) + 'ms/条  失败 ' + failed);
  if (giteeVecs.length) console.log('  13.2 万条预计 ' + (giteeMs / giteeVecs.length * 132263 / 60000).toFixed(0) + ' 分钟，存储约 ' + (132263 * giteeDim / 1048576).toFixed(0) + ' MB');

  // ---------- 4. 检索质量对比 ----------
  console.log('');
  console.log('='.repeat(78));
  console.log('检索质量对比：同样的查询，各自取余弦最高的 4 条');
  console.log('='.repeat(78));
  for (const q of QUERIES) {
    const lq = await localPipe([q], { pooling: 'cls', normalize: true });
    const lqv = norm(lq.tolist()[0]);
    const gq = await ai.embed([q]);
    const gqv = norm(gq.vectors[0]);

    const lRank = localVecs.map((v, i) => ({ i, s: cos(lqv, v) })).sort((a, b) => b.s - a.s).slice(0, 4);
    const gRank = giteeVecs.map((v, i) => ({ i, s: cos(gqv, v) })).sort((a, b) => b.s - a.s).slice(0, 4);

    console.log('');
    console.log('■ 查询：' + q);
    console.log('  ── 本机 bge-small ──');
    for (const r of lRank) console.log('    ' + r.s.toFixed(3) + '  ' + texts[r.i].replace(/\s+/g, ' ').slice(0, 60));
    console.log('  ── 模力方舟 bge-m3 ──');
    for (const r of gRank) console.log('    ' + r.s.toFixed(3) + '  ' + texts[r.i].replace(/\s+/g, ' ').slice(0, 60));
  }

  // 两模型 top10 重合度
  console.log('');
  console.log('='.repeat(78));
  console.log('两模型结果重合度（Top-10 有几条相同）');
  console.log('='.repeat(78));
  for (const q of QUERIES) {
    const lq = await localPipe([q], { pooling: 'cls', normalize: true });
    const lqv = norm(lq.tolist()[0]);
    const gq = await ai.embed([q]);
    const gqv = norm(gq.vectors[0]);
    const l10 = new Set(localVecs.map((v, i) => ({ i, s: cos(lqv, v) })).sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.i));
    const g10 = giteeVecs.map((v, i) => ({ i, s: cos(gqv, v) })).sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.i);
    const same = g10.filter(i => l10.has(i)).length;
    console.log('  ' + q.padEnd(24) + '重合 ' + same + '/10');
  }

  // ---------- 5. 重排增益 ----------
  console.log('');
  console.log('='.repeat(78));
  console.log('重排增益（模力方舟 bge-reranker-v2-m3）');
  console.log('='.repeat(78));
  const rq = '不用信用卡就能注册的国外服务';
  const gq2 = await ai.embed([rq]);
  const gqv2 = norm(gq2.vectors[0]);
  const cand = giteeVecs.map((v, i) => ({ i, s: cos(gqv2, v) })).sort((a, b) => b.s - a.s).slice(0, 20);
  ai.saveSettings({ rerankBaseUrl: 'https://ai.gitee.com/v1', rerankModel: 'bge-reranker-v2-m3', rerankApiKey: KEY });
  t0 = Date.now();
  const rr = await ai.rerank(rq, cand.map(c => texts[c.i]));
  const rrMs = Date.now() - t0;
  console.log('查询：' + rq + '   重排 20 条耗时 ' + rrMs + 'ms');
  console.log('');
  console.log('  重排前（纯向量 Top-5）');
  for (const c of cand.slice(0, 5)) console.log('    ' + c.s.toFixed(3) + '  ' + texts[c.i].replace(/\s+/g, ' ').slice(0, 58));
  console.log('  重排后（cross-encoder Top-5）');
  for (const h of rr.results.slice(0, 5)) console.log('    ' + h.score.toFixed(3) + '  ' + texts[cand[h.index].i].replace(/\s+/g, ' ').slice(0, 58));
}
