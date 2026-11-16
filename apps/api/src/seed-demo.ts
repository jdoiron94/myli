/**
 * Creates one demo account per role on a new instance, and prints their passwords, once:
 *
 *   docker compose exec api node src/seed-demo.ts    (in the API's container)
 *   pnpm seed                                         (here, with the repo's .env)
 *
 * It reads the API's configuration (the database, the public address) and refuses once any user
 * exists (`setup/demo.ts`). Logs go to stderr, so stdout holds only the accounts.
 */
import { createAuth } from './auth/auth.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { loadEnvOrExit } from './env.ts';
import { createLogger } from './logger.ts';
import { seedDemoAccounts } from './setup/demo.ts';

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);

const REFUSALS = {
  'users-exist':
    'This instance already has users, so no demo accounts were created: they are only for a new instance.',
  'in-progress':
    'First-run setup is under way, so no demo accounts were created. Try again in a few minutes.',
};

const db = openDatabase(env.DATABASE_PATH);
try {
  // The API may not have started on this database yet.
  migrateDatabase(db);
  const auth = createAuth({ db, env, logger });
  const result = await seedDemoAccounts({
    db,
    auth,
    logger,
    publicUrl: env.PUBLIC_URL,
    ttlDays: env.INVITATION_TTL_DAYS,
  });
  if (result.ok) {
    const width = Math.max(...result.accounts.map(({ email }) => email.length));
    process.stdout.write(
      [
        'Created a demo account for each role. Their passwords are shown only this once:',
        '',
        ...result.accounts.map(
          ({ role, email, password }) => `  ${role.padEnd(6)}  ${email.padEnd(width)}  ${password}`,
        ),
        '',
        `Sign in at ${env.PUBLIC_URL}`,
        '',
      ].join('\n'),
    );
  } else {
    process.stderr.write(`${REFUSALS[result.reason]}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  logger.fatal({ err: error }, 'could not create the demo accounts');
  process.exitCode = 1;
} finally {
  db.$client.close();
}
