import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('本地简报：筛选/生成/去重/补跑/通知', () => {
  // 必须剥掉 NODE_TEST_CONTEXT：测试子进程继承它会让嵌套的 node --test 静默空跑
  // （0 个测试、退出码 0，包装器假绿）。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath, [
    '--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./fixtures/briefing.mjs', import.meta.url)),
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 30000, env });
  if (!/ℹ pass [1-9]/.test(out)) throw new Error('fixture 未真正执行测试：\n' + out);
});
