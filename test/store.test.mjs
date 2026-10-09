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

test('search: 2 字词也走 FTS（单字分词后不再退化）', () => {
  const r = store.search({ q: '开源', size: 10 });
  assert.equal(r.mode, 'fts');
  assert.ok(r.items.some(x => x.text.includes('开源')));
});

test('search: 2 字词不会误命中不连续的相同字', () => {
  store.insertPost(rec({ msgId: 30, channel: 'phrasechan', text: '开端与源头，两字并不相邻' }));
  const r = store.search({ q: '开源', size: 50, collapse: false });
  assert.ok(!r.items.some(x => x.text.includes('开端与源头')), '「开」「源」不相邻不应命中');
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

test('同事件聚簇：同链接归到同一代表，默认折叠但可展开', () => {
  const a = store.insertPost(rec({ msgId: 10, text: '聚簇测试第一条 事件描述', links: 'https://example.com/news/1', domains: 'example.com' }));
  const b = store.insertPost(rec({ msgId: 11, channel: 'otherchan', text: '聚簇测试第二条 另一个频道发的同一事件', links: 'https://example.com/news/1', domains: 'example.com' }));
  assert.equal(a.clustered, false);
  assert.equal(b.clustered, true);
  assert.equal(b.repId, a.id);

  const r = store.search({ q: '聚簇测试', size: 20 });
  const ids = r.items.map(x => x.id);
  assert.ok(ids.includes(a.id), '代表条目应出现');
  assert.ok(!ids.includes(b.id), '非代表条目应被折叠');
  const rep = r.items.find(x => x.id === a.id);
  assert.equal(rep.clusterSize, 2);

  const members = store.clusterMembers(a.id);
  assert.equal(members.length, 2);

  const r2 = store.search({ q: '聚簇测试', size: 20, collapse: false });
  assert.ok(r2.items.map(x => x.id).includes(b.id), '关闭折叠后两条都应出现');
});

test('聚簇：个人主页链接不参与聚合', () => {
  const a = store.insertPost(rec({ msgId: 20, text: '主页链接测试甲', links: 'https://t.me/someuser' }));
  const b = store.insertPost(rec({ msgId: 21, channel: 'chan2', text: '主页链接测试乙', links: 'https://t.me/someuser' }));
  assert.equal(a.clustered, false);
  assert.equal(b.clustered, false);
  assert.equal(a.clusterSize, 1);
  assert.equal(b.clusterSize, 1);
});

test('收藏：落库、带标签、可删除', () => {
  const r = store.insertPost(rec({ msgId: 40, text: '收藏测试用帖' }));
  assert.equal(store.isFavorite(r.id), false);
  store.addFavorite(r.id, ['待研究', '工具'], '备注内容');
  assert.equal(store.isFavorite(r.id), true);
  const list = store.listFavorites();
  const hit = list.find(x => x.id === r.id);
  assert.ok(hit, '收藏列表应包含该帖');
  assert.deepEqual(hit.favTags, ['待研究', '工具']);
  assert.equal(hit.favNote, '备注内容');
  assert.ok(hit.text.includes('收藏测试用帖'), '收藏应带完整正文');
  assert.ok(store.favoriteIds().includes(r.id));
  assert.equal(store.removeFavorite(r.id), true);
  assert.equal(store.isFavorite(r.id), false);
});

test('收藏：重复添加同一帖不会产生多条', () => {
  const r = store.insertPost(rec({ msgId: 41, text: '收藏去重用帖' }));
  store.addFavorite(r.id, ['a']);
  store.addFavorite(r.id, ['b']);
  assert.equal(store.listFavorites().filter(x => x.id === r.id).length, 1);
  assert.deepEqual(store.listFavorites().find(x => x.id === r.id).favTags, ['b']);
  store.removeFavorite(r.id);
});

test('订阅：增删改查与命中检查', () => {
  const id = store.upsertSubscription({ keyword: '聚簇测试', minValue: 0, tags: [] });
  assert.ok(id > 0);
  let subs = store.listSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].enabled, true);

  const hits = store.checkSubscriptions(0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].keyword, '聚簇测试');
  assert.ok(hits[0].count >= 1, '应能命中此前插入的聚簇测试内容');

  store.markSubscriptionHit(id, hits[0].count);
  assert.equal(store.listSubscriptions()[0].hitCount, hits[0].count);

  store.upsertSubscription({ id: id, keyword: '聚簇测试', enabled: false });
  assert.equal(store.listSubscriptions()[0].enabled, false);
  assert.equal(store.checkSubscriptions(0).length, 0, '暂停的订阅不参与检查');

  assert.equal(store.removeSubscription(id), true);
  assert.equal(store.listSubscriptions().length, 0);
});

