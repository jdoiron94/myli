import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { photoKeys } from '../blobs/copy.ts';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { migrateDatabase, openDatabase } from '../db/database.ts';
import { job, user } from '../db/schema.ts';
import { RestoreError, restoreBackup } from './restore.ts';
import { backedUpRows, sampleInstance, takeBackup, tempDir } from './testing.ts';

const takenAt = new Date('2026-11-26T03:30:00Z');
const now = new Date('2026-11-27T12:00:00Z');

/** The bytes of every blob under `keys` in `store`. */
const contentsOf = async (store: ReturnType<typeof createMemoryBlobStore>, keys: string[]) =>
  Promise.all(
    keys.map(async (key) => Buffer.concat((await (await store.get(key))?.body.toArray()) ?? [])),
  );

it('restores the database and photos, moving aside the database it replaces, WAL and all', async () => {
  const source = await sampleInstance();
  const file = await takeBackup(source, tempDir(), takenAt);
  // The database it replaces, as an API killed partway leaves it: its last write still in its WAL.
  const databasePath = join(tempDir(), 'myli.db');
  const live = openDatabase(join(tempDir(), 'live.db'));
  migrateDatabase(live);
  live.$client.pragma('wal_autocheckpoint = 0');
  live.insert(user).values({ id: 'later', name: 'Later', email: 'later@example.com' }).run();
  copyFileSync(live.$client.name, databasePath);
  copyFileSync(`${live.$client.name}-wal`, `${databasePath}-wal`);
  live.$client.close();
  const blobs = createMemoryBlobStore();

  const result = await restoreBackup(file, { databasePath, blobs, now });

  const replaced = `${databasePath}.before-restore-2026-11-27T120000Z`;
  expect(result).toEqual({
    manifest: expect.objectContaining({ takenAt: takenAt.toISOString(), photos: 2 }),
    photos: 2,
    replaced,
  });
  // No WAL beside the restored database, which SQLite would read into it.
  expect(readdirSync(dirname(databasePath)).sort()).toEqual(
    ['myli.db', basename(replaced), `${basename(replaced)}-wal`].sort(),
  );
  const restored = openDatabase(databasePath);
  expect(backedUpRows(restored)).toEqual(backedUpRows(source.db));
  expect(restored.select().from(user).where(eq(user.id, 'later')).all()).toEqual([]);
  expect(restored.select({ type: job.type, status: job.status }).from(job).all()).toContainEqual({
    type: 'search.reindex',
    status: 'pending',
  });
  const keys = photoKeys(source.db);
  expect(blobs.keys().sort()).toEqual([...keys].sort());
  expect(await contentsOf(blobs, keys)).toEqual(await contentsOf(source.blobs, keys));
  expect(openDatabase(replaced).select({ id: user.id }).from(user).all()).toContainEqual({
    id: 'later',
  });
});

it('refuses what isn’t a backup it can restore, leaving the database as it is', async () => {
  const backup = unzipSync(
    readFileSync(await takeBackup(await sampleInstance(), tempDir(), takenAt)),
  );
  const manifest = JSON.parse(new TextDecoder().decode(backup['manifest.json'])) as object;
  const dir = tempDir();
  const write = (name: string, contents: Uint8Array) => {
    writeFileSync(join(dir, name), contents);
    return join(dir, name);
  };
  const cases = {
    missing: join(dir, 'missing.zip'),
    'not a zip': write('notes.zip', strToU8('Notes')),
    'without a manifest': write(
      'no-manifest.zip',
      zipSync({ 'myli.db': backup['myli.db'] ?? new Uint8Array() }),
    ),
    'from a newer myli': write(
      'newer.zip',
      zipSync({
        ...backup,
        'manifest.json': strToU8(JSON.stringify({ ...manifest, formatVersion: 2 })),
      }),
    ),
    'naming a place outside the store': write(
      'outside.zip',
      zipSync({ ...backup, 'photos/../../config.webp': strToU8('') }),
    ),
    'with a damaged database': write(
      'damaged.zip',
      zipSync({
        ...backup,
        'myli.db': strToU8('Not a database, but long enough to be read as one.'),
      }),
    ),
  };
  const databasePath = join(tempDir(), 'myli.db');
  writeFileSync(databasePath, 'As it was');

  const results: Record<string, string> = {};
  for (const [name, file] of Object.entries(cases)) {
    const outcome = await restoreBackup(file, {
      databasePath,
      blobs: createMemoryBlobStore(),
      now,
    }).then(
      () => 'restored',
      (error: unknown) =>
        error instanceof RestoreError ? error.message.replace(file, 'It') : error,
    );
    results[name] = String(outcome);
  }

  expect(results).toEqual({
    missing: 'There’s no It.',
    'not a zip': 'It isn’t a myli backup: it has no database or manifest.',
    'without a manifest': 'It isn’t a myli backup: it has no database or manifest.',
    'from a newer myli': 'It is from a newer version of myli: upgrade first.',
    'naming a place outside the store':
      'It isn’t a myli backup: it holds photos/../../config.webp.',
    'with a damaged database': 'It holds a damaged database.',
  });
  expect(readdirSync(dirname(databasePath))).toEqual(['myli.db']);
  expect(readFileSync(databasePath, 'utf8')).toBe('As it was');
});
