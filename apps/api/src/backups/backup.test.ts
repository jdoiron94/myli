import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { photoKeys } from '../blobs/copy.ts';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { type Db, openDatabase } from '../db/database.ts';
import { image, job, recipe, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { DAY_MS } from '../trash/trash.ts';
import { backupFileName, backupJob, queueBackup } from './backup.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-backup-'));
  tempDirs.push(dir);
  return dir;
}

/** A database with a recipe and its two photos, the worker that backs it up, and where to. */
async function instance() {
  const db = createTestDatabase();
  const blobs = createMemoryBlobStore();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
  const recipeId = insertRecipe(db, 'owner');
  await insertRecipeImage({ db, blobs }, recipeId);
  await insertRecipeImage({ db, blobs }, recipeId);
  // Its search update: only the backup runs here.
  db.delete(job).run();
  const logs: { level: number; msg: string; key?: string }[] = [];
  const worker = createWorker({
    services: {
      db,
      mailer: null,
      publicUrl: 'https://myli.test',
      search: { client: undefined },
      blobs,
    },
    logger: createLogger('info', { write: (line: string) => logs.push(JSON.parse(line)) }),
    jobs: allJobs,
  });
  return { db, blobs, worker, logs, directory: tempDir() };
}

const takenAt = new Date('2026-11-26T03:30:00.123Z');

/** Rows of the tables a backup must bring back, to compare one database with another. */
const contents = (db: Db) => ({
  recipes: db.select({ id: recipe.id, title: recipe.title }).from(recipe).all(),
  images: db.select().from(image).all(),
});

it('backs up the database and every photo in one zip, naming photos the store has lost', async () => {
  const { db, blobs, worker, logs, directory } = await instance();
  const [lost = '', kept = ''] = photoKeys(db);
  await blobs.delete(lost);

  queueBackup(db, { directory, keep: 7 }, takenAt);
  await worker.runOnce();

  // Nothing half-written left beside it.
  expect(readdirSync(directory)).toEqual(['myli-backup-2026-11-26T033000Z.zip']);
  const entries = unzipSync(readFileSync(join(directory, 'myli-backup-2026-11-26T033000Z.zip')));
  expect(Object.keys(entries)).toEqual(['myli.db', `photos/${kept}`, 'manifest.json']);
  const copy = join(tempDir(), 'copy.db');
  writeFileSync(copy, entries['myli.db'] ?? new Uint8Array());
  expect(contents(openDatabase(copy))).toEqual(contents(db));
  expect(entries[`photos/${kept}`]).toEqual(
    new Uint8Array(Buffer.concat((await (await blobs.get(kept))?.body.toArray()) ?? [])),
  );
  expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toEqual({
    format: 'myli.backup',
    formatVersion: 1,
    takenAt: takenAt.toISOString(),
    photos: 1,
    missingPhotos: [lost],
  });
  expect(logs.filter(({ level }) => level >= 50)).toEqual([
    expect.objectContaining({ key: lost, msg: 'photo missing from the backup' }),
  ]);
});

it('keeps the newest backups, leaving other files, and doesn’t save again one it saved', async () => {
  const { db, worker, directory } = await instance();
  const olderNames = [21, 22, 23, 24, 25].map((day) =>
    backupFileName(new Date(`2026-11-${String(day)}T03:30:00Z`)),
  );
  for (const name of [...olderNames, 'notes.txt']) writeFileSync(join(directory, name), 'older');
  const payload = { takenAt: takenAt.toISOString(), directory, keep: 3 };

  enqueueJob(db, backupJob, payload);
  await worker.runOnce();

  const name = backupFileName(takenAt);
  expect(readdirSync(directory).sort()).toEqual(
    [name, ...olderNames.slice(-2), 'notes.txt'].sort(),
  );

  // As when it ran again after a crash, or after a restore from that very backup.
  writeFileSync(join(directory, name), 'saved');
  enqueueJob(db, backupJob, payload);
  await worker.runOnce();
  expect(readFileSync(join(directory, name), 'utf8')).toBe('saved');
});

it('skips a backup on startup when there is one from the last day', async () => {
  const { db, worker, directory } = await instance();
  const settings = { directory, keep: 7 };
  const ifNoneSince = new Date(takenAt.getTime() - DAY_MS);
  const recent = backupFileName(new Date(ifNoneSince.getTime() + 1000));
  writeFileSync(join(directory, recent), 'recent');

  queueBackup(db, settings, takenAt, { ifNoneSince });
  await worker.runOnce();
  expect(readdirSync(directory)).toEqual([recent]);

  const older = backupFileName(new Date(ifNoneSince.getTime() - 1000));
  rmSync(join(directory, recent));
  writeFileSync(join(directory, older), 'older');
  queueBackup(db, settings, takenAt, { ifNoneSince });
  await worker.runOnce();
  expect(readdirSync(directory).sort()).toEqual([older, backupFileName(takenAt)]);
});
