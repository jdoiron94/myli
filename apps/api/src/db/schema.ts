import { DEFAULT_ROLE, ROLES } from '@myli/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;

/** `('a', 'b')`, for CHECK constraints. Only for constants defined in code, never for input. */
function sqlList(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------------------------
// Better Auth (ADR 0005). Table and column names are the ones Better Auth expects, and it checks
// them on first use: a mismatch throws a SchemaMismatchError. After upgrading Better Auth, compare
// with the schema its CLI generates and add a migration for any change.
// ---------------------------------------------------------------------------------------------

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // From the admin plugin. Exactly one role per user: the plugin would also accept a
    // comma-separated list, which the CHECK constraint rejects.
    role: text('role', { enum: ROLES }).notNull().default(DEFAULT_ROLE),
    /** Deactivated users are banned (ADR 0005). Banning revokes their sessions. */
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  },
  (table) => [check('user_role_check', sql`${table.role} in ${sqlList(ROLES)}`)],
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Stored as given: Better Auth signs the cookie, and looks the session up by this token. */
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

/** Login methods. myli only has `credential` (email + password), which holds the password hash. */
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

/** Short-lived tokens for email verification and password reset. */
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// ---------------------------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------------------------

/**
 * Background jobs and the search outbox (ADR 0003). Rows are inserted in the same transaction as
 * the change they follow from, and the in-process worker picks them up.
 */
export const job = sqliteTable(
  'job',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Not picked up before this time; pushed back after each failed attempt. */
    runAfter: integer('run_after', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (table) => [
    check('job_status_check', sql`${table.status} in ${sqlList(JOB_STATUSES)}`),
    // The worker's query: the next pending jobs that are due.
    index('job_status_run_after_idx').on(table.status, table.runAfter),
  ],
);
