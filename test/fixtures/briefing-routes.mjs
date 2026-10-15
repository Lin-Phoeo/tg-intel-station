import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-briefing-route-'));
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const value = probe.address().port;
    probe.close(() => resolve(value));
  });
});
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.PORT = String(port);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return nativeFetch(input, options);
  throw new Error('network forbidden in briefing route tests');
};
process.env.NODE_ENV = 'test';
const store = await import('../../app/server/store.mjs');
const stateBefore = store.getState('briefing:latest', '');
const lastDateBefore = store.getState('briefing:lastDate', '');
const lastSyncBefore = (await import('../../app/server/sync.mjs')).getSyncStatus().lastSync;
const botModule = await import('../../app/server/bot.mjs');
const botConfigBefore = botModule.loadConfig();
const toastCalls = [];
mock.module(new URL('../../app/server/notify.mjs', import.meta.url), {
  exports: { toast: async (title, body) => { toastCalls.push({ title, body }); return true; } },
});

const cat = '实用工具', channel = 'selection-test';
const ids = [];
function add(over = {}) {
  const n = ids.length + 1;
  const r = store.insertPost({
    channel, msgId: n, date: '2026-10-10', ts: 1791580000 + n,
    text: 'routes fixture database body ' + n, category: cat, categories: cat,
    tags: '免费,开源', value: 6, url: 'https://example.com/' + n,
    links: 'https://example.com/' + n, ...over,
  });
  ids.push(r.id);
  return r.id;
}
ids.push(add());
ids.push(add({ category: '其他' }));
ids.push(add({ tags: '开源' }));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverModule = await import('../../app/server/index.mjs');
const server = serverModule.server;
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const base = 'http://127.0.0.1:' + port;
const json = async (route, body) => {
  const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

after(async () => {
  mock.restoreAll();
  await new Promise(resolve => server.close(resolve));
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('preview route filters with category/channel/tags/minValue/date AND', async () => {
  const result = await json('/api/briefing/preview', { filters: {
    category: cat, channel, tags: ['免费', '开源'], minValue: 5,
    from: '2026-10-10', to: '2026-10-10',
  } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.candidates.map(x => x.id), [ids[0]]);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.candidates[0].text, 'routes fixture database body 1');
});

test('selected generation ignores injected bodies, duplicates, stale and mismatched IDs', async () => {
  const result = await json('/api/briefing/generate-selected', { filters: {
    category: cat, channel, tags: ['免费', '开源'], minValue: 5,
    from: '2026-10-10', to: '2026-10-10', pushLimit: 8,
  }, selectedIds: [ids[0], ids[0], ids[1], 999999], items: [{ id: ids[1], text: 'FORGED' }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.briefing.items.map(x => x.id), [ids[0]]);
  assert.equal(result.body.briefing.items[0].text, 'routes fixture database body 1');
});

test('invalid filter/date/ID payload returns 400; empty selection remains empty', async () => {
  for (const payload of [
    { filters: [], selectedIds: [] },
    { filters: { from: '2026-99-90' }, selectedIds: [] },
    { filters: { from: '2026-02-31' }, selectedIds: [] },
    { filters: { from: '2026-10-11', to: '2026-10-10' }, selectedIds: [] },
    { filters: { tags: 'free' }, selectedIds: [] },
    { filters: {}, selectedIds: 'not-an-array' },
  ]) {
    const route = payload.selectedIds === undefined ? '/api/briefing/preview' : '/api/briefing/generate-selected';
    const result = await json(route, payload);
    assert.equal(result.status, 400, JSON.stringify(payload) + ' => ' + JSON.stringify(result.body));
    assert.equal(result.body.ok, false);
  }
  const before = toastCalls.length;
  const empty = await json('/api/briefing/generate-selected', { filters: {}, selectedIds: [] });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.briefing.count, 0);
  assert.equal(toastCalls.length, before + 1);
  assert.equal(store.getState('briefing:latest', ''), stateBefore);
  assert.equal(store.getState('briefing:lastDate', ''), lastDateBefore);
  assert.deepEqual(botModule.loadConfig(), botConfigBefore);
  assert.deepEqual((await import('../../app/server/sync.mjs')).getSyncStatus().lastSync, lastSyncBefore);
});
