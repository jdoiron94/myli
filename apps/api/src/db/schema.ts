import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;

/** `('a', 'b')`, for CHECK constraints. Only for constants defined in code, never for input. */
function sqlList(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

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
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check('job_status_check', sql`${table.status} in ${sqlList(JOB_STATUSES)}`),
    // The worker's query: the next pending jobs that are due.
    index('job_status_run_after_idx').on(table.status, table.runAfter),
  ],
);
