/**
 * Rebuilds the search index from the database (spec §4):
 *
 *   docker compose exec api node src/reindex-search.ts    (in the API's container)
 *   pnpm reindex                                           (here, with the repo's .env)
 *
 * It queues the rebuild for the running API, whose worker runs one job at a time so that no index
 * update is lost in the swap, and waits for it to finish. Stopping the command doesn't stop the
 * rebuild. If one is already waiting or under way, it waits for that one.
 */
import { migrateDatabase, openDatabase } from './db/database.ts';
import { loadEnvOrExit } from './env.ts';
import { followJob } from './jobs/wait.ts';
import { createLogger } from './logger.ts';
import { queueReindex } from './search/reindex.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);
const db = openDatabase(env.DATABASE_PATH);
try {
  // The API may not have started on this database yet.
  migrateDatabase(db);
  const jobId = queueReindex(db);
  say(
    'Rebuilding the search index. The API does it in the background, so stopping this command won’t stop it.',
  );

  const done = await followJob(db, jobId, { task: 'the rebuild', say });
  if (done.status === 'succeeded') {
    say('Rebuilt the search index.');
  } else {
    process.stderr.write(
      `The rebuild failed for the last time: ${done.lastError ?? 'no reason given'}\n`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  logger.fatal({ err: error }, 'could not queue or follow the rebuild');
  process.exitCode = 1;
} finally {
  db.$client.close();
}
