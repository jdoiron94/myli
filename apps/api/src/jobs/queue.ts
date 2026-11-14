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
