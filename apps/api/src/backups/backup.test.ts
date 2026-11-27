import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { photoKeys } from '../blobs/copy.ts';
import { openDatabase } from '../db/database.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { createLogger } from '../logger.ts';
import { DAY_MS } from '../trash/trash.ts';
import { backupFileName, backupJob, queueBackup } from './backup.ts';
import { backedUpRows, sampleInstance, tempDir, workerFor } from './testing.ts';

/** A database with a recipe and its two photos, the worker that backs it up, and where to. */
async function instance() {
  const sample = await sampleInstance();
  const logs: { level: number; msg: string; key?: string }[] = [];
  const logger = createLogger('info', { write: (line: string) => logs.push(JSON.parse(line)) });
  return { ...sample, worker: workerFor(sample, logger), logs, directory: tempDir() };
}

const takenAt = new Date('2026-11-26T03:30:00.123Z');

it('backs up the database and every photo in one zip, naming photos the store has lost', async () => {
  const { db, blobs, worker, logs, directory } = await instance();
  const [lost = '', kept = ''] = photoKeys(db);
  await blobs.delete(lost);

  queueBackup(db, { directory, keep: 7, photos: true }, takenAt);
  await worker.runOnce();

  // Nothing half-written left beside it.
  expect(readdirSync(directory)).toEqual(['myli-backup-2026-11-26T033000Z.zip']);
  const entries = unzipSync(readFileSync(join(directory, 'myli-backup-2026-11-26T033000Z.zip')));
  expect(Object.keys(entries)).toEqual(['myli.db', `photos/${kept}`, 'manifest.json']);
  const copy = join(tempDir(), 'copy.db');
  writeFileSync(copy, entries['myli.db'] ?? new Uint8Array());
  expect(backedUpRows(openDatabase(copy))).toEqual(backedUpRows(db));
  expect(entries[`photos/${kept}`]).toEqual(
    new Uint8Array(Buffer.concat((await (await blobs.get(kept))?.body.toArray()) ?? [])),
  );
  expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toEqual({
    format: 'myli.backup',
    formatVersion: 1,
    takenAt: takenAt.toISOString(),
    includesPhotos: true,
    photos: 1,
    missingPhotos: [lost],
  });
  expect(logs.filter(({ level }) => level >= 50)).toEqual([
    expect.objectContaining({ key: lost, msg: 'photo missing from the backup' }),
  ]);
});

it('leaves the photos out when they’re kept in S3, never reading the store', async () => {
  const sample = await sampleInstance();
  const directory = tempDir();
  // A bucket that any read of would fail the backup.
  const blobs = { ...sample.blobs, get: () => Promise.reject(new Error('read the bucket')) };

  queueBackup(sample.db, { directory, keep: 7, photos: false }, takenAt);
  await workerFor({ ...sample, blobs }).runOnce();

  const entries = unzipSync(readFileSync(join(directory, backupFileName(takenAt))));
  expect(Object.keys(entries)).toEqual(['myli.db', 'manifest.json']);
  expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toEqual(
    expect.objectContaining({ includesPhotos: false, photos: 0, missingPhotos: [] }),
  );
});

it('keeps the newest backups, leaving other files, and doesn’t save again one it saved', async () => {
  const { db, worker, directory } = await instance();
  const olderNames = [21, 22, 23, 24, 25].map((day) =>
    backupFileName(new Date(`2026-11-${String(day)}T03:30:00Z`)),
  );
  for (const name of [...olderNames, 'notes.txt']) writeFileSync(join(directory, name), 'older');
  const payload = { takenAt: takenAt.toISOString(), directory, keep: 3, photos: true };

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
  const settings = { directory, keep: 7, photos: true };
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
