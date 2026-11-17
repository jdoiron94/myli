import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { queueReindex } from './reindex.ts';

describe('queueReindex', () => {
  it('queues one rebuild at a time: while one waits or runs, asking again gives that one', () => {
    const db = createTestDatabase();
    const first = queueReindex(db);
    expect(queueReindex(db)).toBe(first);

    db.update(job).set({ status: 'running' }).where(eq(job.id, first)).run();
    expect(queueReindex(db)).toBe(first);

    db.update(job).set({ status: 'succeeded' }).where(eq(job.id, first)).run();
    const second = queueReindex(db);
    expect(second).not.toBe(first);

    db.update(job).set({ status: 'dead' }).where(eq(job.id, second)).run();
    expect(queueReindex(db)).not.toBe(second);
    expect(
      db
        .select()
        .from(job)
        .all()
        .map(({ type }) => type),
    ).toEqual(['search.reindex', 'search.reindex', 'search.reindex']);
  });
});

describe('reindexRecipesJob', () => {
  it('fails while search is unavailable, to be tried again later', async () => {
    const db = createTestDatabase();
    const id = queueReindex(db);
    const worker = createWorker({
      services: { db, mailer: null, publicUrl: 'https://myli.test', search: { client: undefined } },
      logger: createLogger('fatal', { write: () => undefined }),
      jobs: allJobs,
    });

    await worker.runOnce();

    expect(db.select().from(job).where(eq(job.id, id)).get()).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Search is unavailable',
    });
  });
});
