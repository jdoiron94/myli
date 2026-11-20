import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { migrateDatabase, openDatabase } from '../db/database.ts';
import * as schema from '../db/schema.ts';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { indexRecipeJob } from './indexing.ts';
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

  // Regression: `pnpm reindex`, run beside the API, failed now and then with SQLITE_BUSY_SNAPSHOT.
  // Its transaction read, then wrote, and when the API's worker committed in between, SQLite refused
  // the write at once, without waiting. The image test that runs the script caught it.
  it('queues one while the API writes to the database, which waits for it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'myli-reindex-'));
    try {
      const path = join(dir, 'myli.db');
      const setUp = openDatabase(path);
      migrateDatabase(setUp);
      setUp.$client.close();
      const api = openDatabase(path);
      // Fails at once rather than wait, since both connections are in this one thread.
      api.$client.pragma('busy_timeout = 0');
      let apiWrote: boolean | undefined;
      // Drizzle logs each query just before running it: the API commits just before the write.
      const script = drizzle({
        client: openDatabase(path).$client,
        schema,
        logger: {
          logQuery(query) {
            if (!query.startsWith('insert into "job"') || apiWrote !== undefined) return;
            try {
              enqueueJob(api, indexRecipeJob, { recipeId: 'recipe-bread' });
              apiWrote = true;
            } catch {
              apiWrote = false;
            }
          },
        },
      });

      const id = queueReindex(script);

      expect(apiWrote).toBe(false);
      expect(api.select({ type: job.type }).from(job).where(eq(job.id, id)).get()).toEqual({
        type: 'search.reindex',
      });
      api.$client.close();
      script.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reindexRecipesJob', () => {
  it('fails while search is unavailable, to be tried again later', async () => {
    const db = createTestDatabase();
    const id = queueReindex(db);
    const worker = createWorker({
      services: {
        db,
        mailer: null,
        publicUrl: 'https://myli.test',
        search: { client: undefined },
        blobs: createMemoryBlobStore(),
      },
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
