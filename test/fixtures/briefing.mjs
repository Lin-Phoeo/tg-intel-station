import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-briefing-'));
process.env.DB_PATH = path.join(dir, 'test.db');
globalThis.fetch = async () => { throw new Error('network forbidden in briefing tests'); };
const store = await import('../../app/server/store.mjs');
const bot = await import('../../app/server/bot.mjs');

// notify 用替身记录调用；briefing 必须在 mock 注册之后导入。
// 注意：所有顶层 await 必须在 after()/test() 注册之前 —— 否则顶层 await 会让
// after 钩子在模块求值中途触发（关库+清临时目录），后续用例全部打不开库。
const O = { windowDays: 4, pushTags: ['免费'], pushMinValue: 5, pushLimit: 8, aiDigest: false, skipSync: true };
const toastCalls = [];
let notifyFails = false;
let summaryCalls = 0;
const summaryReleases = [];
let syncCalls = 0;
let syncState = { running: false, lastSync: null };
let syncResult = { ok: true, imported: 0, scanned: 0, sources: 0, failed: 0, failedSources: [] };
let syncStartError = '';
mock.module(new URL('../../app/server/sync.mjs', import.meta.url), {
  exports: {
    isRunning: () => syncState.running,
    getSyncStatus: () => syncState,
    startFullSync: opts => {
      syncCalls++;
      if (syncStartError) return { ok: false, started: false, error: syncStartError };
      syncState = { running: true, lastSync: syncState.lastSync };
      const promise = new Promise(resolve => {
        syncResult.release = () => {
          syncState = { running: false, lastSync: { date: new Date().toISOString().slice(0, 10), finishedAt: new Date().toISOString() } };
          syncResult = { ok: true, imported: 1, scanned: 7, sources: 2, failed: 1, failedSources: [{ id: 'broken-source', error: 'fixture timeout' }] };
          resolve({ ...syncResult });
        };
      });
      return { ok: true, started: true, completion: promise };
    },
  },
});
mock.module(new URL('../../app/server/notify.mjs', import.meta.url), {
  exports: { toast: async (title, body) => {
    toastCalls.push({ title, body });
    return !notifyFails;
  } },
});
mock.module(new URL('../../app/server/bot.mjs', import.meta.url), {
  exports: { ...bot, loadConfig: () => ({ ...O, pushHour: 9, pushedIds: [999999] }),
    digestSummary: async () => {
      summaryCalls++;
      await new Promise(resolve => { summaryReleases.push(resolve); });
      return '合成 AI 导读';
    } },
});
const ai = await import('../../app/server/ai.mjs');
mock.module(new URL('../../app/server/ai.mjs', import.meta.url), {
  exports: { ...ai, hasKey: () => true },
});
const briefing = await import('../../app/server/briefing.mjs');

const DAY = 86400000;
const NOW = Date.now();
const iso = (t) => new Date(t).toISOString().slice(0, 10);
let n = 0;
function add(over = {}) {
  n++;
  return store.insertPost({
    channel: 'brief', msgId: n, date: iso(NOW - DAY), ts: Math.floor(NOW / 1000) - 86400,
    text: 'briefkey 简报候选条目，正文长度足够用于筛选与展示验证',
    category: '实用工具', categories: '实用工具', tags: '免费', value: 6,
    links: 'https://example.com/b/' + n, domains: 'example.com', ...over,
  }).id;
}
const idA = add();                                                                  // value 6，近 1 天
const idB = add({ value: 8 });                                                      // value 8
const idC = add({ value: 8, date: iso(NOW - 6 * DAY), ts: Math.floor(NOW / 1000) - 6 * 86400 }); // 窗口外
const idD = add({ value: 3 });                                                      // 低于 minValue

