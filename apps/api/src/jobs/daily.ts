import { Cron } from 'croner';
import { type BackupSettings, queueBackup } from '../backups/backup.ts';
import type { Db } from '../db/database.ts';
import { queueImageSweep } from '../images/sweep.ts';
import type { Logger } from '../logger.ts';
import { queueTrashPurge } from '../trash/purge.ts';
import { DAY_MS } from '../trash/trash.ts';

/** Every day at 03:30, in the server's time zone: a quiet hour, in a household. */
export const DAILY_SCHEDULE = '30 3 * * *';

/**
 * Queues the daily upkeep now, then every day at `DAILY_SCHEDULE`: a backup, unless `backups` is
 * null, while it still has what the rest deletes; purging the trash; then deleting photos nothing
 * shows any more, including ones only purged recipes did. Queuing it on startup too means a server
 * that's off at that hour still gets it, though a backup only if the last is a day old, so that
 * restarts can't push out the week's backups. Each job is queued only while none of its kind
 * waits, so restarts don't pile them up. Stop it on shutdown.
 */
export function scheduleDailyJobs({
  db,
  logger,
  trashRetentionDays,
  backups,
}: {
  db: Db;
  logger: Logger;
  trashRetentionDays: number;
  backups: BackupSettings | null;
}) {
  const queue = (onStartup: boolean) => {
    const now = new Date();
    if (backups) {
      const ifNoneSince = onStartup ? new Date(now.getTime() - DAY_MS) : undefined;
      queueBackup(db, backups, now, { ifNoneSince });
    }
    queueTrashPurge(db, trashRetentionDays, now);
    queueImageSweep(db, now);
  };
  queue(true);
  const cron = new Cron(
    DAILY_SCHEDULE,
    {
      catch: (error) => {
        logger.error({ err: error }, 'could not queue the daily jobs');
      },
    },
    () => {
      queue(false);
    },
  );
  return {
    stop: () => {
      cron.stop();
    },
  };
}
