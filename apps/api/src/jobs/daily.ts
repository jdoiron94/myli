import { Cron } from 'croner';
import type { Db } from '../db/database.ts';
import type { Logger } from '../logger.ts';
import { queueTrashPurge } from '../trash/purge.ts';

/** Every day at 03:30, in the server's time zone: a quiet hour, in a household. */
export const DAILY_SCHEDULE = '30 3 * * *';

/**
 * Queues the daily upkeep now, then every day at `DAILY_SCHEDULE`: purging the trash. Queuing it on
 * startup too means a server that's off at that hour still gets it. Each job is queued only while
 * none of its kind waits, so restarts don't pile them up. Stop it on shutdown.
 */
export function scheduleDailyJobs({
  db,
  logger,
  trashRetentionDays,
}: {
  db: Db;
  logger: Logger;
  trashRetentionDays: number;
}) {
  const queue = () => {
    queueTrashPurge(db, trashRetentionDays);
  };
  queue();
  const cron = new Cron(
    DAILY_SCHEDULE,
    {
      catch: (error) => {
        logger.error({ err: error }, 'could not queue the daily jobs');
      },
    },
    queue,
  );
  return {
    stop: () => {
      cron.stop();
    },
  };
}
