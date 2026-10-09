import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, orExpr } from '../core/query.mjs';

test('trigram 模式：>=3 字走 FTS，短词留给 LIKE 过滤', () => {
  const a = buildQuery('中转站');
  assert.equal(a.mode, 'trigram');
  assert.equal(a.expr, '"中转站"');
  assert.deepEqual(a.shortTerms, []);

  const b = buildQuery('免费');
  assert.equal(b.expr, null);
  assert.deepEqual(b.shortTerms, ['免费']);

  const c = buildQuery('免费 VPS');
  assert.equal(c.expr, '"VPS"');
  assert.deepEqual(c.shortTerms, ['免费']);
});

test('gram 模式：任意长度都转成短语查询（M4 目标）', () => {
  assert.equal(buildQuery('中转站', { mode: 'gram' }).expr, '"中 转 站"');
  assert.equal(buildQuery('免费', { mode: 'gram' }).expr, '"免 费"');
  assert.equal(buildQuery('免费 VPS', { mode: 'gram' }).expr, '"免 费" AND "VPS"');
  assert.equal(buildQuery('', { mode: 'gram' }).expr, null);
});

test('特殊字符不会产生畸形表达式', () => {
  for (const q of ['a"b*c(d)', '中转站*"', '" "', '* * *', '^^^']) {
    const a = buildQuery(q);
    const g = buildQuery(q, { mode: 'gram' });
    assert.ok(a.expr === null || typeof a.expr === 'string');
    assert.ok(g.expr === null || typeof g.expr === 'string');
    assert.ok(!(a.expr || '').includes('""'));
    assert.ok(!(g.expr || '').includes('""'));
  }
});

test('orExpr：过滤短词，无有效词返回 null', () => {
  assert.equal(orExpr(['中转站', '免费']), '"中转站"');
  assert.equal(orExpr(['免费', 'a']), null);
  assert.equal(orExpr([]), null);
  assert.equal(orExpr(null), null);
});
