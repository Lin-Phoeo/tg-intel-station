import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGram, splitTerms, decodeEntities, stripTags, normalizeText, fnv, domainOf } from '../core/text.mjs';

test('toGram: CJK 逐字空格化，ASCII 保持连续', () => {
  assert.equal(toGram('免费VPS加速'), '免 费 VPS 加 速');
  assert.equal(toGram('中转站'), '中 转 站');
  assert.equal(toGram('VPS'), 'VPS');
  assert.equal(toGram(''), '');
  assert.equal(toGram('claude-opus-4'), 'claude-opus-4');
});

test('toGram: 边界与空值', () => {
  assert.equal(toGram(null), '');
  assert.equal(toGram(undefined), '');
  assert.equal(toGram('   '), '');
  assert.equal(toGram('a b'), 'a b');
});

test('splitTerms: 中英标点都切分', () => {
  assert.deepEqual(splitTerms('免费 VPS'), ['免费', 'VPS']);
  assert.deepEqual(splitTerms('免费，VPS。加速'), ['免费', 'VPS', '加速']);
  assert.deepEqual(splitTerms('  '), []);
  assert.deepEqual(splitTerms('a/b'), ['a', 'b']);
});

test('decodeEntities: 常见实体与数字实体', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;'), '&<>"');
  assert.equal(decodeEntities('&#39;'), "'");
  assert.equal(decodeEntities('&#x4e2d;'), '中');
  assert.equal(decodeEntities(''), '');
});

test('stripTags: 保留换行、还原表情、去标签', () => {
  assert.equal(stripTags('a<br>b'), 'a\nb');
  assert.equal(stripTags('<div>a</div><div>b</div>'), 'a\nb');
  assert.equal(stripTags('<i class="emoji"><b>🦐</b></i>'), '🦐');
  assert.equal(stripTags('<b>粗</b>体'), '粗体');
});

test('normalizeText: 去零宽字符、压缩空白', () => {
  assert.equal(normalizeText('a\u200bb'), 'ab');
  assert.equal(normalizeText('a   b'), 'a b');
  assert.equal(normalizeText('a\n\n\nb'), 'a\nb');
});

test('fnv: 稳定且区分大小写', () => {
  assert.equal(fnv('abc'), fnv('abc'));
  assert.notEqual(fnv('abc'), fnv('abd'));
  assert.equal(typeof fnv('x'), 'number');
});

test('domainOf: 去 www、容忍协议相对地址', () => {
  assert.equal(domainOf('https://www.github.com/a'), 'github.com');
  assert.equal(domainOf('//cdn.example.com/x'), 'cdn.example.com');
  assert.equal(domainOf('not a url'), null);
});
