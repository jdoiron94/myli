// Runs the real entry point under plain Node (no Vitest transform), the way production runs it.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { freePort } from './testing.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * The variables without a default, so tests that expect a successful start can set them, and a
 * Meilisearch address where nothing listens. The API starts without search (spec §4); the
 * container tests cover a real one.
 */
const REQUIRED_ENV = {
  PUBLIC_URL: 'http://127.0.0.1',
  // Random-looking, or Better Auth logs a low-entropy warning at startup.
  BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
  MEILI_MASTER_KEY: 'master-key-hunter2-secret',
  MEILI_URL: `http://127.0.0.1:${String(await freePort())}`,
};

const SEARCH_UNAVAILABLE = 'search is unavailable, retrying in the background';

const ADMIN_ENV = {
  ADMIN_NAME: 'Ada Lovelace',
  ADMIN_EMAIL: 'Ada@Example.com',
  ADMIN_PASSWORD: 'Correct horse battery 9',
};

const tempDirs: string[] = [];
/** Every API a test started. One still running when the test ends (it failed) is killed. */
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database path in a fresh temporary directory, so tests never touch ./data. */
function tempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-main-'));
  tempDirs.push(dir);
  return join(dir, 'myli.db');
}

/** Starts main.ts with exactly `env`, so the developer's shell and .env can't leak in. */
function startApi(env: Record<string, string>) {
  const child = spawn(process.execPath, [MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const exited = once(child, 'exit').then(([code]) => code as number | null);

  /** Resolves once a log line contains `text`. */
  const untilLogged = (text: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (stdout.includes(text)) resolve();
      };
      check();
      child.stdout.on('data', check);
      void exited.then((code) => {
        reject(
          new Error(`API exited with code ${String(code)} before logging ${text}:\n${stdout}`),
        );
      });
    });
  const untilListening = () => untilLogged('"msg":"listening"');

  const logs = () =>
    stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  return { child, exited, untilLogged, untilListening, logs, stderr: () => stderr };
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
    // Comes before or after "listening", depending on how soon the connection is refused.
    await api.untilLogged(SEARCH_UNAVAILABLE);

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);
    expect(api.stderr()).toBe('');

    const logs = api.logs().filter((line) => line.msg !== SEARCH_UNAVAILABLE);
    expect(logs.map((line) => line.msg)).toEqual([
      'database ready',
      'email is off because SMTP_HOST is not set',
      'job worker started',
      'listening',
      'shutting down',
    ]);
    expect(logs[3]).toMatchObject({ level: 30, port, time: expect.any(String) as unknown });
    expect(logs[4]).toMatchObject({ signal: 'SIGTERM' });

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

  it('creates the first admin from the environment once, then ignores the variables', async () => {
    const databasePath = tempDatabasePath();
    const env = { ...REQUIRED_ENV, ...ADMIN_ENV, HOST: '127.0.0.1', DATABASE_PATH: databasePath };

    const first = startApi({ ...env, PORT: String(await freePort()) });
    await first.untilListening();
    first.child.kill('SIGTERM');
    expect(await first.exited).toBe(0);
    const messages = first.logs().map((line) => line.msg);
    // Whether the search warning comes before SIGTERM depends on timing; another test covers it.
    expect(messages.filter((msg) => msg !== SEARCH_UNAVAILABLE)).toEqual([
      'database ready',
      'first admin created from the environment',
      'email is off because SMTP_HOST is not set',
      'job worker started',
      'listening',
      'shutting down',
    ]);

    const second = startApi({ ...env, PORT: String(await freePort()) });
    await second.untilListening();
    second.child.kill('SIGTERM');
    expect(await second.exited).toBe(0);
    expect(second.logs()).toContainEqual(
      expect.objectContaining({
        level: 40,
        msg: expect.stringContaining('users already exist') as unknown,
      }),
    );

    for (const api of [first, second]) {
      expect(JSON.stringify(api.logs())).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
    }
    const db = new Database(databasePath, { readonly: true });
    const users = db.prepare('select email, role from user').all();
    db.close();
    expect(users).toEqual([{ email: 'ada@example.com', role: 'admin' }]);
  });

  it('exits with code 1 before listening when creating the first admin fails', async () => {
    const databasePath = tempDatabasePath();
    const db = openDatabase(databasePath);
    migrateDatabase(db);
    db.$client.exec(
      `create trigger refuse_users before insert on "user"
       begin select raise(abort, 'refused by the test'); end`,
    );
    db.$client.close();

    const api = startApi({
      ...REQUIRED_ENV,
      ...ADMIN_ENV,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      DATABASE_PATH: databasePath,
    });

    expect(await api.exited).toBe(1);
    const logs = api.logs();
    expect(logs.map((line) => line.msg)).not.toContain('listening');
    expect(logs.at(-1)).toMatchObject({
      level: 60,
      msg: 'could not create the first admin from the environment',
    });
    expect(JSON.stringify(logs)).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
  });

  it('starts even when the SMTP server is unreachable, and warns about it', async () => {
    const api = startApi({
      ...REQUIRED_ENV,
      HOST: '127.0.0.1',
      PORT: String(await freePort()),
      DATABASE_PATH: tempDatabasePath(),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(await freePort()), // nothing listens there
      SMTP_FROM: 'myli <myli@example.com>',
      SMTP_USER: 'myli',
      SMTP_PASSWORD: 'smtp-hunter2-secret',
    });
    await api.untilListening();
    await api.untilLogged('could not connect or log in to the SMTP server');
    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);

    expect(api.logs()).toContainEqual(
      expect.objectContaining({ level: 40, host: '127.0.0.1', security: 'starttls' }),
    );
    expect(api.logs().map((line) => line.msg)).not.toContain(
      'email is off because SMTP_HOST is not set',
    );
    expect(JSON.stringify(api.logs())).not.toContain('hunter2');
  });

  it('starts without Meilisearch, warns once, and reports search unavailable on /readyz', async () => {
    const port = await freePort();
    const api = startApi({
      ...REQUIRED_ENV,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: tempDatabasePath(),
    });
    await api.untilListening();
    await api.untilLogged(SEARCH_UNAVAILABLE);

    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ detail: 'Not ready: search is unavailable.' });
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);

    // The wait before the next attempt doesn't hold up shutting down.
    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);

    const warnings = api.logs().filter((line) => line.msg === SEARCH_UNAVAILABLE);
    expect(warnings).toEqual([expect.objectContaining({ level: 40, retryInMs: 1_000 })]);
    expect(JSON.stringify(api.logs())).not.toContain('hunter2');
  });

  it('reads secrets from files, as Docker secrets provide them, and never logs them', async () => {
    const port = await freePort();
    const databasePath = tempDatabasePath();
    const secretPath = (name: string, value: string) => {
      const path = join(dirname(databasePath), name);
      writeFileSync(path, `${value}\n`);
      return path;
    };
    const { BETTER_AUTH_SECRET, MEILI_MASTER_KEY, ...rest } = REQUIRED_ENV;
    const api = startApi({
      ...rest,
      BETTER_AUTH_SECRET_FILE: secretPath('better_auth_secret', BETTER_AUTH_SECRET),
      MEILI_MASTER_KEY_FILE: secretPath('meili_master_key', MEILI_MASTER_KEY),
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: databasePath,
    });
    await api.untilListening();

    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);
    const output = JSON.stringify(api.logs()) + api.stderr();
    expect(output).not.toContain(BETTER_AUTH_SECRET);
    expect(output).not.toContain(MEILI_MASTER_KEY);
  });

  it('exits with code 1 and a readable message when the config is invalid', async () => {
    const api = startApi({ PORT: 'not-a-port' });

    expect(await api.exited).toBe(1);
    expect(api.stderr()).toMatch(/^Invalid environment configuration:\n\s+PORT: /);
    expect(api.stderr()).toMatch(/^\s+BETTER_AUTH_SECRET: is required$/m);
    expect(api.stderr()).toMatch(/^\s+MEILI_MASTER_KEY: is required$/m);
    expect(api.stderr()).not.toMatch(/^\s+at /m); // no stack trace
  });
});
