import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-netdisk-ai-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.NODE_ENV = 'test';

// 真实 settings.json 里已配置模型，这里 mock 成「有模型但输出解析不出来」，
// 用来复现「解析全失败 → 批次不变 → 无限空转」这条路径。
const realAi = await import('../../app/server/ai.mjs');
let calls = 0;
mock.module(new URL('../../app/server/ai.mjs', import.meta.url), {
  exports: {
    ...realAi,
    hasKey: () => true,
    completeLLM: async () => { calls++; return '模型抽风了，这一行解析不出来'; },
  },
});

const store = await import('../../app/server/store.mjs');
for (let i = 0; i < 3; i++) {
  store.netdiskUpsert({ platform: 'quark', shareKey: 'ai' + i, shareUrl: 'https://pan.quark.cn/s/ai' + i, title: '资源' + i, postId: 100 + i, channel: 'c', postDate: '2026-10-10', postUrl: '', value: 1 });
}
assert.equal(store.netdiskPendingCount(), 3);

const aiJob = await import('../../app/server/netdisk-ai.mjs');

after(() => {
  mock.restoreAll();
  store.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
});

test('模型输出无法解析时不会无限空转', async () => {
  const started = Date.now();
  const r = await aiJob.runOrganize({ limit: 3 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 20000, 'runOrganize spun for ' + elapsed + 'ms');
  assert.equal(r.done, 0);
  assert.equal(r.skipped, 3);
  assert.equal(calls, 1, 'should stop after the first unparseable batch');
  assert.equal(store.netdiskPendingCount(), 3, 'nothing should have been written');
});
