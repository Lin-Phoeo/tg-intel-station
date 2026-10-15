import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), 'tg-netdisk-store-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = tmp;
const store = await import('../app/server/store.mjs');

after(() => {
  store.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});

test('netdiskUpsert 首次插入', () => {
  const r = store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', pwd: 'k9m2', title: '资源A', postId: 1, channel: 'c1', postDate: '2026-10-10', postUrl: 'https://t.me/c1/1', value: 6 });
  assert.equal(r.inserted, true);
  const list = store.netdiskList({});
  assert.equal(list.total, 1);
  assert.equal(list.items[0].shareKey, 'abc1');
  assert.equal(list.items[0].pwd, 'k9m2');
  assert.equal(list.items[0].mergeCount, 1);
});

test('netdiskUpsert 同 (platform,shareKey) 合并来源，不新增行', () => {
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 2, channel: 'c2', postDate: '2026-10-11', postUrl: 'https://t.me/c2/2', value: 3 });
  const list = store.netdiskList({});
  assert.equal(list.total, 1);
  const row = list.items[0];
  assert.equal(row.mergeCount, 2);
  assert.equal(row.sources.length, 2);
  assert.deepEqual(row.sources.map(s => s.channel).sort(), ['c1', 'c2']);
});

test('netdiskUpsert 同 postId 重复并入幂等', () => {
  const before = store.netdiskList({}).items[0].mergeCount;
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 2, channel: 'c2', postDate: '2026-10-11', postUrl: 'https://t.me/c2/2', value: 3 });
  assert.equal(store.netdiskList({}).items[0].mergeCount, before);
});

test('netdiskUpsert 高价值来源成为主来源', () => {
  store.netdiskUpsert({ platform: 'quark', shareKey: 'abc1', shareUrl: 'https://pan.quark.cn/s/abc1', title: '资源A', postId: 3, channel: 'c3', postDate: '2026-10-12', postUrl: 'https://t.me/c3/3', value: 9 });
  const row = store.netdiskList({}).items[0];
  assert.equal(row.channel, 'c3');
  assert.equal(row.value, 9);
});

test('netdiskList 按平台与关键词筛选', () => {
  store.netdiskUpsert({ platform: 'baidu', shareKey: 'bd1', shareUrl: 'https://pan.baidu.com/s/bd1', title: '教程合集', postId: 4, channel: 'c4', postDate: '2026-10-10', postUrl: 'https://t.me/c4/4', value: 5 });
  assert.equal(store.netdiskList({ platform: 'baidu' }).total, 1);
  assert.equal(store.netdiskList({ q: '教程' }).total, 1);
  assert.equal(store.netdiskList({ q: '不存在的词xyz' }).total, 0);
  assert.equal(store.netdiskList({}).total, 2);
});

test('netdiskFacets 返回平台计数', () => {
  const f = store.netdiskFacets();
  assert.equal(f.total, 2);
  assert.ok(f.platforms.some(p => p.k === 'quark' && p.n === 1));
});

test('netdiskPending 只返回未整理条目', () => {
  assert.equal(store.netdiskPendingCount(), 2);
  const pend = store.netdiskPending(10);
  assert.equal(pend.length, 2);
  assert.ok(pend[0].id > 0);
});

test('netdiskSaveAi 写回并清空待办', () => {
  const ids = store.netdiskPending(10).map(r => r.id);
  store.netdiskSaveAi(ids.map(id => ({ id, category: '软件工具', tags: '工具,免费', summary: '一句话简介', aiTitle: '规范标题' })));
  assert.equal(store.netdiskPendingCount(), 0);
  const row = store.netdiskGet(ids[0]);
  assert.equal(row.category, '软件工具');
  assert.equal(row.aiTitle, '规范标题');
  assert.ok(row.aiAt);
});

test('netdiskGet 不存在返回 null', () => {
  assert.equal(store.netdiskGet(999999), null);
});

test('netdiskExport 返回全部筛选结果，不受列表分页上限限制', () => {
  for (let i = 0; i < 150; i++) {
    store.netdiskUpsert({ platform: 'pan123', shareKey: 'exp' + i, shareUrl: 'https://www.123pan.com/s/exp' + i, title: '导出' + i, postId: 5000 + i, channel: 'c9', postDate: '2026-10-01', postUrl: '', value: 1 });
  }
  assert.equal(store.netdiskExport({ platform: 'pan123' }).length, 150);
  // 列表接口仍按分页上限截断（显式要 500 条也只给 100）
  assert.equal(store.netdiskList({ platform: 'pan123', size: 500 }).items.length, 100);
  assert.equal(store.netdiskList({ platform: 'pan123' }).total, 150);
});
