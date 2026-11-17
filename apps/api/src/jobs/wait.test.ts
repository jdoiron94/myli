import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { defineJob } from './define.ts';
import { enqueueJob } from './queue.ts';
import { type JobRow, waitForJob } from './wait.ts';

const noop = defineJob({
  type: 'test.noop',
  payload: z.object({}),
  handle: () => Promise.resolve(),
});

describe('waitForJob', () => {
  it('follows the job until it succeeds, telling of each change on the way', async () => {
    const db = createTestDatabase();
    const id = enqueueJob(db, noop, {});
    const set = (values: Partial<JobRow>) => db.update(job).set(values).where(eq(job.id, id)).run();
    const seen: Pick<JobRow, 'status' | 'attempts' | 'lastError'>[] = [];
    // Each change the worker would make, one per poll.
    const changes: Partial<JobRow>[] = [
      { status: 'running' },
      { status: 'pending', attempts: 1, lastError: 'Search is unavailable' },
      { status: 'running' },
      { status: 'succeeded', attempts: 2, lastError: null },
    ];

    const done = await waitForJob(db, id, {
      pollMs: 1,
      onChange({ status, attempts, lastError }) {
        seen.push({ status, attempts, lastError });
        const next = changes.shift();
        if (next) set(next);
      },
    });

    expect(done).toMatchObject({ id, status: 'succeeded', attempts: 2 });
    expect(seen).toEqual([
      { status: 'pending', attempts: 0, lastError: null },
      { status: 'running', attempts: 0, lastError: null },
      { status: 'pending', attempts: 1, lastError: 'Search is unavailable' },
      { status: 'running', attempts: 1, lastError: 'Search is unavailable' },
      { status: 'succeeded', attempts: 2, lastError: null },
    ]);
  });

  it('returns a dead-lettered job, with its error', async () => {
    const db = createTestDatabase();
    const id = enqueueJob(db, noop, {});
    db.update(job)
      .set({ status: 'dead', attempts: 24, lastError: 'gone' })
      .where(eq(job.id, id))
      .run();

    expect(await waitForJob(db, id)).toMatchObject({ status: 'dead', lastError: 'gone' });
  });

  it('refuses a job that doesn’t exist, rather than wait forever', async () => {
    await expect(waitForJob(createTestDatabase(), 42)).rejects.toThrow('There is no job 42');
  });
});
