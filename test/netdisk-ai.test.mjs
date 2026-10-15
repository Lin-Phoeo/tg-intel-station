import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ND_CATS, buildPrompt, parseAnswer } from '../app/server/netdisk-ai.mjs';

const rows = [
  { id: 11, title: '洛雪音乐绿色版', text: '🙂标题：洛雪音乐 聚合多平台音乐搜索' },
  { id: 12, title: 'PS 2024 安装包', text: '🙂标题：PS 2024 设计素材' },
];

test('ND_CATS 是固定类别集', () => {
  assert.ok(ND_CATS.includes('软件工具'));
  assert.ok(ND_CATS.includes('其他'));
  assert.equal(ND_CATS.length, 10);
});

test('buildPrompt 包含类别集与每条序号', () => {
  const p = buildPrompt(rows);
  assert.ok(p.includes('软件工具'));
  assert.ok(p.includes('1. '));
  assert.ok(p.includes('2. '));
  assert.ok(p.includes('洛雪音乐'));
});

test('parseAnswer 解析定长行', () => {
  const out = parseAnswer('1|软件工具|音乐,开源|聚合多平台音乐搜索|洛雪音乐\n2|软件工具|设计,素材|PS 安装包|PS2024安装包', rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 11);
  assert.equal(out[0].category, '软件工具');
  assert.equal(out[0].tags, '音乐,开源');
  assert.equal(out[1].aiTitle, 'PS2024安装包');
});

test('parseAnswer 越界类别归一为其他、坏行跳过', () => {
  const out = parseAnswer('1|随便编的类|标签|简介|标题\n这一行是废话\n2|影视|电影|高清资源|某电影', rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].category, '其他');
  assert.equal(out[1].category, '影视');
});

test('parseAnswer 空输入返回空数组', () => {
  assert.deepEqual(parseAnswer('', rows), []);
  assert.deepEqual(parseAnswer(null, rows), []);
});

test('AI 整理在解析全失败时停止而不是空转', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath, [
    '--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./fixtures/netdisk-ai-loop.mjs', import.meta.url)),
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  if (!/ℹ pass [1-9]/.test(out)) throw new Error('ai loop fixture did not execute tests:\n' + out);
});
