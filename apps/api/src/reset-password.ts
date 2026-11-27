/**
 * Prints a reset link for an account, for whoever runs the server to pass on (ADR 0019): the way to
 * reset a password without email, and for an instance whose only admin forgot theirs.
 *
 *   docker compose exec api node src/reset-password.ts <email>    (in the API's container)
 *   pnpm reset-password <email>                                   (here, with the repo's .env)
 *
 * The link works once, for an hour, as an emailed one does, and replaces any sent before. Any active
 * account gets one, verified or not: whoever can run this can read the database already.
 */
import { emailSchema } from '@myli/shared';
import { operatorResetLink } from './account/password-reset.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { loadEnvOrExit } from './env.ts';
import { createLogger } from './logger.ts';
import { formatExpiry } from './mail/expiry.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);
function refuse(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);
const [address] = process.argv.slice(2);
if (address === undefined) refuse('Give the account’s address: node src/reset-password.ts <email>');
const parsed = emailSchema.safeParse(address);
if (!parsed.success) refuse(`${address} isn’t an email address.`);
const email = parsed.data;

const db = openDatabase(env.DATABASE_PATH);
try {
  // The API may not have started on this database since it was upgraded.
  migrateDatabase(db);
  const result = operatorResetLink(db, { email, publicUrl: env.PUBLIC_URL, at: new Date() });
  if (result.ok) {
    say(`A reset link for ${email}. It works once, until ${formatExpiry(result.expiresAt)}:`);
    say(result.link);
    say('Give it only to them: whoever opens it can choose the account’s password.');
  } else if (result.reason === 'no-account') {
    process.stderr.write(`There’s no account with the address ${email}.\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(
      `The account of ${email} is deactivated. An admin can reactivate it on the Users page.\n`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  logger.fatal({ err: error }, 'could not make a reset link');
  process.exitCode = 1;
} finally {
  db.$client.close();
}
