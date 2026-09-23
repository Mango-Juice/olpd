import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('boots the production API graph in native Node ESM without a TypeScript loader', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-server-imports.ts'], { encoding: 'utf8' });
  expect(output).toContain('status 200, both input guards 400; no provider calls');
});
