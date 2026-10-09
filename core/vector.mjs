// 向量量化与相似度：纯函数，无 IO，可独立单测。
//
// 设计取舍：向量归一化后量化成 int8，同时**保存量化后的模长**。
// 只除以固定的 127^2 是不对的——int8 取整会改变模长，不同向量偏差不同，
// 会让量化误差大的向量分数虚高。存模长后算的是量化向量之间精确的余弦。
// 1024 维 int8 = 1KB，12 万条约 120MB；JS 暴力点积约 200ms，够用。

export function normalize(vec) {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  const out = new Float32Array(vec.length);
  if (n === 0) return out;
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

export function quantizeInt8(vec) {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round(vec[i] * 127);
    out[i] = v > 127 ? 127 : (v < -127 ? -127 : v);
  }
  return out;
}

export function normInt8(q) {
  let s = 0;
  for (let i = 0; i < q.length; i++) s += q[i] * q[i];
  return Math.sqrt(s) || 1;
}

// 量化向量之间的余弦。传入各自模长才是精确值；省略则退化为按 127 归一。
export function cosineInt8(a, b, na, nb) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s / ((na || 127) * (nb || 127));
}

export function toBuffer(q) {
  return Buffer.from(q.buffer, q.byteOffset, q.byteLength);
}

export function fromBuffer(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Int8Array(ab);
}

// 暴力检索：候选集不大时比维护 ANN 索引简单得多，也足够快。
// items: [{ id, vec, norm }]
export function topK(queryVec, queryNorm, items, k) {
  const scored = [];
  for (const it of items) {
    if (!it.vec || it.vec.length !== queryVec.length) continue;
    scored.push({ id: it.id, score: cosineInt8(queryVec, it.vec, queryNorm, it.norm) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
