import {
  AUTH_BASE_PATH,
  DEFAULT_ROLE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblems,
  type Role,
} from '@myli/shared';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { betterAuth } from 'better-auth/minimal';
import { createAccessControl } from 'better-auth/plugins/access';
import { admin } from 'better-auth/plugins/admin';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import type { Db } from '../db/database.ts';
import { account, session, user, verification } from '../db/schema.ts';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';

/**
 * The admin plugin's roles, with no permissions at all. Nothing needs one:
 * - role changes and deactivation go through `users/manage.ts` (ADR 0010)
 * - the plugin's HTTP endpoints are blocked (see the hook below)
 * - server code calls only `createUser`, without a session, which the plugin allows without
 *   checking permissions
 *
 * The roles still have to be listed: without them, admins would get the plugin's defaults,
 * impersonation and hard deletes included. App-level permissions live in the policy module.
 */
const accessControl = createAccessControl(defaultStatements);
const noPermissions = accessControl.newRole({ user: [], session: [] });
const adminPluginRoles = {
  admin: noPermissions,
  editor: noPermissions,
  viewer: noPermissions,
} satisfies Record<Role, unknown>;

/** The Better Auth endpoints that set a password, and the body field that carries it. */
const PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  '/sign-up/email': 'password',
  '/admin/create-user': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
  '/set-password': 'newPassword',
  '/admin/set-user-password': 'newPassword',
};

/** The password rules from `@myli/shared`, for a Better Auth endpoint that sets a password. */
function checkNewPassword(path: string, body: unknown): APIError | undefined {
  const field = PASSWORD_FIELDS[path];
  if (field === undefined || typeof body !== 'object' || body === null) return undefined;
  const password: unknown = (body as Record<string, unknown>)[field];
  // Missing or not a string: Better Auth's own validation answers that.
  if (typeof password !== 'string') return undefined;
  const problems = passwordProblems(password);
  return problems.length > 0
    ? new APIError('BAD_REQUEST', { code: 'PASSWORD_TOO_WEAK', message: problems.join(' ') })
    : undefined;
}

export interface AuthDeps {
  db: Db;
  env: Pick<Env, 'NODE_ENV' | 'PUBLIC_URL' | 'BETTER_AUTH_SECRET'>;
  logger: Logger;
}

/** Better Auth, configured as ADR 0005 describes. Mounted at `AUTH_BASE_PATH` by `createApp`. */
export function createAuth({ db, env, logger }: AuthDeps) {
  const authLogger = logger.child({ component: 'auth' });

  return betterAuth({
    appName: 'myli',
    baseURL: env.PUBLIC_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user, session, account, verification },
      // better-sqlite3 transactions are synchronous, and Better Auth's callbacks are async.
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      // Accounts come only from first-run setup and accepted invitations (ADR 0005).
      disableSignUp: true,
      // Also enforced, with the character rules, by the hook below.
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    plugins: [
      admin({
        ac: accessControl,
        roles: adminPluginRoles,
        defaultRole: DEFAULT_ROLE,
        adminRoles: ['admin'],
      }),
    ],
    hooks: {
      before: createAuthMiddleware((ctx) => {
        // The admin plugin's HTTP endpoints would let an admin change roles or ban users without
        // going through the policy module or the audit log. Block them for every caller. Server
        // code can still use them through `auth.api.*`, which has no `ctx.request`.
        if (ctx.request && ctx.path.startsWith('/admin/')) {
          return Promise.reject(new APIError('NOT_FOUND'));
        }
        // Every path that sets a password, over HTTP or from server code, follows the same rules.
        const weakPassword = checkNewPassword(ctx.path, ctx.body);
        return weakPassword ? Promise.reject(weakPassword) : Promise.resolve();
      }),
    },
    // Better Auth decides this from process.env.NODE_ENV, which can be unset in production.
    rateLimit: { enabled: env.NODE_ENV === 'production' },
    advanced: {
      cookiePrefix: 'myli',
      // Better Auth turns its origin (CSRF) check off when process.env.NODE_ENV is "test" or any
      // TEST variable is set. Keep it on everywhere, so tests exercise it and a stray variable in
      // production can't disable it.
      disableOriginCheck: false,
      // The client's address, for sessions and rate limiting. The app sets this header to the
      // address it trusts before every request reaches Better Auth (withClientIp in client-ip.ts).
      // Not Better Auth's own trustedProxies: it reads only the header, so it can't tell whether a
      // trusted proxy sent it or the client did.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    // Errors Better Auth didn't produce itself (database failures, bugs) are rethrown, so the
    // app's onError logs them with the request ID and answers with a generic problem. Better
    // Auth's own errors (wrong password, invalid origin) are still answered by Better Auth.
    onAPIError: { throw: true },
    logger: {
      level: 'info',
      log: (level, message, ...args: unknown[]) => {
        const err = args.find((arg) => arg instanceof Error);
        const details = args.filter((arg) => typeof arg === 'string');
        authLogger[level]({ ...(err && { err }), ...(details.length > 0 && { details }) }, message);
      },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