test('应用状态：读写与默认值', () => {
  assert.equal(store.getState('nope', 'def'), 'def');
  assert.equal(store.getState('nope'), null);
  store.setState('lastVisit', '1700000000');
  assert.equal(store.getState('lastVisit'), '1700000000');
  store.setState('lastVisit', '1800000000');
  assert.equal(store.getState('lastVisit'), '1800000000');
});

test('search: since 按时间戳过滤', () => {
  const now = Math.floor(Date.now() / 1000);
  const old = store.search({ q: '', size: 1, since: now + 86400 });
  assert.equal(old.total, 0, '未来时间点应无结果');
  const past = store.search({ q: '', size: 1, since: now - 86400 * 36500 });
  assert.ok(past.total > 0, '很久以前的时间点应包含全部');
});

test('向量：存入、读回、统计与清理', async () => {
  const { normalize, quantizeInt8, normInt8, toBuffer } = await import('../core/vector.mjs');
  const a = store.insertPost(rec({ msgId: 50, text: '向量化测试甲，内容足够长以便入选', value: 6 }));
  const b = store.insertPost(rec({ msgId: 51, text: '向量化测试乙，内容足够长以便入选', value: 5 }));
  const c = store.insertPost(rec({ msgId: 52, text: '低价值的帖子不该被向量化', value: 1 }));

  const need = store.postsNeedingEmbedding(50, 4).map(x => x.id);
  assert.ok(need.includes(a.id) && need.includes(b.id), '达标帖子应待向量化');
  assert.ok(!need.includes(c.id), '低价值帖子不应被纳入');

  const mk = (v) => { const q = quantizeInt8(normalize(v)); return { vec: toBuffer(q), dim: q.length, norm: normInt8(q) }; };
  store.saveEmbeddings([
    Object.assign({ id: a.id, model: 'test-model' }, mk([1, 0, 0, 1])),
    Object.assign({ id: b.id, model: 'test-model' }, mk([0, 1, 1, 0])),
  ]);

  const stats = store.embedStats();
  assert.equal(stats.indexed, 2);
  assert.equal(stats.dim, 4);
  assert.equal(stats.model, 'test-model');

  const loaded = store.loadEmbeddings();
  assert.equal(loaded.length, 2);
  const got = loaded.find(x => x.id === a.id);
  assert.equal(got.vec.length, 4, 'int8 向量应无损读回');
  assert.ok(got.norm > 0);

  assert.equal(store.postsNeedingEmbedding(50, 4).map(x => x.id).includes(a.id), false, '已索引的不应再出现');

  const posts = store.getPostsByIds([a.id, c.id]);
  assert.equal(posts.length, 2);

  store.clearEmbeddings();
  assert.equal(store.embedStats().indexed, 0);
});

test('来源登记可增删查', () => {
  store.upsertSource({ id: 'somechan', kind: 'channel', title: '测试频道' });
  assert.ok(store.listSources().some(s => s.id === 'somechan'));
  store.upsertSource({ id: 'somechan', kind: 'channel', title: '改名后' });
  assert.equal(store.getSource('somechan').title, '改名后');
  assert.equal(store.removeSource('somechan'), true);
  assert.equal(store.getSource('somechan'), null);
});
