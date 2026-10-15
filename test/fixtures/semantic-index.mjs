import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-semantic-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
globalThis.fetch = async () => { throw new Error('network forbidden in index tests'); };
const scenario = process.env.INDEX_SCENARIO;
let calls = 0;
mock.module(new URL('../../app/server/ai.mjs', import.meta.url), {
  exports: {
    embed: async texts => {
      calls++;
      return {
        model: scenario === 'model' ? 'other-model' : 'test-model',
        vectors: texts.map(() => scenario === 'dim' ? [1, 0, 0] : [1, 0]),
      };
    },
  },
});
const store = await import('../../app/server/store.mjs');
const semantic = await import('../../app/server/semantic.mjs');
let sequence = 0;
function add(value, text = 'controlled embedding post longer than fifteen characters') {
  return store.insertPost({
    channel: 'index', msgId: ++sequence, date: '2026-10-01', ts: 1790812800,
    text, category: '实用工具', categories: '实用工具', tags: '', value,
  }).id;
}
function label(id, value, orig_value) {
  store.saveAiLabels([{ id, category: '实用工具', value, orig_category: '实用工具', orig_value }]);
}
function save(id) {
  store.saveEmbeddings([{ id, vec: Buffer.from([127, 0]), dim: 2, norm: 127, model: 'test-model' }]);
}
after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('索引处理当前缺向量集合并正确更新状态', async () => {
  if (scenario === 'empty') {
    const result = await semantic.buildIndex({});
    assert.equal(result.skipped, true);
    assert.equal(calls, 0);
    assert.equal(semantic.getStatus().stats.pending, 0);
    return;
  }
  if (scenario === 'cache') {
    const first = add(4);
    assert.equal(store.embedStats().pending, 1);
    save(first);
    assert.equal(store.embedStats().pending, 0);
    store.clearEmbeddings();
    assert.equal(store.embedStats().pending, 1);
    label(first, 2, 4);
    assert.equal(store.embedStats().pending, 0);
    store.rollbackAiLabels();
    assert.equal(store.embedStats().pending, 1);
    add(4);
    assert.equal(store.embedStats().pending, 2);
    return;
  }
  if (scenario === 'length') {
    const short = add(4, 'a'.repeat(14));
    const good = add(4, 'a'.repeat(15));
    assert.equal(store.embedEligibleCount(), 1);
    const result = await semantic.buildIndex({});
    assert.equal(result.done, 1);
    assert.equal(calls, 1);
    assert.deepEqual(store.loadEmbeddings().map(r => r.id), [good]);
    assert.ok(!store.loadEmbeddings().some(r => r.id === short));
    assert.equal(semantic.getStatus().stats.pending, 0);
    return;
  }
  const old = add(5);
  const next = add(scenario === 'default' || scenario === 'min3' ? 2 : 4);
  save(old);
  const minValue = scenario === 'min3' ? 3 : 4;
  if (scenario === 'default') label(old, 2, 5);
  if (scenario === 'default' || scenario === 'min3') label(next, minValue, 2);
  if (scenario === 'partial') add(4);
  const stats = store.embedStats();
  if (scenario === 'default' || scenario === 'min3') assert.equal(stats.indexed, stats.eligible);
  assert.ok(store.postsNeedingEmbedding(10, minValue).some(r => r.id === next));
  const result = await semantic.buildIndex({ minValue, batch: 1, maxBatches: scenario === 'partial' ? 1 : 0 });
  if (scenario === 'model' || scenario === 'dim') {
    assert.equal(result.ok, false);
    assert.match(result.error, scenario === 'model' ? /不能混用/ : /维度/);
    assert.equal(store.loadEmbeddings().length, 1);
    assert.equal(store.postsNeedingEmbedding(10, minValue).length, 1);
    return;
  }
  assert.notEqual(result.skipped, true, 'missing eligible posts must not be skipped');
  assert.equal(result.ok, true);
  assert.equal(result.done, 1);
  assert.equal(calls, 1);
  assert.ok(store.loadEmbeddings().some(r => r.id === next));
  assert.equal(semantic.getStatus().stats.pending, scenario === 'partial' ? 1 : 0);
  if (scenario === 'partial') {
    const resumed = await semantic.buildIndex({ minValue, batch: 1 });
    assert.equal(resumed.done, 1);
    assert.equal(calls, 2);
  }
  const again = await semantic.buildIndex({ minValue });
  assert.equal(again.skipped, true);
  assert.equal(semantic.getStatus().stats.pending, 0);
  assert.equal(calls, scenario === 'partial' ? 2 : 1);
});
