// 备份 / 恢复：在临时库上验证完整闭环
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stamp = process.pid + '-' + Date.now();
const tmpDb = path.join(os.tmpdir(), 'tg-bk-test-' + stamp + '.db');
const tmpBk = path.join(os.tmpdir(), 'tg-bk-dir-' + stamp);
process.env.DB_PATH = tmpDb;
process.env.BK_DIR = tmpBk;   // 关键：备份写到临时目录，不碰用户的真实备份

const store = await import('../app/server/store.mjs');
const backup = await import('../app/server/backup.mjs');

function rec(over) {
  return Object.assign({
    channel: 'bkchan', msgId: 1, date: '2026-01-01', ts: 1767225600, views: 0, media: '',
    text: '备份测试用的帖子内容，足够长以便被检索到', category: '实用工具',
    categories: '实用工具', tags: '免费', hashtags: '', value: 5, content: 3,
    url: 'https://t.me/bkchan/1', links: '', domains: '', lpTitle: '', source: 'channel',
  }, over);
}

after(() => {
  store.close();
  for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }
  try { fs.rmSync(tmpBk, { recursive: true, force: true }); } catch (e) {}
});

test('备份：创建后能被列出，且快照内容正确', () => {
  store.insertPost(rec({ msgId: 1 }));
  store.insertPost(rec({ msgId: 2, text: '第二条备份测试内容，用于验证快照内条数' }));

  const before = store.liveCount();
  assert.equal(before, 2);

  const r = backup.createBackup('单元测试');
  assert.ok(r.id, '应返回备份 id');
  assert.equal(r.posts, 2, '快照内条数应与库内一致');
  assert.ok(r.dbMB >= 0);

  const dir = path.join(backup.BK_DIR, r.id);
  assert.ok(fs.existsSync(path.join(dir, 'intel.db')), '应写出数据库文件');
  assert.ok(fs.existsSync(path.join(dir, 'info.json')), '应写出元信息');

  const list = backup.listBackups();
  const hit = list.find(x => x.id === r.id);
  assert.ok(hit, '列表里应包含刚创建的备份');
  assert.equal(hit.label, '单元测试');
  assert.equal(hit.posts, 2);
});

test('备份：快照是可用且完整的数据库，不是空壳', () => {
  const items = backup.listBackups();
  assert.ok(items.length > 0);
  const dir = path.join(backup.BK_DIR, items[0].id);
  const raw = fs.readFileSync(path.join(dir, 'intel.db'));
  assert.ok(raw.length > 0);
  assert.equal(raw.slice(0, 15).toString('utf8'), 'SQLite format 3', '应是合法 SQLite 文件');
});

test('备份：非法 id 被拒绝，删除生效', () => {
  assert.throws(() => backup.deleteBackup('../etc'), /非法备份 id/);
  const r = backup.createBackup('待删除');
  assert.equal(backup.deleteBackup(r.id), true);
  assert.equal(backup.listBackups().find(x => x.id === r.id), undefined);
  assert.equal(backup.deleteBackup(r.id), false, '重复删除返回 false');
});
