import { randomUUID } from 'node:crypto';
import { AUTH_BASE_PATH, type Role } from '@myli/shared';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { createUserWithPassword } from './auth/users.ts';
import type { Db } from './db/database.ts';
import { createTestDatabase } from './db/testing.ts';
import type { Env } from './env.ts';
import { createLogger, type Logger } from './logger.ts';

/** The auth settings tests run with. `https`, so cookies behave as they do in production. */
export const TEST_AUTH_ENV = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'https://myli.test',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
} as const satisfies Pick<Env, 'NODE_ENV' | 'PUBLIC_URL' | 'BETTER_AUTH_SECRET'>;

export interface TestAppOptions {
  db?: Db;
  logger?: Logger;
  env?: Partial<Pick<Env, 'NODE_ENV' | 'PUBLIC_URL' | 'BETTER_AUTH_SECRET'>>;
}

/**
 * The whole app on a fresh in-memory database, for `app.request()` tests. Returns the database
 * and auth instance too, so tests can arrange state directly, and the origin requests come from.
 */
export function createTestApp(options: TestAppOptions = {}) {
  const db = options.db ?? createTestDatabase();
  const logger = options.logger ?? createLogger('silent');
  const env = { ...TEST_AUTH_ENV, ...options.env };
  const auth = createAuth({ db, logger, env });
  const app = createApp({ logger, auth });
  return { app, db, auth, logger, publicUrl: env.PUBLIC_URL };
}

export type TestApp = ReturnType<typeof createTestApp>;

/** The `Cookie` header a browser would send back after receiving `res`. */
export function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * Creates a user with `role` and signs them in over HTTP, the way the browser does. Send `cookie`
 * as the `Cookie` header to make requests as them.
 */
export async function signedInAs(t: TestApp, role: Role) {
  const email = `${role}-${randomUUID()}@example.com`;
  const password = 'a test password, long enough';
  const user = await createUserWithPassword(t.auth, {
    name: `Test ${role}`,
    email,
    password,
    role,
  });

  const res = await t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
    method: 'POST',
    headers: { origin: t.publicUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in as ${role} failed with ${String(res.status)}`);
  return { user, cookie: cookieHeaderFrom(res) };
}
