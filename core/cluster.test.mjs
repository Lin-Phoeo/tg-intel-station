import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterKey, normalizeUrl, isProfileLink } from '../core/cluster.mjs';

test('normalizeUrl: 去 www、去尾斜杠、丢跟踪参数', () => {
  assert.equal(normalizeUrl('https://www.github.com/a/b/'), 'github.com/a/b');
  assert.equal(normalizeUrl('https://example.com/a/b?utm_source=x&fbclid=y'), 'example.com/a/b');
});

test('normalizeUrl: 单段路径即使带跟踪参数也保守放弃（宁可漏聚合不可错并）', () => {
  assert.equal(normalizeUrl('https://example.com/x?utm_source=a'), null);
});

test('normalizeUrl: 保留内容标识参数（?v= ?id=）', () => {
  assert.equal(normalizeUrl('https://www.youtube.com/watch?v=AbC'), 'youtube.com/watch?v=AbC');
  assert.notEqual(normalizeUrl('https://youtube.com/watch?v=A'), normalizeUrl('https://youtube.com/watch?v=B'));
  assert.equal(normalizeUrl('https://play.google.com/store/apps/details?id=com.x&hl=zh'), 'play.google.com/store/apps/details?hl=zh&id=com.x');
  assert.notEqual(normalizeUrl('https://play.google.com/store/apps/details?id=com.a'), normalizeUrl('https://play.google.com/store/apps/details?id=com.b'));
});

test('normalizeUrl: 单段路径且无有效查询 -> null（个人主页/通用页）', () => {
  assert.equal(normalizeUrl('https://example.com'), null);
  assert.equal(normalizeUrl('https://hostloc.com/home.php'), null);
  assert.equal(normalizeUrl('https://my.frantech.ca/cart.php'), null);
  assert.equal(normalizeUrl('https://x.com/appdotg'), null);
});

test('normalizeUrl: 多段路径保留', () => {
  assert.equal(normalizeUrl('https://ithome.com/0/123/456.htm'), 'ithome.com/0/123/456.htm');
  assert.equal(normalizeUrl('https://github.com/a/b'), 'github.com/a/b');
});

test('clusterKey: linux.do 话题优先，两个镜像链接同键', () => {
  const a = clusterKey(['https://t.me/lezishen', 'https://linux.do/t/topic/2988963/21']);
  const b = clusterKey(['https://linux.do/t/topic/2988963']);
  assert.equal(a, 'topic:2988963');
  assert.equal(b, 'topic:2988963');
});

test('clusterKey: 不同视频不再并成一条（回归）', () => {
  assert.notEqual(clusterKey(['https://youtube.com/watch?v=aaa']), clusterKey(['https://youtube.com/watch?v=bbb']));
});

test('clusterKey: 通用页面不聚合（回归）', () => {
  assert.equal(clusterKey(['https://hostloc.com/home.php']), null);
  assert.equal(clusterKey(['https://x.com/appdotg']), null);
  assert.equal(clusterKey(['https://my.frantech.ca/cart.php']), null);
});

test('clusterKey: 个人主页不参与，改用真实资源链接', () => {
  assert.equal(clusterKey(['https://t.me/someuser', 'https://github.com/a/b']), 'link:github.com/a/b');
  assert.equal(clusterKey(['https://t.me/someuser', 'https://t.me/somechannel']), null);
});

test('clusterKey: 相同文章链接聚成一簇', () => {
  assert.equal(clusterKey(['https://www.ithome.com/0/123/456.htm']), clusterKey(['https://ithome.com/0/123/456.htm?utm_source=x']));
});

test('clusterKey: 引用多个话题时放弃聚合（回归）', () => {
  assert.equal(clusterKey(['https://linux.do/t/topic/188813', 'https://linux.do/t/topic/188814']), null);
  assert.equal(clusterKey(['https://linux.do/t/topic/188813/2', 'https://linux.do/t/topic/188813']), 'topic:188813');
});

test('clusterKey: 排除搜索页（回归）', () => {
  assert.equal(clusterKey(['https://m.weibo.cn/search?containerid=231522type%3D1&q=%23ai%23']), null);
  assert.equal(clusterKey(['https://example.com/search/abc']), null);
});

test('clusterKey: 排除 t.me 帖子链接（签名/互推，回归）', () => {
  assert.equal(clusterKey(['https://t.me/chunse1024/8467']), null);
  assert.equal(clusterKey(['https://t.me/recommend3/64']), null);
});

test('clusterKey: 空与异常输入不崩', () => {
  assert.equal(clusterKey([]), null);
  assert.equal(clusterKey(null), null);
  assert.equal(clusterKey([null, undefined, '']), null);
});

test('isProfileLink', () => {
  assert.equal(isProfileLink('https://t.me/abcdef'), true);
  assert.equal(isProfileLink('https://t.me/abcdef/123'), false);
});
