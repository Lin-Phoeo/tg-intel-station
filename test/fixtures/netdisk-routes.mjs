import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-netdisk-route-'));
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.PORT = String(port);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, options);
  throw new Error('network forbidden in netdisk route tests');
};
process.env.NODE_ENV = 'test';

// 真实 settings.json 里已配置模型，会让 /api/netdisk/ai 真的启动后台任务。
// 这里 mock 掉 hasKey，让「未配置模型」这条分支确定可测。
const realAi = await import('../../app/server/ai.mjs');
mock.module(new URL('../../app/server/ai.mjs', import.meta.url), {
  exports: { ...realAi, hasKey: () => false },
});

const store = await import('../../app/server/store.mjs');
store.netdiskUpsert({ platform: 'quark', shareKey: 'aaa', shareUrl: 'https://pan.quark.cn/s/aaa', pwd: 'k9m2', title: '洛雪音乐', postId: 1, channel: 'c1', postDate: '2026-10-10', postUrl: 'https://t.me/c1/1', value: 6 });
store.netdiskUpsert({ platform: 'baidu', shareKey: 'bbb', shareUrl: 'https://pan.baidu.com/s/bbb', title: '教程合集', postId: 2, channel: 'c2', postDate: '2026-10-09', postUrl: 'https://t.me/c2/2', value: 5 });
// 超过列表分页上限（100）的批量数据，用来证明导出不会被截断
for (let i = 0; i < 120; i++) {
  store.netdiskUpsert({ platform: 'pan123', shareKey: 'exp' + i, shareUrl: 'https://www.123pan.com/s/exp' + i, title: '导出' + i, postId: 5000 + i, channel: 'c9', postDate: '2026-10-01', postUrl: '', value: 1 });
}
// 以公式开头的外部标题，验证 CSV 会中和公式注入
store.netdiskUpsert({ platform: 'ctfile', shareKey: 'evil1', shareUrl: 'https://545c.com/f/evil1', title: '=SUM(1,1)', postId: 6001, channel: 'c9', postDate: '2026-10-01', postUrl: '', value: 1 });

const serverModule = await import('../../app/server/index.mjs');
const server = serverModule.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
const base = 'http://127.0.0.1:' + port;
const get = async (route) => { const r = await fetch(base + route); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };

after(async () => {
  mock.restoreAll();
  await new Promise(r => server.close(r));
  store.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
});

test('GET /api/netdisk 返回条目并按分页上限截断', async () => {
  const r = await get('/api/netdisk');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.text);
  assert.equal(j.total, 123);
  assert.equal(j.items.length, 30);
});

test('GET /api/netdisk 按平台筛选', async () => {
  const j = JSON.parse((await get('/api/netdisk?platform=baidu')).text);
  assert.equal(j.total, 1);
  assert.equal(j.items[0].platform, 'baidu');
});

test('GET /api/netdisk 非法 size 被夹紧', async () => {
  const j = JSON.parse((await get('/api/netdisk?size=9999')).text);
  assert.ok(j.size <= 100);
});

test('GET /api/netdisk/facets 返回平台计数与中文名', async () => {
  const j = JSON.parse((await get('/api/netdisk/facets')).text);
  assert.equal(j.total, 123);
  assert.ok(j.platforms.some(p => p.k === 'quark'));
  assert.equal(j.platforms.find(p => p.k === 'quark').label, '夸克网盘');
});

test('GET /api/netdisk/:id 返回详情与全部来源', async () => {
  const id = JSON.parse((await get('/api/netdisk')).text).items[0].id;
  const j = JSON.parse((await get('/api/netdisk/' + id)).text);
  assert.equal(j.id, id);
  assert.ok(Array.isArray(j.sources));
});

test('GET /api/netdisk/:id 不存在返回 404', async () => {
  assert.equal((await get('/api/netdisk/999999')).status, 404);
});

test('GET /api/netdisk/export 返回 Markdown 附件', async () => {
  const r = await get('/api/netdisk/export?format=md');
  assert.equal(r.status, 200);
  assert.ok(r.type.includes('text/markdown'));
  assert.ok(r.text.includes('洛雪音乐'));
  assert.ok(r.text.includes('pan.quark.cn/s/aaa'));
});

test('GET /api/netdisk/export CSV 含表头', async () => {
  const r = await get('/api/netdisk/export?format=csv');
  assert.ok(r.type.includes('text/csv'));
  assert.ok(r.text.split('\n')[0].includes('platform'));
});

test('GET /api/netdisk/export 导出全部筛选结果，不受 100 条上限', async () => {
  const r = await get('/api/netdisk/export?format=md');
  assert.ok(r.text.includes('共 123 条'), 'export truncated: ' + r.text.slice(0, 120));
  assert.ok(r.text.includes('导出119'), 'missing row beyond the first 100');
});

test('GET /api/netdisk/export CSV 中和公式注入', async () => {
  const r = await get('/api/netdisk/export?format=csv');
  assert.ok(r.text.includes("'=SUM(1,1)"), 'formula not neutralized');
});

test('POST /api/netdisk/scan 启动扫描', async () => {
  const r = await fetch(base + '/api/netdisk/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'incremental' }) });
  const j = await r.json();
  assert.equal(j.ok, true);
});

test('POST /api/netdisk/ai 无模型时给出明确错误', async () => {
  const r = await fetch(base + '/api/netdisk/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5 }) });
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.ok(j.error);
});
