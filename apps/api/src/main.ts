import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { EnvError, loadEnv } from './env.ts';

/** How long in-flight requests get to finish after SIGTERM before the process exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function readEnv() {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      // A config problem is the operator's to fix, so print the message without a stack trace.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
const app = createApp();

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`myli API listening on ${info.address}:${info.port}`);
});

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, shutting down`);
  setTimeout(() => {
    console.error(`Requests still open after ${SHUTDOWN_TIMEOUT_MS} ms, exiting anyway`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  // Stops accepting connections and resolves once in-flight requests have finished.
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
