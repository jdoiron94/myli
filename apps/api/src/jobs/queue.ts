import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, Tx } from '../db/database.ts';
import { job } from '../db/schema.ts';
import type { JobDefinition } from './define.ts';

/**
 * Queues a job. Pass the transaction of the write the job follows from, so both commit or roll
 * back together (the outbox rule, ADR 0003). Throws if the payload doesn't match the job's schema.
 *
 * @returns the new job's ID
 */
export function enqueueJob<TPayload extends z.ZodType>(
  db: Db | Tx,
  definition: JobDefinition<TPayload>,
  payload: z.input<TPayload>,
  options: { runAfter?: Date } = {},
): number {
  const inserted = db
    .insert(job)
    .values({
      type: definition.type,
      payload: definition.payload.parse(payload),
      ...(options.runAfter && { runAfter: options.runAfter }),
    })
    .returning({ id: job.id })
    .get();
  return inserted.id;
}

/**
 * Queues a job, unless one of its type is already waiting or under way, for a job that does a
 * whole task each time, like rebuilding the search index or purging the trash. Its job's ID, either
 * way. Immediate, so it holds the write lock from the start: deferred, it would read, then fail at
 * once when it came to write if another connection, like the API's worker beside `pnpm reindex`,
 * wrote in between.
 */
export function enqueueUnlessWaiting<TPayload extends z.ZodType>(
  db: Db,
  definition: JobDefinition<TPayload>,
  payload: z.input<TPayload>,
): number {
  return db.transaction(
    (tx) => {
      const waiting = tx
        .select({ id: job.id })
        .from(job)
        .where(and(eq(job.type, definition.type), inArray(job.status, ['pending', 'running'])))
        .get();
      return waiting?.id ?? enqueueJob(tx, definition, payload);
    },
    { behavior: 'immediate' },
  );
}
