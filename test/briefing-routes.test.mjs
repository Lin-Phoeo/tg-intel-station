import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('briefing HTTP routes validate filters and selected IDs in an isolated service', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath, [
    '--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./fixtures/briefing-routes.mjs', import.meta.url)),
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 60000, env });
  if (!/ℹ pass [1-9]/.test(out)) throw new Error('route fixture did not execute tests:\n' + out);
});
