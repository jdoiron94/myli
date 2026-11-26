/**
 * Backs up the instance now, as it does every night (ADR 0018), into BACKUP_DIR:
 *
 *   docker compose exec api node src/backup-now.ts    (in the API's container)
 *   pnpm backup                                       (here, with the repo's .env)
 *
 * It queues the backup for the running API's worker, waits for it, and says where it saved it.
 * Stopping the command doesn't stop the backup. It counts among the BACKUP_KEEP that are kept.
 */
import { join } from 'node:path';
import { backupFileName, backupJob, backupSettings } from './backups/backup.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { loadEnvOrExit } from './env.ts';
import { enqueueJob } from './jobs/queue.ts';
import { followJob } from './jobs/wait.ts';
import { createLogger } from './logger.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);
const settings = backupSettings(env);
if (!settings) {
  process.stderr.write('Backups are off: BACKUP_KEEP is 0.\n');
  process.exit(1);
}

const db = openDatabase(env.DATABASE_PATH);
try {
  // The API may not have started on this database since it was upgraded.
  migrateDatabase(db);
  const takenAt = new Date();
  // Never one already waiting, as a rebuild of the index would: that might be skipped.
  const jobId = enqueueJob(db, backupJob, { takenAt: takenAt.toISOString(), ...settings });
  say('Backing up. The API does it in the background, so stopping this command won’t stop it.');

  const done = await followJob(db, jobId, { task: 'the backup', say });
  if (done.status === 'succeeded') {
    say(`Saved ${join(settings.directory, backupFileName(takenAt))}`);
  } else {
    process.stderr.write(
      `The backup failed for the last time: ${done.lastError ?? 'no reason given'}\n`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  logger.fatal({ err: error }, 'could not queue or follow the backup');
  process.exitCode = 1;
} finally {
  db.$client.close();
}
