// 集成测试：在临时库上跑「写入 -> 检索」闭环
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), 'tg-intel-test-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = tmp;

const store = await import('../app/server/store.mjs');

function rec(over) {
  return Object.assign({
    channel: 'testchan', msgId: 1, date: '2026-01-01', ts: 1767225600, views: 100, media: '',
    text: '免费领取香港 VPS 优惠码，限时活动，注册即送三个月', category: '羊毛优惠',
    categories: '羊毛优惠', tags: '免费,限时', hashtags: '', value: 6, content: 4,
    url: 'https://t.me/testchan/1', links: 'https://example.com/a', domains: 'example.com',
    lpTitle: '', source: 'channel', author: '', groupTitle: '',
  }, over);
}

after(() => {
  store.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});

test('insertPost 幂等：同 (channel,msgId) 第二次返回 duplicate', () => {
  const a = store.insertPost(rec());
  assert.equal(a.inserted, true);
  assert.ok(a.id > 0);
  const b = store.insertPost(rec());
  assert.equal(b.inserted, false);
  assert.equal(b.reason, 'duplicate');
});

test('insertPost 不同 msgId 可正常写入', () => {
  const c = store.insertPost(rec({ msgId: 2, text: '开源下载器 GitHub 项目推荐', category: '开源项目', tags: '开源', domains: 'github.com', links: 'https://github.com/x/y' }));
  assert.equal(c.inserted, true);
});

test('liveCount 反映真实行数且写入后失效缓存', () => {
  const n1 = store.liveCount();
  store.insertPost(rec({ msgId: 3, text: '第三条测试内容，用于计数验证' }));
  const n2 = store.liveCount();
  assert.equal(n2, n1 + 1);
});

test('search: 3 字以上走 FTS 并命中', () => {
  const r = store.search({ q: '中转站', size: 10 });
  assert.equal(r.mode, 'fts');
});

test('search: 英文词走 FTS 并命中', () => {
  const r = store.search({ q: 'GitHub', size: 10 });
  assert.equal(r.mode, 'fts');
  assert.ok(r.items.some(x => x.text.includes('GitHub')));
});

test('search: 2 字词走 like 模式且结果包含该词', () => {
  const r = store.search({ q: '开源', size: 10 });
  assert.equal(r.mode, 'like');
  assert.ok(r.items.some(x => x.text.includes('开源')));
});

test('search: 分类与标签筛选生效', () => {
  const byCat = store.search({ q: '', category: '羊毛优惠', size: 10 });
  assert.ok(byCat.items.every(x => x.category === '羊毛优惠'));
  const byTag = store.search({ q: '', tags: ['限时'], size: 10 });
  assert.ok(byTag.items.every(x => x.tags.includes('限时')));
});

test('getPost 与 related 可用', () => {
  const r = store.search({ q: 'VPS', size: 1 });
  assert.ok(r.items.length > 0);
  const p = store.getPost(r.items[0].id);
  assert.equal(p.id, r.items[0].id);
  const rel = store.related(r.items[0].id, 5);
  assert.ok(Array.isArray(rel));
});

test('facets 返回实时总数', () => {
  const f = store.facets();
  assert.equal(Number(f.meta.count), store.liveCount());
  assert.ok(f.categories.length > 0);
});

test('来源登记可增删查', () => {
  store.upsertSource({ id: 'somechan', kind: 'channel', title: '测试频道' });
  assert.ok(store.listSources().some(s => s.id === 'somechan'));
  store.upsertSource({ id: 'somechan', kind: 'channel', title: '改名后' });
  assert.equal(store.getSource('somechan').title, '改名后');
  assert.equal(store.removeSource('somechan'), true);
  assert.equal(store.getSource('somechan'), null);
});
