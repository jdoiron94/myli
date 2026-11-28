import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import type { Db } from '../db/database.ts';
import { image, job, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { saveUpload, UNSAVED_IMAGE_TTL_MS } from './images.ts';
import { processImage } from './process.ts';
import { testImage } from './testing.ts';

function setUp() {
  const db: Db = createTestDatabase();
  db.insert(user).values({ id: 'uploader', name: 'Uploader', email: 'up@example.com' }).run();
  const blobs = createMemoryBlobStore();
  // From the real time: jobs the handlers queue are due from then, and a fixed date in the past
  // left the blobs job due after the worker's clock once a day had passed.
  let now = new Date();
  const worker = createWorker({
    services: {
      db,
      mailer: null,
      publicUrl: 'https://myli.test',
      search: { client: undefined },
      blobs,
    },
    logger: createLogger('fatal', { write: () => undefined }),
    jobs: allJobs,
    now: () => now,
  });
  const upload = async () => {
    const processed = await processImage(await testImage(1600, 1200));
    if (!processed.ok) throw new Error(processed.problem);
    return saveUpload({ db, blobs }, 'uploader', processed.image, now);
  };
  const laterBy = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { db, blobs, worker, upload, laterBy };
}

describe('discardUnsavedImageJob', () => {
  it('waits a day, then deletes an upload no recipe was saved with, blobs and all', async () => {
    const { db, blobs, worker, upload, laterBy } = setUp();
    await upload();
    expect(blobs.keys()).toHaveLength(3);

    laterBy(UNSAVED_IMAGE_TTL_MS - 1000);
    expect(await worker.runOnce()).toBe(false);

    laterBy(1000);
    expect(await worker.runOnce()).toBe(true);
    expect(db.select().from(image).all()).toEqual([]);
    expect(blobs.keys()).toHaveLength(3);

    // The blobs go in a job of their own.
    expect(await worker.runOnce()).toBe(true);
    expect(blobs.keys()).toEqual([]);
    expect(db.select({ type: job.type, status: job.status }).from(job).all()).toEqual([
      { type: 'images.discard-unsaved', status: 'succeeded' },
      { type: 'blobs.delete', status: 'succeeded' },
    ]);
  });

  it('leaves an upload a recipe was saved with, or that became its uploader’s profile photo', async () => {
    const { db, blobs, worker, upload, laterBy } = setUp();
    const saved = await upload();
    const recipeId = insertRecipe(db, 'uploader');
    db.update(image).set({ recipeId }).where(eq(image.id, saved.id)).run();
    const avatar = await upload();
    db.update(image).set({ avatarOf: 'uploader' }).where(eq(image.id, avatar.id)).run();
    // Only the discard jobs are under test: not the search update saving the recipe queued.
    db.delete(job).where(eq(job.type, 'search.index-recipe')).run();

    laterBy(UNSAVED_IMAGE_TTL_MS);
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(true);

    const kept = db.select({ id: image.id }).from(image).all();
    expect(kept.map(({ id }) => id).sort()).toEqual([saved.id, avatar.id].sort());
    expect(blobs.keys()).toHaveLength(6);
    expect(await worker.runOnce()).toBe(false);
  });
});

describe('deleteBlobsJob', () => {
  it('deletes blobs that are gone already without complaint, so it can run again', async () => {
    const { db, blobs, worker, upload, laterBy } = setUp();
    await upload();
    laterBy(UNSAVED_IMAGE_TTL_MS);
    await worker.runOnce();
    const [, deleteBlobs] = db.select().from(job).all();
    for (const key of blobs.keys()) await blobs.delete(key);

    expect(await worker.runOnce()).toBe(true);

    expect(
      db
        .select({ status: job.status })
        .from(job)
        .where(eq(job.id, deleteBlobs?.id ?? 0))
        .get(),
    ).toEqual({ status: 'succeeded' });
  });
});
