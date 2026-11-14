import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { EnvError, loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

/** How long in-flight requests get to finish after SIGTERM before the process exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function readEnv() {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      // The logger's level comes from the env, so it can't exist yet. Print plainly, without a
      // stack trace: a config problem is the operator's to fix.
      // eslint-disable-next-line no-console -- see above
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
const logger = createLogger(env.LOG_LEVEL);

// Migrations run before the server listens, so no request ever sees an old schema (ADR 0002).
function openMigratedDatabase() {
  try {
    const db = openDatabase(env.DATABASE_PATH);
    migrateDatabase(db);
    logger.info({ path: env.DATABASE_PATH }, 'database ready');
    return db;
  } catch (error) {
    logger.fatal({ err: error, path: env.DATABASE_PATH }, 'could not open or migrate the database');
    process.exit(1);
  }
}

const db = openMigratedDatabase();
const app = createApp({ logger });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  logger.info({ address: info.address, port: info.port }, 'listening');
});

/** Closes the database (checkpointing the WAL) and exits. */
function exit(code: number): never {
  db.$client.close();
  process.exit(code);
}

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'requests still open, exiting anyway');
    exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  // Stops accepting connections and calls back once in-flight requests have finished.
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'failed to close the server');
      exit(1);
    }
    exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