after(() => {
  mock.restoreAll();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('selectDigestItems：窗口/标签/分数过滤，按价值降序', () => {
  const items = bot.selectDigestItems(O);
  assert.deepEqual(items.map(x => x.id), [idB, idA]);
});

test('generateIfDue：未到点不生成，到点生成一次并通知，同日不重复', async () => {
  const at8 = new Date(); at8.setHours(8, 0, 0, 0);
  const at9 = new Date(); at9.setHours(9, 30, 0, 0);
  let r = await briefing.generateIfDue(at8, { pushHour: 9, ...O });
  assert.equal(r.skipped, 'before-hour');
  r = await briefing.generateIfDue(at9, { pushHour: 9, ...O });
  assert.ok(r.generated);
  assert.equal(r.generated.count, 2);
  assert.equal(toastCalls.length, 1);
  assert.match(toastCalls[0].title, /2 条/);
  r = await briefing.generateIfDue(new Date(), { pushHour: 9, ...O });
  assert.equal(r.skipped, 'already');
  assert.equal(toastCalls.length, 1);
  const latest = briefing.getLatest();
  assert.equal(latest.count, 2);
  assert.equal(latest.items[0].value, 8);
});

test('空语料：生成成功、通知文案合理', async () => {
  const d = await briefing.generate({ ...O, pushTags: ['不存在的标签'], pushMinValue: 9 });
  assert.equal(d.count, 0);
  assert.ok(toastCalls[toastCalls.length - 1].body.includes('没有'));
});

test('并发触发不崩溃，后写覆盖且可解析', async () => {
  const [a, b] = await Promise.all([briefing.generate(O), briefing.generate(O)]);
  assert.equal(a.count, 2);
  assert.equal(b.count, 2);
  const latest = briefing.getLatest();
  assert.ok(latest && Array.isArray(latest.items) && latest.items.length === 2);
});

test('跨日补跑使用传入的本地日期，同一日不再生成', async () => {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 1, 0, 0);
  const p = n => String(n).padStart(2, '0');
  const expected = tomorrow.getFullYear() + '-' + p(tomorrow.getMonth() + 1) + '-' + p(tomorrow.getDate());
  const r = await briefing.generateIfDue(tomorrow, O);
  assert.equal(r.generated.date, expected);
  assert.equal((await briefing.generateIfDue(tomorrow, O)).skipped, 'already');
});

test('AI 生成中并发触发只调用一次导读和通知', async () => {
  const before = toastCalls.length;
  const first = briefing.generate({ ...O, aiDigest: true });
  const second = briefing.generate({ ...O, aiDigest: true });
  const calls = summaryCalls;
  summaryReleases.splice(0).forEach(resolve => resolve());
  const result = await first;
  assert.equal(calls, 1);
  assert.deepEqual(await second, result);
  assert.equal(toastCalls.length, before + 1);
});

test('通知失败不影响简报保存和成功返回', async () => {
  notifyFails = true;
  try {
    const r = await briefing.generate(O);
    assert.equal(r.count, 2);
    assert.equal(briefing.getLatest().generatedAt, r.generatedAt);
  } finally { notifyFails = false; }
});

test('日报生成不会自动启动同步，需用户先手动同步', async () => {
  store.setState('briefing:lastDate', '');
  syncState = { running: false, lastSync: null };
  syncCalls = 0;
  const at9 = new Date(); at9.setHours(9, 30, 0, 0);
  const result = await briefing.generateIfDue(at9, { pushHour: 9, ...O });
  assert.equal(result.generated.count, 2);
  assert.equal(syncCalls, 0);
});

test('选择性预览支持日期、分类、频道、标签和分数的 AND 筛选', () => {
  const ids = [
    add({ category: '实用工具', channel: 'wanted', date: iso(NOW - DAY), tags: '开源,免费', value: 7 }),
    add({ category: '学习资源', channel: 'wanted', date: iso(NOW - DAY), tags: '开源,免费', value: 7 }),
    add({ category: '实用工具', channel: 'other', date: iso(NOW - DAY), tags: '开源,免费', value: 7 }),
    add({ category: '实用工具', channel: 'wanted', date: iso(NOW - 8 * DAY), tags: '开源,免费', value: 7 }),
    add({ category: '实用工具', channel: 'wanted', date: iso(NOW - DAY), tags: '开源', value: 7 }),
    add({ category: '实用工具', channel: 'wanted', date: iso(NOW - DAY), tags: '开源,免费', value: 4 }),
  ];
  const filters = { category: '实用工具', channel: 'wanted', tags: ['开源', '免费'], minValue: 5,
    from: iso(NOW - 2 * DAY), to: iso(NOW - DAY), pushLimit: 8 };
  assert.deepEqual(briefing.previewSelection(filters).items.map(x => x.id), [ids[0]]);
});

test('选择性预览包含日期起止边界', () => {
  const low = add({ date: iso(NOW - 2 * DAY), category: '边界', channel: 'boundary', tags: '边界', value: 5 });
  const high = add({ date: iso(NOW - DAY), category: '边界', channel: 'boundary', tags: '边界', value: 6 });
  const result = briefing.previewSelection({ category: '边界', channel: 'boundary', tags: ['边界'], minValue: 5,
    from: iso(NOW - 2 * DAY), to: iso(NOW - DAY) });
  assert.deepEqual(new Set(result.items.map(x => x.id)), new Set([low, high]));
  assert.equal(result.count, 2);
});

test('选择性生成只包含当前筛选中的去重 ID 和数据库正文，不覆盖自动简报状态', async () => {
  const allowed = add({ category: '选择', channel: 'selected', tags: '免费', value: 9, text: '数据库可信正文内容，用于确认返回值来自数据库' });
  const rejected = add({ category: '别类', channel: 'selected', tags: '免费', value: 10, text: '筛选外条目' });
  store.setState('briefing:latest', 'automatic-latest-marker');
  store.setState('briefing:lastDate', 'automatic-date-marker');
  const beforeConfig = bot.loadConfig();
  const result = await briefing.generateSelection({ category: '选择', channel: 'selected', tags: ['免费'], minValue: 5,
    from: iso(NOW - 2 * DAY), to: iso(NOW), pushLimit: 8 },
  [allowed, allowed, rejected, 999999], NOW);
  assert.deepEqual(result.items.map(x => x.id), [allowed]);
  assert.match(result.items[0].text, /数据库可信正文/);
  assert.doesNotMatch(result.items[0].text, /客户端伪造/);
  assert.equal(store.getState('briefing:latest'), 'automatic-latest-marker');
  assert.equal(store.getState('briefing:lastDate'), 'automatic-date-marker');
  assert.deepEqual(bot.loadConfig(), beforeConfig);
});

test('空选择不生成 AI 导读且通知和结果保持为空', async () => {
  const before = toastCalls.length;
  const calls = summaryCalls;
  const result = await briefing.generateSelection(O, [], NOW);
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  assert.equal(summaryCalls, calls);
  assert.equal(toastCalls.length, before + 1);
});
