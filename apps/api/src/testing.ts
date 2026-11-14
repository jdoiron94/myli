import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
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
 * and auth instance too, so tests can arrange state directly.
 */
export function createTestApp(options: TestAppOptions = {}) {
  const db = options.db ?? createTestDatabase();
  const logger = options.logger ?? createLogger('silent');
  const auth = createAuth({ db, logger, env: { ...TEST_AUTH_ENV, ...options.env } });
  const app = createApp({ logger, auth });
  return { app, db, auth, logger };
}
