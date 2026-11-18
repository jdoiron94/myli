import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import type { Db } from '../db/database.ts';
import { job, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker, DEFAULT_MAX_ATTEMPTS, defaultBackoffMs } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { indexRecipeJob } from './indexing.ts';

const HOUR_MS = 60 * 60 * 1000;

function setUp() {
  const db: Db = createTestDatabase();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
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
  return { db, worker };
}

describe('indexRecipeJob', () => {
  it('fails while search is unavailable, to be tried again later', async () => {
    const { db, worker } = setUp();
    const id = insertRecipe(db, 'owner');

    expect(await worker.runOnce()).toBe(true);

    expect(db.select().from(job).all()).toMatchObject([
      {
        type: 'search.index-recipe',
        payload: { recipeId: id },
        status: 'pending',
        attempts: 1,
        lastError: 'Search is unavailable',
      },
    ]);
  });

  it('keeps trying for about thirteen hours, where other jobs give up after minutes', () => {
    const waitedMs = (attempts: number) =>
      Array.from({ length: attempts - 1 }, (_, index) => defaultBackoffMs(index + 1)).reduce(
        (sum, ms) => sum + ms,
        0,
      );

    expect(waitedMs(DEFAULT_MAX_ATTEMPTS)).toBeLessThan(5 * 60 * 1000);
    const hours = waitedMs(indexRecipeJob.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) / HOUR_MS;
    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThan(14);
  });
});
