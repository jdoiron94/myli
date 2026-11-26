import { createReadStream } from 'node:fs';
import { type FileHandle, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import { photoKeys } from '../blobs/copy.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { Db } from '../db/database.ts';
import type { Env } from '../env.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueUnlessWaiting } from '../jobs/queue.ts';
import type { Logger } from '../logger.ts';

/**
 * Backups (ADR 0018): a zip of the database, as `VACUUM INTO` copies it, and every photo it names,
 * from whichever store keeps them, in `BACKUP_DIR`. The newest `BACKUP_KEEP` are kept.
 */

/** Bumped when what a backup holds changes, so a restore can tell an older one. */
export const BACKUP_FORMAT_VERSION = 1;

/** The entries of a backup. Photos are under `PHOTOS_ENTRY`, at their keys. */
export const DATABASE_ENTRY = 'myli.db';
export const PHOTOS_ENTRY = 'photos/';
export const MANIFEST_ENTRY = 'manifest.json';

export const backupManifestSchema = z.object({
  format: z.literal('myli.backup'),
  formatVersion: z.number().int(),
  takenAt: z.iso.datetime(),
  photos: z.number().int(),
  /** Keys the database names that the store didn't have. */
  missingPhotos: z.array(z.string()),
});

/** Where backups go: `BACKUP_DIR`, or a backups directory next to the database. */
export function backupDirectory(env: Pick<Env, 'BACKUP_DIR' | 'DATABASE_PATH'>): string {
  return resolve(env.BACKUP_DIR ?? join(dirname(env.DATABASE_PATH), 'backups'));
}

export interface BackupSettings {
  directory: string;
  /** How many to keep, newest first. */
  keep: number;
}

/** Where backups go and how many are kept, or `null` when they're off (`BACKUP_KEEP=0`). */
export function backupSettings(
  env: Pick<Env, 'BACKUP_DIR' | 'BACKUP_KEEP' | 'DATABASE_PATH'>,
): BackupSettings | null {
  return env.BACKUP_KEEP === 0 ? null : { directory: backupDirectory(env), keep: env.BACKUP_KEEP };
}

/** In UTC, to the second, so names sort as the times do and suit any file system. */
const FILE_NAME = /^myli-backup-\d{4}-\d{2}-\d{2}T\d{6}Z\.zip$/;

/** `at` in UTC, to the second, for a file name: `2026-11-26T033000Z`. */
export function fileTimestamp(at: Date): string {
  const [date = '', time = ''] = at.toISOString().split('T');
  return `${date}T${time.slice(0, 8).replaceAll(':', '')}Z`;
}

/** The name of a backup taken at `at`, such as `myli-backup-2026-11-26T033000Z.zip`. */
export const backupFileName = (at: Date) => `myli-backup-${fileTimestamp(at)}.zip`;

/** The names of the backups in `directory`, newest first. Other files there are left out. */
export async function listBackups(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory))
      .filter((name) => FILE_NAME.test(name))
      .sort()
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// fflate doesn't write ZIP64, without which a zip can't hold more: refused rather than corrupted.
const ZIP_MAX_BYTES = 0xffff_ffff;
const ZIP_MAX_ENTRIES = 0xffff;

interface ArchiveSummary {
  photos: number;
  missingPhotos: string[];
}

/** Writes all of `chunk` at the file's position: one write may take only part of it. */
export async function writeAll(file: FileHandle, chunk: Uint8Array): Promise<void> {
  for (let offset = 0; offset < chunk.length; ) {
    offset += (await file.write(chunk, offset)).bytesWritten;
  }
}

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The backup's zip, as chunks made as they're read: the database a megabyte at a time, then one
 * photo at a time, then the manifest. `summary` is filled in as it goes. The database is
 * compressed; photos, already WebP, are stored as they are.
 */
async function* backupArchive(
  snapshot: string,
  keys: readonly string[],
  summary: ArchiveSummary,
  { blobs, logger, takenAt }: { blobs: BlobStore; logger: Logger; takenAt: Date },
): AsyncGenerator<Uint8Array> {
  const chunks: Uint8Array[] = [];
  // Every entry is compressed synchronously, so its chunks are out as soon as it's pushed.
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const entry = (name: string, compress: boolean) => {
    const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    file.mtime = takenAt;
    zip.add(file);
    return file;
  };

  const database = entry(DATABASE_ENTRY, true);
  for await (const chunk of createReadStream(snapshot, { highWaterMark: 1 << 20 })) {
    database.push(chunk as Buffer);
    yield* chunks.splice(0);
  }
  database.push(new Uint8Array(0), true);
  yield* chunks.splice(0);

  for (const key of keys) {
    const blob = await blobs.get(key);
    if (!blob) {
      // Its row says it's there: a store that lost files, or was restored without them.
      logger.error({ key }, 'photo missing from the backup');
      summary.missingPhotos.push(key);
      continue;
    }
    entry(`${PHOTOS_ENTRY}${key}`, false).push(Buffer.concat(await blob.body.toArray()), true);
    summary.photos++;
    yield* chunks.splice(0);
  }

  entry(MANIFEST_ENTRY, true).push(
    json({
      format: 'myli.backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      takenAt: takenAt.toISOString(),
      ...summary,
    } satisfies z.input<typeof backupManifestSchema>),
    true,
  );
  zip.end();
  yield* chunks.splice(0);
}

