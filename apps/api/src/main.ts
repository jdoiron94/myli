import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { EnvError, loadEnv } from './env.ts';
import { allJobs } from './jobs/all.ts';
import { createWorker } from './jobs/worker.ts';
import { createLogger } from './logger.ts';
import type { Mailer } from './mail/mailer.ts';
import { checkSmtpServer, createSmtpMailer, smtpConfigFrom } from './mail/smtp.ts';
import { seedFirstAdmin } from './setup/seed.ts';

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
const auth = createAuth({ db, env, logger });

// Before the server listens, so it can't race the setup endpoint.
try {
  await seedFirstAdmin({ db, auth, logger }, env);
} catch (error) {
  logger.fatal({ err: error }, 'could not create the first admin from the environment');
  db.$client.close();
  process.exit(1);
}

let mailer: Mailer | null = null;
const smtp = smtpConfigFrom(env);
if (smtp) {
  mailer = createSmtpMailer(smtp);
  void checkSmtpServer(mailer, smtp, logger);
} else {
  logger.info('email is off because SMTP_HOST is not set');
}

const worker = createWorker({ services: { db, mailer }, logger, jobs: allJobs });
const requeued = worker.recoverInterrupted();
if (requeued > 0) {
  logger.warn({ count: requeued }, 'requeued jobs interrupted by the last shutdown');
}
worker.start();
logger.info('job worker started');

const app = createApp({ logger, auth, db, env });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  logger.info({ address: info.address, port: info.port }, 'listening');
});

/** Stops accepting connections and resolves once in-flight requests have finished. */
function closeServer() {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Closes the database (checkpointing the WAL) and exits. */
function exit(code: number): never {
  db.$client.close();
  process.exit(code);
}

async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => {
    logger.error(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      'requests or a job still running, exiting anyway',
    );
    exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await Promise.all([closeServer(), worker.stop()]);
  } catch (error) {
    logger.error({ err: error }, 'failed to shut down cleanly');
    exit(1);
  }
  exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
