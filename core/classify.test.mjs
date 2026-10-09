import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../core/classify.mjs';

test('羊毛类内容归入羊毛优惠，并识别免费/限时标签', () => {
  const r = classify({ t: '免费领取 香港 VPS 优惠码，限时活动', lk: [], lp: [], v: 100 });
  assert.equal(r.primary, '羊毛优惠');
  assert.ok(r.tags.includes('免费'));
  assert.ok(r.tags.includes('限时'));
  assert.ok(r.value > 0);
});

test('GitHub 仓库归入开源项目并额外加分', () => {
  const withGh = classify({ t: '开源工具推荐 https://github.com/a/b', lk: ['https://github.com/a/b'], lp: [] });
  const noGh = classify({ t: '开源工具推荐', lk: [], lp: [] });
  assert.ok(withGh.cats.includes('开源项目'));
  assert.ok(withGh.value > noGh.value);
});

test('hashtag 参与分类打分', () => {
  const r = classify({ t: '一条没有任何关键词的帖子 #白嫖', lk: [], lp: [] });
  assert.equal(r.primary, '羊毛优惠');
  assert.ok(r.hashtags.includes('白嫖'));
});

test('黑产内容触发高 spam 分', () => {
  const r = classify({ t: '博彩 洗钱 跑分 接单', lk: [], lp: [] });
  assert.ok(r.spam >= 4, 'spam=' + r.spam);
  assert.ok(r.spamHits.length >= 2);
});

test('风险标签降低价值分', () => {
  const a = classify({ t: '免费领取 GPU 算力额度，限时活动', lk: [], lp: [] });
  const b = classify({ t: '免费领取 GPU 算力额度，限时活动 赌博', lk: [], lp: [] });
  assert.ok(b.tags.includes('风险'));
  assert.ok(b.value < a.value);
});

test('短链接刷屏会被加 spam 分', () => {
  const r = classify({ t: '看这里', lk: ['https://a.com/x'], lp: [] });
  assert.ok(r.spam >= 1);
});

test('空输入不崩溃且归入其他', () => {
  const r = classify({});
  assert.equal(r.primary, '其他');
  assert.equal(r.text, '');
  assert.equal(typeof r.value, 'number');
});
