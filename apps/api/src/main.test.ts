// Runs the real entry point under plain Node (no Vitest transform), the way production runs it.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** The variables without a default, so tests that expect a successful start can set them. */
const REQUIRED_ENV = {
  PUBLIC_URL: 'http://127.0.0.1',
  BETTER_AUTH_SECRET: 'main-test-secret-main-test-secret',
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database path in a fresh temporary directory, so tests never touch ./data. */
function tempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-main-'));
  tempDirs.push(dir);
  return join(dir, 'myli.db');
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return address.port;
}

/** Starts main.ts with exactly `env`, so the developer's shell and .env can't leak in. */
function startApi(env: Record<string, string>) {
  const child = spawn(process.execPath, [MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const exited = once(child, 'exit').then(([code]) => code as number | null);

  const untilListening = () =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (stdout.includes('listening')) resolve();
      };
      check();
      child.stdout.on('data', check);
      void exited.then((code) => {
        reject(new Error(`API exited with code ${String(code)} before listening:\n${stdout}`));
      });
    });

  const logs = () =>
    stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  return { child, exited, untilListening, logs, stderr: () => stderr };
}

describe('main.ts', () => {
  it('migrates the database, serves /healthz, then exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    const databasePath = tempDatabasePath();
    const api = startApi({
      ...REQUIRED_ENV,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: databasePath,
    });
    await api.untilListening();

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);
    expect(api.stderr()).toBe('');

    const logs = api.logs();
    expect(logs.map((line) => line.msg)).toEqual([
      'database ready',
      'job worker started',
      'listening',
      'shutting down',
    ]);
    expect(logs[2]).toMatchObject({ level: 30, port, time: expect.any(String) as unknown });
    expect(logs[3]).toMatchObject({ signal: 'SIGTERM' });

    const db = new Database(databasePath, { readonly: true });
    const jobTable = db.prepare("select name from sqlite_master where name = 'job'").get();
    db.close();
    expect(jobTable).toEqual({ name: 'job' });
  });

  it('exits with code 1 before listening when a migration fails', async () => {
    // A `job` table that the migrations didn't create makes the first migration fail.
    const databasePath = tempDatabasePath();
    const db = new Database(databasePath);
    db.exec('create table job (id integer primary key)');
    db.close();

    const api = startApi({
      ...REQUIRED_ENV,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      DATABASE_PATH: databasePath,
    });

    expect(await api.exited).toBe(1);
    const logs = api.logs();
    expect(logs.map((line) => line.msg)).toEqual(['could not open or migrate the database']);
    expect(logs[0]).toMatchObject({
      level: 60,
      err: { message: expect.stringContaining('already exists') as unknown },
    });
  });

  it('exits with code 1 and a readable message when the config is invalid', async () => {
    const api = startApi({ PORT: 'not-a-port' });

    expect(await api.exited).toBe(1);
    expect(api.stderr()).toMatch(/^Invalid environment configuration:\n\s+PORT: /);
    expect(api.stderr()).toMatch(/^\s+BETTER_AUTH_SECRET: is required$/m);
    expect(api.stderr()).not.toMatch(/^\s+at /m); // no stack trace
  });
});
