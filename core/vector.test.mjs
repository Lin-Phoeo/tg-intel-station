import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, quantizeInt8, normInt8, cosineInt8, toBuffer, fromBuffer, topK } from '../core/vector.mjs';

test('normalize: 单位化，零向量不炸', () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(v[1] - 0.8) < 1e-6);
  assert.deepEqual([...normalize([0, 0, 0])], [0, 0, 0]);
});

test('精确余弦：同一向量按模长归一后严格为 1', () => {
  for (const raw of [[1, 2, 3, 4], [1, -2, 3, -4, 5], [0.3, -1.2, 2.4, 0.9, -0.4, 1.1]]) {
    const q = quantizeInt8(normalize(raw));
    const n = normInt8(q);
    assert.ok(Math.abs(cosineInt8(q, q, n, n) - 1) < 1e-9, '自相似应严格为 1');
  }
});

test('精确余弦：正交接近 0，反向接近 -1', () => {
  const mk = (raw) => { const q = quantizeInt8(normalize(raw)); return { q: q, n: normInt8(q) }; };
  const x = mk([1, 0, 0, 0]), y = mk([0, 1, 0, 0]), z = mk([-1, 0, 0, 0]);
  assert.ok(Math.abs(cosineInt8(x.q, y.q, x.n, y.n)) < 0.01);
  assert.ok(cosineInt8(x.q, z.q, x.n, z.n) < -0.99);
});

test('按模长归一后比固定 127 更接近浮点真值', () => {
  const A = normalize([0.3, -1.2, 2.4, 0.9, -0.4, 1.1]);
  const B = normalize([0.1, -1.0, 2.0, 1.2, -0.2, 0.8]);
  let truth = 0;
  for (let i = 0; i < A.length; i++) truth += A[i] * B[i];
  const qa = quantizeInt8(A), qb = quantizeInt8(B);
  const exact = cosineInt8(qa, qb, normInt8(qa), normInt8(qb));
  const naive = cosineInt8(qa, qb);
  const eExact = Math.abs(exact - truth), eNaive = Math.abs(naive - truth);
  assert.ok(eExact < 0.01, '归一后误差应更小，实际 ' + eExact.toFixed(4));
  assert.ok(eExact <= eNaive + 1e-9, '不应比旧算法更差 (exact=' + eExact.toFixed(4) + ' naive=' + eNaive.toFixed(4) + ')');
});

test('Buffer 往返无损', () => {
  const q = quantizeInt8(normalize([1, -2, 3, -4, 5]));
  const back = fromBuffer(toBuffer(q));
  assert.deepEqual([...back], [...q]);
  assert.equal(cosineInt8(q, back, normInt8(q), normInt8(back)), 1);
});

test('topK: 排序、截断、跳过维度不符', () => {
  const mk = (raw) => { const q = quantizeInt8(normalize(raw)); return { q: q, n: normInt8(q) }; };
  const query = mk([1, 0, 0, 0]);
  const same = mk([1, 0, 0, 0]), orth = mk([0, 1, 0, 0]), bad = mk([1, 0]);
  const r = topK(query.q, query.n, [
    { id: 'orth', vec: orth.q, norm: orth.n },
    { id: 'same', vec: same.q, norm: same.n },
    { id: 'bad', vec: bad.q, norm: bad.n },
  ], 5);
  assert.equal(r.length, 2, '维度不符应跳过');
  assert.equal(r[0].id, 'same');
  assert.ok(r[0].score > r[1].score);
  assert.equal(topK(query.q, query.n, [{ id: 'same', vec: same.q, norm: same.n }], 1).length, 1);
});
