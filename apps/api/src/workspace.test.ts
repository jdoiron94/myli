import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Plain Node, not Vitest: production runs workspace packages straight from their TypeScript source
// (ADR 0008). Node refuses to strip types inside node_modules, so this breaks if @myli/shared ever
// stops resolving through the workspace symlink to packages/shared.
it('runs @myli/shared from source under plain Node, with no build step', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { API_BASE_PATH } from '@myli/shared'; console.log(API_BASE_PATH);",
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
  );

  expect(result.stderr).toBe('');
  expect(result.stdout.trim()).toBe('/api/v1');
});