/** Writes the backup to `name` in `directory`, through a hidden file renamed once complete. */
async function writeBackup(
  directory: string,
  name: string,
  takenAt: Date,
  { db, blobs, logger }: { db: Db; blobs: BlobStore; logger: Logger },
) {
  const file = join(directory, name);
  const partial = join(directory, `.${name}.partial`);
  const snapshot = join(directory, `.${name}.db`);
  // Left by a run that stopped partway: VACUUM INTO won't write over a file.
  await rm(snapshot, { force: true });
  try {
    // Both synchronous, one after the other, so the photos are the ones this copy names. None of
    // them can be deleted meanwhile: only a job deletes photos, and the worker runs one at a time.
    db.$client.prepare('VACUUM INTO ?').run(snapshot);
    const keys = photoKeys(db);
    if (keys.length + 2 > ZIP_MAX_ENTRIES) {
      throw new Error(`a backup can’t hold ${String(keys.length)} photo files, more than zip can`);
    }

    const summary: ArchiveSummary = { photos: 0, missingPhotos: [] };
    let bytes = 0;
    const out = await open(partial, 'w');
    try {
      for await (const chunk of backupArchive(snapshot, keys, summary, {
        blobs,
        logger,
        takenAt,
      })) {
        bytes += chunk.length;
        if (bytes > ZIP_MAX_BYTES) {
          throw new Error('the backup is over 4 GB, more than zip can hold');
        }
        await writeAll(out, chunk);
      }
      await out.sync();
    } finally {
      await out.close();
    }
    await rename(partial, file);
    logger.info(
      { file, bytes, photos: summary.photos, missingPhotos: summary.missingPhotos.length },
      'backup saved',
    );
  } finally {
    await rm(snapshot, { force: true });
    await rm(partial, { force: true });
  }
}

/**
 * Backs up the database and its photos into `directory`, named after `takenAt`, then deletes all
 * but the newest `keep` backups there. With `ifNoneSince`, it's skipped if a backup there is from
 * then or later. Run again after a backup it saved, it saves none.
 */
export const backupJob = defineJob({
  type: 'backup.create',
  payload: z.object({
    takenAt: z.iso.datetime(),
    directory: z.string().min(1),
    keep: z.number().int().min(1),
    ifNoneSince: z.iso.datetime().optional(),
  }),
  async handle({ takenAt, directory, keep, ifNoneSince }, { services: { db, blobs }, logger }) {
    await mkdir(directory, { recursive: true });
    const backups = await listBackups(directory);
    const [newest] = backups;
    if (
      ifNoneSince !== undefined &&
      newest !== undefined &&
      newest >= backupFileName(new Date(ifNoneSince))
    ) {
      logger.info({ newest }, 'skipped the backup: there is a recent one');
      return;
    }

    const name = backupFileName(new Date(takenAt));
    // Otherwise saved already, by a run that stopped before it was marked done, or before a restore.
    if (!backups.includes(name)) {
      await writeBackup(directory, name, new Date(takenAt), { db, blobs, logger });
    }

    const older = (await listBackups(directory)).slice(keep);
    for (const old of older) await rm(join(directory, old), { force: true });
    if (older.length > 0) logger.info({ files: older }, 'deleted older backups');
  },
});

/**
 * Queues a backup taken at `now`, unless one is already waiting or under way. Its job's ID, either
 * way. With `ifNoneSince`, the backup is skipped if there's one from then or later.
 */
export function queueBackup(
  db: Db,
  settings: BackupSettings,
  now: Date,
  { ifNoneSince }: { ifNoneSince?: Date } = {},
): number {
  return enqueueUnlessWaiting(db, backupJob, {
    takenAt: now.toISOString(),
    ...settings,
    ...(ifNoneSince && { ifNoneSince: ifNoneSince.toISOString() }),
  });
}
