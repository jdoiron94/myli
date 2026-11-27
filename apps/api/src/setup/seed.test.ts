import { AUTH_BASE_PATH } from '@myli/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupClaim, user } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, type TestApp } from '../testing.ts';
import { seedFirstAdmin } from './seed.ts';
import { runSetup } from './setup.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The variables as `loadEnv` returns them: the email is already lowercased. */
const ADMIN_ENV = {
  ADMIN_NAME: 'Ada Lovelace',
  ADMIN_EMAIL: 'ada@example.com',
  ADMIN_PASSWORD: 'Correct horse battery 9',
};

function setUp() {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ logger });
  const seed = (env: Partial<typeof ADMIN_ENV> = ADMIN_ENV) =>
    seedFirstAdmin({ db: t.db, auth: t.auth, logger }, env);
  /** Every log line, including Better Auth's, so tests can check the password never appears. */
  const rawLogs = () => lines.join('');
  const logs = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { t, seed, rawLogs, logs };
}

const users = (t: TestApp) => t.db.select().from(user).all();

function signIn(t: TestApp, email: string, password: string) {
  return t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
    method: 'POST',
    headers: { origin: t.publicUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('seedFirstAdmin', () => {
  it('does nothing when the variables are not set', async () => {
    const { t, seed, logs } = setUp();

    expect(await seed({})).toBe('not-configured');
    expect(users(t)).toEqual([]);
    expect(logs()).toEqual([]);
  });

  it('creates the first admin, unverified, who can sign in, and logs it without the password', async () => {
    const { t, seed, logs, rawLogs } = setUp();

    expect(await seed()).toBe('created');

    const [admin] = users(t);
    expect(users(t)).toMatchObject([
      { name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin', emailVerified: false },
    ]);
    expect(logs()).toContainEqual(
      expect.objectContaining({
        level: 30,
        msg: 'first admin created from the environment',
        userId: admin?.id,
      }),
    );
    expect(rawLogs()).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
    expect((await signIn(t, ADMIN_ENV.ADMIN_EMAIL, ADMIN_ENV.ADMIN_PASSWORD)).status).toBe(200);
  });

  it('never changes users who already exist, and warns that the variables were ignored', async () => {
    const { t, seed, logs, rawLogs } = setUp();
    // An admin who has since changed their password: restarting with the old variables must not
    // reset it, nor create anyone.
    const existingPassword = 'A different password 42';
    await runSetup(
      { db: t.db, auth: t.auth },
      { name: 'Ada', email: ADMIN_ENV.ADMIN_EMAIL, password: existingPassword },
    );
    const before = users(t);

    expect(await seed()).toBe('users-exist');

    expect(users(t)).toEqual(before);
    expect((await signIn(t, ADMIN_ENV.ADMIN_EMAIL, existingPassword)).status).toBe(200);
    expect((await signIn(t, ADMIN_ENV.ADMIN_EMAIL, ADMIN_ENV.ADMIN_PASSWORD)).status).toBe(401);
    expect(logs()).toContainEqual(
      expect.objectContaining({
        level: 40,
        msg: expect.stringContaining('users already exist') as unknown,
      }),
    );
    expect(rawLogs()).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
  });

  it('leaves another setup in progress alone, and warns', async () => {
    const { t, seed, logs } = setUp();
    const claimedAt = new Date(Date.now() - 1000);
    t.db.insert(setupClaim).values({ id: 1, claimedAt }).run();

    expect(await seed()).toBe('in-progress');

    expect(users(t)).toEqual([]);
    expect(t.db.select().from(setupClaim).all()).toEqual([{ id: 1, claimedAt }]);
    expect(logs()).toContainEqual(
      expect.objectContaining({
        level: 40,
        msg: expect.stringContaining('another setup is in progress') as unknown,
      }),
    );
  });

  it('throws when creating the admin fails, and releases its claim', async () => {
    const { t, seed } = setUp();
    vi.spyOn(t.auth.api, 'createUser').mockRejectedValueOnce(new Error('disk full'));

    await expect(seed()).rejects.toThrow('disk full');
    expect(users(t)).toEqual([]);
    expect(t.db.select().from(setupClaim).all()).toEqual([]);
  });
});
