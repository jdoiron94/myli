import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import type { z } from 'zod';
import { type BlobStore, blobContentType } from '../blobs/store.ts';
import { migrateDatabase, openDatabase } from '../db/database.ts';
import { queueReindex } from '../search/reindex.ts';
import {
  BACKUP_FORMAT_VERSION,
  backupManifestSchema,
  DATABASE_ENTRY,
  fileTimestamp,
  MANIFEST_ENTRY,
  PHOTOS_ENTRY,
  writeAll,
} from './backup.ts';

/** Why a backup can't be restored, for whoever runs the restore. Nothing was changed. */
export class RestoreError extends Error {}

/** What's done with one entry of a zip: each of its chunks in turn, then its end. */
interface EntryReader {
  data(chunk: Uint8Array): void | Promise<void>;
  end(): void | Promise<void>;
}

/**
 * Reads the zip at `file` a chunk at a time, giving each entry to the reader `onEntry` returns for
 * its name, or skipping it for `null`. Readers' work is done in order, and all of it before the
 * next chunk is read, so nothing piles up in memory.
 */
async function readZip(file: string, onEntry: (name: string) => EntryReader | null) {
  let work = Promise.resolve();
  const then = (step: () => void | Promise<void>) => {
    work = work.then(step);
  };
  const unzip = new Unzip((entry) => {
    const reader = onEntry(entry.name);
    if (!reader) return;
    entry.ondata = (error, chunk, final) => {
      if (error) throw error;
      // fflate hands on views of what it was given, which the next chunk read may reuse.
      const copy = chunk.slice();
      then(() => reader.data(copy));
      if (final) then(() => reader.end());
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of createReadStream(file)) {
    unzip.push(chunk as Buffer);
    await work;
  }
  unzip.push(new Uint8Array(0), true);
  await work;
}

/** Collects an entry's chunks, then hands them on as one. */
function collect(done: (data: Buffer) => void | Promise<void>): EntryReader {
  const chunks: Uint8Array[] = [];
  return {
    data: (chunk) => {
      chunks.push(chunk);
    },
    end: () => done(Buffer.concat(chunks)),
  };
}

/** Reads and checks what's in the backup, without keeping anything but its manifest. */
async function checkBackup(file: string) {
  if (!existsSync(file)) throw new RestoreError(`There’s no ${file}.`);
  let manifest: unknown;
  const names: string[] = [];
  try {
    await readZip(file, (name) => {
      names.push(name);
      return name === MANIFEST_ENTRY
        ? collect((data) => {
            try {
              manifest = JSON.parse(data.toString('utf8'));
            } catch {
              // Not a manifest, as the schema then says.
            }
          })
        : null;
    });
  } catch {
    throw new RestoreError(`${file} isn’t a myli backup: it can’t be read as a zip file.`);
  }
  const parsed = backupManifestSchema.safeParse(manifest);
  if (!parsed.success || !names.includes(DATABASE_ENTRY)) {
    throw new RestoreError(`${file} isn’t a myli backup: it has no database or manifest.`);
  }
  if (parsed.data.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new RestoreError(`${file} is from a newer version of myli: upgrade first.`);
  }
  for (const name of names) {
    if (name === DATABASE_ENTRY || name === MANIFEST_ENTRY) continue;
    // A photo's key, which can't name a place outside its store.
    const key = name.startsWith(PHOTOS_ENTRY) ? name.slice(PHOTOS_ENTRY.length) : null;
    if (key === null || !isBlobKey(key)) {
      throw new RestoreError(`${file} isn’t a myli backup: it holds ${name}.`);
    }
  }
  return parsed.data;
}

function isBlobKey(key: string) {
  try {
    blobContentType(key);
    return true;
  } catch {
    return false;
  }
}

/** The database restored at `path`, from the backup at `file`, once SQLite finds it whole. */
function openRestored(path: string, file: string) {
  const damaged = () => new RestoreError(`${file} holds a damaged database.`);
  let db;
  try {
    db = openDatabase(path);
  } catch (error) {
    const { code } = error as { code?: unknown };
    if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') throw damaged();
    throw error;
  }
  if (db.$client.pragma('quick_check', { simple: true }) !== 'ok') {
    db.$client.close();
    throw damaged();
  }
  return db;
}

/** A database file's companions, which SQLite finds by its name. */
const DATABASE_FILES = ['', '-wal', '-shm'];

/** Renames the database and its companions, as one, if it's there. */
async function moveDatabase(from: string, to: string) {
  for (const suffix of DATABASE_FILES) {
    if (existsSync(from + suffix)) await rename(from + suffix, to + suffix);
  }
}

export interface RestoreResult {
  manifest: z.output<typeof backupManifestSchema>;
  /** Photo files put in the store. */
  photos: number;
  /** Where the database it replaced was moved, or `null` if there was none. */
  replaced: string | null;
}

/**
 * Restores the backup at `file` (ADR 0018), with the API stopped: any photos it holds into
 * `blobs`, then its database at `databasePath`, migrated, with a rebuild of the search index
 * queued for when the API starts. The database it replaces, if any, is moved aside, named after `now`, never
 * deleted. Photos already in the store stay, and those it puts are the same files, since keys
 * never change. Throws a `RestoreError`, leaving the database as it was, if the file isn't a
 * backup it can restore.
 */
export async function restoreBackup(
  file: string,
  { databasePath, blobs, now }: { databasePath: string; blobs: BlobStore; now: Date },
): Promise<RestoreResult> {
  const manifest = await checkBackup(file);

  // Beside the database, so it can be renamed into place.
  await mkdir(dirname(databasePath), { recursive: true });
  const staged = `${databasePath}.restoring`;
  const removeStaged = async () => {
    for (const suffix of DATABASE_FILES) await rm(staged + suffix, { force: true });
  };
  await removeStaged();
  let photos = 0;
  try {
    const out = await open(staged, 'w');
    try {
      await readZip(file, (name) => {
        if (name === DATABASE_ENTRY) {
          return { data: (chunk) => writeAll(out, chunk), end: () => out.sync() };
        }
        if (!name.startsWith(PHOTOS_ENTRY)) return null;
        const key = name.slice(PHOTOS_ENTRY.length);
        return collect(async (data) => {
          await blobs.put(key, data, { contentType: blobContentType(key) });
          photos++;
        });
      });
    } finally {
      await out.close();
    }

    const db = openRestored(staged, file);
    try {
      // A backup from an older version of myli, which the API would migrate as it starts anyway.
      migrateDatabase(db);
      queueReindex(db);
    } finally {
      // Closing the last connection writes the WAL into the file and deletes it.
      db.$client.close();
    }
  } catch (error) {
    await removeStaged();
    throw error;
  }

  // A WAL alone too, which SQLite would read into the restored database.
  const replaced = DATABASE_FILES.some((suffix) => existsSync(databasePath + suffix))
    ? `${databasePath}.before-restore-${fileTimestamp(now)}`
    : null;
  if (replaced) await moveDatabase(databasePath, replaced);
  await rename(staged, databasePath);
  return { manifest, photos, replaced };
}
