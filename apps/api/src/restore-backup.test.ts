import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { backupFileName } from './backups/backup.ts';
import { sampleInstance, takeBackup, tempDir } from './backups/testing.ts';
import { photoKeys } from './blobs/copy.ts';
import { createLocalBlobStore } from './blobs/local.ts';

const SCRIPT = fileURLToPath(new URL('restore-backup.ts', import.meta.url));

it('lists the backups, then restores one by its name, photos into BLOB_DIR', async () => {
  const source = await sampleInstance();
  const backups = tempDir();
  const takenAt = new Date('2026-11-26T03:30:00Z');
  await takeBackup(source, backups, takenAt);
  const data = tempDir();
  // Only these, so the developer's shell and .env can't leak in.
  const env = {
    PATH: process.env.PATH,
    PUBLIC_URL: 'http://127.0.0.1',
    BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
    MEILI_URL: 'http://127.0.0.1:7700',
    MEILI_MASTER_KEY: 'master-key-hunter2-secret',
    DATABASE_PATH: join(data, 'myli.db'),
    BLOB_DIR: join(data, 'blobs'),
    BACKUP_DIR: backups,
  };
  const run = (...args: string[]) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, ...args], {
      env,
      encoding: 'utf8',
    });
    return { status, stdout: stdout.trimEnd().split('\n'), stderr };
  };

  expect(run()).toEqual({
    status: 0,
    stdout: [
      `The backups in ${backups}, newest first:`,
      `  ${backupFileName(takenAt)}`,
      'Restore one by giving its name: node src/restore-backup.ts <name>',
    ],
    stderr: '',
  });

  expect(run(backupFileName(takenAt))).toEqual({
    status: 0,
    stdout: [
      `Restoring ${join(backups, backupFileName(takenAt))}.`,
      'Restored the database as it was at 2026-11-26T03:30:00.000Z, and 2 photo files.',
      'Start the API: it rebuilds the search index once it starts.',
    ],
    stderr: '',
  });
  const restored = createLocalBlobStore(env.BLOB_DIR);
  const found = await Promise.all(
    photoKeys(source.db).map(async (key) => {
      const blob = await restored.get(key);
      blob?.body.destroy();
      return blob !== null;
    }),
  );
  expect(found).toEqual([true, true]);
});
