import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = path.join(os.tmpdir(), 'tg-netdisk-scan-' + process.pid + '-' + Date.now() + '.db');
process.env.DB_PATH = tmp;
const store = await import('../app/server/store.mjs');
const netdisk = await import('../app/server/netdisk.mjs');

after(() => {
  store.close();
  for (const f of [tmp, tmp + '-wal', tmp + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
});

let mid = 0;
function seed(text, links, domains) {
  return store.insertPost({
    channel: 'scanchan', msgId: ++mid, date: '2026-10-10', ts: 1791580000 + mid,
    text, category: '实用工具', tags: '', value: 6,
    url: 'https://t.me/scanchan/' + mid, links, domains,
  }).id;
}

test('scanPosts 从帖子抽出网盘条目', () => {
  seed('🙂标题：洛雪音乐绿色版 🙂下载地址：夸克盘 / 蓝奏云 🙂标签：#音乐 Please open Telegram to view this post', 'https://pan.quark.cn/s/aaa111 https://qiuyw.lanzouq.com/bbb222', 'pan.quark.cn qiuyw.lanzouq.com');
  const r = netdisk.scanPosts('full');
  assert.equal(r.inserted, 2);
  const list = store.netdiskList({});
  assert.equal(list.total, 2);
  const quark = list.items.find(x => x.platform === 'quark');
  assert.equal(quark.title, '洛雪音乐绿色版');
  assert.equal(quark.channel, 'scanchan');
});

test('scanPosts 增量：无新帖子时零插入', () => {
  const r = netdisk.scanPosts('incremental');
  assert.equal(r.inserted, 0);
  assert.equal(r.merged, 0);
});

test('scanPosts 增量：只处理游标之后的新帖子', () => {
  seed('新资源 标题：工具X 下载地址：夸克盘', 'https://pan.quark.cn/s/ccc333', 'pan.quark.cn');
  const r = netdisk.scanPosts('incremental');
  assert.equal(r.inserted, 1);
  assert.equal(store.netdiskList({}).total, 3);
});

test('scanPosts 全量幂等：重复全量不新增行', () => {
  const before = store.netdiskList({}).total;
  const r = netdisk.scanPosts('full');
  assert.equal(r.inserted, 0);
  assert.equal(store.netdiskList({}).total, before);
});

test('scanPosts 同一链接多频道合并', () => {
  store.insertPost({ channel: 'otherchan', msgId: 9001, date: '2026-10-11', ts: 1791589999, text: '同一资源 标题：工具X', category: '实用工具', value: 8, url: 'https://t.me/otherchan/9001', links: 'https://pan.quark.cn/s/ccc333', domains: 'pan.quark.cn' });
  netdisk.scanPosts('full');
  const row = store.netdiskList({ platform: 'quark', q: '工具X' }).items[0];
  assert.equal(row.mergeCount, 2);
  assert.equal(row.channel, 'otherchan'); // 价值 8 > 6，成为主来源
});

test('scanPosts 无网盘链接的帖子不写入', () => {
  const before = store.netdiskList({}).total;
  seed('普通帖子，没有网盘链接 https://github.com/a/b', 'https://github.com/a/b', 'github.com');
  netdisk.scanPosts('full');
  assert.equal(store.netdiskList({}).total, before);
});

test('startScan 后台运行并落状态', async () => {
  const s = netdisk.startScan('incremental');
  assert.equal(s.ok, true);
  assert.equal(s.started, true);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(netdisk.getScanStatus().running, false);
});
