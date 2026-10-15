import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-search-count-'));
process.env.DB_PATH = path.join(dir, 'test.db');
const store = await import('../app/server/store.mjs');

for (let i = 1; i <= 45; i++) {
  store.insertPost({
    channel: 'pagination', msgId: i, date: '2026-10-01', ts: 1790812800 + i,
    text: 'paginationkey controlled result number ' + i,
    category: '实用工具', categories: '实用工具', tags: '开源', value: 6,
    links: 'https://example.com/pagination/' + i, domains: 'example.com',
  });
}

// 对照行：分类不符且正文不含关键词。若「保留筛选」的断言里筛选被丢弃，full.total 会变成 46。
store.insertPost({
  channel: 'pagination', msgId: 100, date: '2026-10-01', ts: 1790812900,
  text: 'offscope marker row', category: '其他', categories: '其他', tags: '开源', value: 6,
  links: 'https://example.com/offscope', domains: 'example.com',
});

after(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('FTS 的末页和越界空页保留全部命中总数', () => {
  const ids = [];
  for (const [page, length] of [[1, 40], [2, 5], [3, 0]]) {
    const opts = { q: 'paginationkey', size: 40, page, collapse: false };
    const result = store.search(opts);
    assert.equal(result.mode, 'fts');
    assert.equal(result.total, 45, 'page ' + page);
    assert.equal(result.items.length, length);
    const fast = store.search({ ...opts, count: false });
    assert.deepEqual(fast.items.map(p => p.id), result.items.map(p => p.id));
    assert.equal(fast.total, null);
    assert.equal(fast.page, page);
    assert.equal(fast.size, 40);
    ids.push(...result.items.map(p => p.id));
  }
  assert.equal(new Set(ids).size, 45);
});

test('FTS 首页短页和空页不需要 COUNT', t => {
  const prepare = DatabaseSync.prototype.prepare;
  let counts = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    if (/SELECT COUNT\(\*\)/i.test(sql)) counts++;
    return prepare.call(this, sql);
  });
  const short = store.search({ q: 'paginationkey', size: 60, collapse: false });
  assert.equal(short.mode, 'fts');
  assert.equal(short.total, 45);
  const empty = store.search({ q: 'nevermatchingkey', size: 60 });
  assert.equal(empty.mode, 'fts');
  assert.equal(empty.total, 0);
  assert.equal(counts, 0);
});

for (const mode of ['fts', 'browse', 'like']) {
  test('count:false 保留 ' + mode + ' 筛选及顺序并且不执行 COUNT', t => {
    const prepare = DatabaseSync.prototype.prepare;
    let counts = 0;
    t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      if (mode === 'like' && /^SELECT .*FROM posts_fts f/i.test(sql)) {
        throw new Error('simulated unavailable FTS');
      }
      if (/SELECT COUNT\(\*\)/i.test(sql)) counts++;
      return prepare.call(this, sql);
    });
    const opts = {
      q: mode === 'browse' ? '' : 'paginationkey',
      category: '实用工具', tags: ['开源'], channel: 'pagination',
      minValue: 5, collapse: true, size: 10, sort: 'date',
    };
    const fast = store.search({ ...opts, count: false });
    assert.equal(fast.mode, mode);
    assert.equal(fast.total, null);
    assert.equal(counts, 0);
    const full = store.search(opts);
    assert.equal(full.mode, mode);
    assert.equal(full.total, 45);
    assert.equal(counts, 1);
    assert.deepEqual(fast.items.map(p => p.id), full.items.map(p => p.id));
    assert.equal(fast.page, full.page);
    assert.equal(fast.size, full.size);
  });
}
