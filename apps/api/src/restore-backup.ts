/**
 * Restores a backup (ADR 0018): its database, and any photos it holds into the store BLOB_STORE
 * names. With the API stopped, so nothing is written meanwhile ("Back up and restore" in docs/operating.md):
 *
 *   docker compose stop api
 *   docker compose run --rm api node src/restore-backup.ts myli-backup-2026-11-26T033000Z.zip
 *   docker compose start api
 *
 * A backup's name is looked for in BACKUP_DIR; a path is taken as it is. Without either, it lists
 * the backups in BACKUP_DIR. The database it replaces is kept beside it, renamed, and the photos
 * in the store stay. The API rebuilds the search index once it starts.
 */
import { resolve } from 'node:path';
import { backupDirectory, listBackups } from './backups/backup.ts';
import { RestoreError, restoreBackup } from './backups/restore.ts';
import { createBlobStore } from './blobs/configured.ts';
import { loadEnvOrExit } from './env.ts';
import { createLogger } from './logger.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);
const directory = backupDirectory(env);
const [name] = process.argv.slice(2);

if (name === undefined) {
  const backups = await listBackups(directory);
  if (backups.length === 0) {
    say(`There are no backups in ${directory}.`);
  } else {
    say(`The backups in ${directory}, newest first:`);
    for (const backup of backups) say(`  ${backup}`);
    say('Restore one by giving its name: node src/restore-backup.ts <name>');
  }
} else {
  const file = resolve(directory, name);
  try {
    // Which store it is, this says itself.
    const blobs = createBlobStore(env, logger.child({}, { level: 'warn' }));
    say(`Restoring ${file}.`);
    const { manifest, photos, replaced } = await restoreBackup(file, {
      databasePath: resolve(env.DATABASE_PATH),
      blobs,
      now: new Date(),
    });
    if (manifest.includesPhotos) {
      say(
        `Restored the database as it was at ${manifest.takenAt}, and ${String(photos)} photo files.`,
      );
    } else {
      say(`Restored the database as it was at ${manifest.takenAt}.`);
      say('Its photos were kept in S3, which backups leave out: they’re read from the bucket.');
    }
    if (manifest.missingPhotos.length > 0) {
      say(
        `${String(manifest.missingPhotos.length)} photo files were missing already when it was taken.`,
      );
    }
    if (replaced) say(`The database it replaced is at ${replaced}.`);
    say('Start the API: it rebuilds the search index once it starts.');
  } catch (error) {
    if (error instanceof RestoreError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      logger.fatal({ err: error }, 'could not restore the backup');
    }
    process.exitCode = 1;
  }
}
