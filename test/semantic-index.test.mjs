import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const scenario of ['empty', 'default', 'min3', 'length', 'partial', 'model', 'dim', 'cache']) {
  test('向量待办和续跑：' + scenario, () => {
    // 必须剥掉 NODE_TEST_CONTEXT：测试子进程继承它会让嵌套的 node --test 静默空跑
    // （0 个测试、退出码 0，包装器假绿）。
    const env = { ...process.env, INDEX_SCENARIO: scenario };
    delete env.NODE_TEST_CONTEXT;
    const out = execFileSync(process.execPath, [
      '--experimental-test-module-mocks', '--test',
      fileURLToPath(new URL('./fixtures/semantic-index.mjs', import.meta.url)),
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 30000, env });
    if (!/ℹ pass [1-9]/.test(out)) throw new Error('fixture 未真正执行测试：\n' + out);
  });
}
