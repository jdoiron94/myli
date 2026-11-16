// Runs the demo seed script under plain Node (no Vitest transform), the way it's run for real.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_BASE_PATH } from '@myli/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.ts';
import { DEMO_ACCOUNTS } from './setup/demo.ts';
import { createTestApp } from './testing.ts';

const SCRIPT = fileURLToPath(new URL('./seed-demo.ts', import.meta.url));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-seed-'));
  tempDirs.push(dir);
  return join(dir, 'myli.db');
}

/** Runs the script to the end with exactly these variables, so the shell and .env can't leak in. */
async function runSeed(databasePath: string) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: {
      PUBLIC_URL: 'https://myli.example',
      BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
      MEILI_MASTER_KEY: 'master-key-hunter2-secret',
      DATABASE_PATH: databasePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const [code] = (await once(child, 'exit')) as [number | null];
  return { code, stdout, stderr };
}

describe('seed-demo.ts', () => {
  it('creates the demo accounts on a new database and prints only them, with their passwords', async () => {
    const path = tempDatabasePath();

    const { code, stdout } = await runSeed(path);

    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(
      'Created a demo account for each role. Their passwords are shown only this once:',
    );
    expect(lines.at(-1)).toBe('Sign in at https://myli.example');
    const printed = lines
      .map((line) => /^ {2}(\w+) +(\S+@example\.com) +(\S+)$/.exec(line))
      .filter((match) => match !== null)
      .map(([, role, email, password]) => ({ role, email, password: password ?? '' }));
    expect(printed.map(({ role, email }) => ({ role, email }))).toEqual(
      DEMO_ACCOUNTS.map(({ role, email }) => ({ role, email })),
    );

    // The passwords work against the database it seeded.
    const t = createTestApp({ db: openDatabase(path) });
    for (const { email, password } of printed) {
      const res = await t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
        method: 'POST',
        headers: { origin: t.publicUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect(res.status, email).toBe(200);
    }
    t.db.$client.close();
  });

  it('refuses once the instance has users, says why, and prints nothing', async () => {
    const path = tempDatabasePath();
    await runSeed(path);

    const { code, stdout, stderr } = await runSeed(path);

    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain(
      'This instance already has users, so no demo accounts were created: they are only for a new instance.',
    );
  });
});
