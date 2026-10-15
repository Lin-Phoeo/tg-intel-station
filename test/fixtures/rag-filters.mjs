import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-rag-filter-'));
process.env.DB_PATH = path.join(dir, 'test.db');
globalThis.fetch = async () => { throw new Error('network forbidden in filter tests'); };
const store = await import('../../app/server/store.mjs');
const ai = await import('../../app/server/ai.mjs');
const ids = [];
function add(over = {}) {
  const index = ids.length + 1;
  const r = store.insertPost({
    channel: 'wanted', msgId: index, date: '2026-10-10', ts: 1791655200,
    text: 'filterkey controlled result with a sufficiently descriptive body for ranking',
    category: '实用工具', categories: '实用工具', tags: '开源,免费', value: 6,
    links: 'https://example.com/filter/' + index, ...over,
  });
  ids.push(r.id);
  return r.id;
}
add({ category: '其他' });
add({ date: '2026-09-30' });
add({ date: '2026-10-12' });
add({ ts: 1791633600 });
add();
add();
add({ channel: 'other' });
add({ value: 2 });
add({ tags: '开源' });
const db = store.open();
db.prepare('UPDATE posts SET is_rep=0, rep_id=? WHERE id=?').run(ids[5], ids[4]);
// 旧库的默认代表可能尚无 rep_id，筛选必须依赖实际 is_rep。
db.prepare('UPDATE posts SET rep_id=NULL WHERE id=?').run(ids[5]);
const candidates = store.getPostsByIds(ids).sort((a, b) => a.id - b.id);
mock.module(new URL('../../app/server/semantic.mjs', import.meta.url), {
  exports: { semanticSearch: async () => ({ ok: true, items: candidates }) },
});
const rag = await import('../../app/server/rag.mjs');

after(() => {
  mock.restoreAll();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const filters = {
  category: '实用工具', from: '2026-10-01', to: '2026-10-11',
  since: 1791633600, collapse: true, channel: 'wanted', minValue: 5,
  tags: ['开源', '免费'],
};

test('向量候选不能越过组合筛选，旧库合法代表仍可返回', async () => {
  const result = await rag.retrieve('nomatchingquery', filters, 14);
  assert.deepEqual(result.map(p => p.id), [ids[5]]);
});

for (const [name, f, expected] of [
  ['分类', { category: '实用工具', collapse: false }, [1, 2, 3, 4, 5, 6, 7, 8]],
  ['开始日期包含边界', { from: '2026-10-10', collapse: false }, [0, 2, 3, 4, 5, 6, 7, 8]],
  ['结束日期包含边界', { to: '2026-10-10', collapse: false }, [0, 1, 3, 4, 5, 6, 7, 8]],
  ['新增时间严格大于', { since: 1791633600, collapse: false }, [0, 1, 2, 4, 5, 6, 7, 8]],
  ['频道', { channel: 'wanted', collapse: false }, [0, 1, 2, 3, 4, 5, 7, 8]],
  ['最低价值', { minValue: 5, collapse: false }, [0, 1, 2, 3, 4, 5, 6, 8]],
  ['多标签同时满足', { tags: ['开源', '免费'], collapse: false }, [0, 1, 2, 3, 4, 5, 6, 7]],
  ['默认折叠', {}, [0, 1, 2, 3, 5, 6, 7, 8]],
  ['展开重复来源', { collapse: false }, [0, 1, 2, 3, 4, 5, 6, 7, 8]],
]) {
  test('向量分支保序并执行' + name, async () => {
    const d = await rag.retrieveDetailed('nomatchingquery', f, 14);
    assert.deepEqual(d.vector.map(p => p.id), expected.map(i => ids[i]));
  });
}

test('外层 page 不会跳过 RAG 和纯关键词召回的第一页', async () => {
  for (const run of [
    () => rag.retrieve('filterkey', filters, 14),
    () => ai.retrieve('filterkey', filters, 14),
  ]) {
    const first = await run();
    assert.ok(first.length > 0);
  }
  const first = await rag.retrieveDetailed('filterkey', filters, 14);
  const later = await rag.retrieveDetailed('filterkey', { ...filters, page: 3 }, 14);
  assert.deepEqual(later.keyword.map(p => p.id), first.keyword.map(p => p.id));
  assert.deepEqual(ai.retrieve('filterkey', { ...filters, page: 3 }, 14).map(p => p.id),
    ai.retrieve('filterkey', filters, 14).map(p => p.id));
});
