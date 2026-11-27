import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import type { Db } from '../db/database.ts';
import { image, job, recipe, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger, type Logger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { backupFileName, queueBackup } from './backup.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new temporary directory, removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'myli-backup-'));
  tempDirs.push(dir);
  return dir;
}

/** A database with a recipe and its two photos, in a store in memory, and nothing queued. */
export async function sampleInstance() {
  const db = createTestDatabase();
  const blobs = createMemoryBlobStore();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
  const recipeId = insertRecipe(db, 'owner');
  await insertRecipeImage({ db, blobs }, recipeId);
  await insertRecipeImage({ db, blobs }, recipeId);
  // Its search update: only what the test queues runs.
  db.delete(job).run();
  return { db, blobs };
}

/** A worker for `instance`'s jobs. */
export function workerFor(
  { db, blobs }: Awaited<ReturnType<typeof sampleInstance>>,
  logger: Logger = createLogger('silent'),
) {
  return createWorker({
    services: {
      db,
      mailer: null,
      publicUrl: 'https://myli.test',
      search: { client: undefined },
      blobs,
    },
    logger,
    jobs: allJobs,
  });
}

/** Backs up `instance` into `directory`, as the job does, photos included. The backup's path. */
export async function takeBackup(
  instance: Awaited<ReturnType<typeof sampleInstance>>,
  directory: string,
  takenAt: Date,
): Promise<string> {
  queueBackup(instance.db, { directory, keep: 7, photos: true }, takenAt);
  await workerFor(instance).runOnce();
  return join(directory, backupFileName(takenAt));
}

/** Rows of the tables a backup must bring back, to compare one database with another. */
export const backedUpRows = (db: Db) => ({
  recipes: db.select({ id: recipe.id, title: recipe.title }).from(recipe).all(),
  images: db.select().from(image).all(),
});
