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
import { waitForJob } from './jobs/wait.ts';
import { createLogger } from './logger.ts';
import { queueReindex } from './search/reindex.ts';

/** How long the API may take to start the rebuild before the command asks whether it's running. */
const START_HINT_MS = 10_000;

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

  let started = false;
  const hint = setTimeout(() => {
    if (!started)
      say(
        'The API hasn’t started the rebuild yet. It runs only while the API does: is it running?',
      );
  }, START_HINT_MS);
  hint.unref();

  const done = await waitForJob(db, jobId, {
    onChange({ status, attempts, lastError }) {
      if (status !== 'pending' || attempts > 0) started = true;
      if (status === 'pending' && lastError !== null) {
        say(`Attempt ${String(attempts)} failed: ${lastError}. The API will try again.`);
      }
    },
  });
  clearTimeout(hint);

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
