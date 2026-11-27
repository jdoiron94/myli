// Runs the script under plain Node (no Vitest transform), the way whoever runs the server does.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from 'vitest';
import { operatorResetLink } from './account/password-reset.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { user, userToken } from './db/schema.ts';
import { besideTheApi } from './db/testing.ts';

const SCRIPT = fileURLToPath(new URL('reset-password.ts', import.meta.url));
const LINK = /^https:\/\/myli\.example\/reset-password#([\w-]{43})$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

it('prints a reset link for any active account, and refuses any other', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myli-reset-'));
  const databasePath = join(dir, 'myli.db');
  const db = openDatabase(databasePath);
  onTestFinished(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  migrateDatabase(db);
  // Unverified, as accounts from setup or a copied invitation are: it gets a link all the same.
  db.insert(user).values({ id: 'ada', name: 'Ada', email: 'ada@example.com' }).run();
  db.insert(user).values({ id: 'bob', name: 'Bob', email: 'bob@example.com', banned: true }).run();
  // Only these, so the developer's shell and .env can't leak in.
  const run = (...args: string[]) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, ...args], {
      env: {
        PATH: process.env.PATH,
        PUBLIC_URL: 'https://myli.example',
        BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
        MEILI_MASTER_KEY: 'master-key-hunter2-secret',
        DATABASE_PATH: databasePath,
      },
      encoding: 'utf8',
    });
    return { status, stdout: stdout.trimEnd().split('\n'), stderr: stderr.trimEnd() };
  };

  const made = run('Ada@Example.com');

  expect(made).toMatchObject({
    status: 0,
    stdout: [
      expect.stringMatching(/^A reset link for ada@example\.com\. It works once, until .+ UTC:$/),
      expect.stringMatching(LINK),
      'Give it only to them: whoever opens it can choose the account’s password.',
    ],
    stderr: '',
  });
  const token = LINK.exec(made.stdout[1] ?? '')?.[1] ?? '';
  const [stored] = db.select().from(userToken).all();
  expect(stored).toMatchObject({
    userId: 'ada',
    purpose: 'reset_password',
    email: 'ada@example.com',
    tokenHash: sha256(token),
  });
  expect((stored?.expiresAt.getTime() ?? 0) - (stored?.createdAt.getTime() ?? 0)).toBe(
    60 * 60 * 1000,
  );

  const refused = (stderr: string) => ({ status: 1, stdout: [''], stderr });
  expect({
    'no address': run(),
    'not an address': run('ada'),
    unknown: run('nobody@example.com'),
    deactivated: run('bob@example.com'),
  }).toEqual({
    'no address': refused('Give the account’s address: node src/reset-password.ts <email>'),
    'not an address': refused('ada isn’t an email address.'),
    unknown: refused('There’s no account with the address nobody@example.com.'),
    deactivated: refused(
      'The account of bob@example.com is deactivated. An admin can reactivate it on the Users page.',
    ),
  });
});

it('takes the write lock as its transaction begins, so the API writing meanwhile can’t fail it', () => {
  const { result, apiWrites } = besideTheApi(['delete from "user_token"'], (script, api) => {
    api.insert(user).values({ id: 'ada', name: 'Ada', email: 'ada@example.com' }).run();
    return operatorResetLink(script, {
      email: 'ada@example.com',
      publicUrl: 'https://myli.example',
      at: new Date(),
    });
  });

  expect(apiWrites).toEqual({ 'delete from "user_token"': false });
  expect(result).toMatchObject({ ok: true, link: expect.stringMatching(LINK) });
});
