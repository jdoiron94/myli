/**
 * Copies the photos into the store BLOB_STORE names from the other one, to switch where they're
 * kept ("Keep photos in S3" in docs/operating.md). With BLOB_STORE=s3, from BLOB_DIR into the bucket; with
 * BLOB_STORE=local, from the bucket, which the S3_* variables still name, into BLOB_DIR. Run it
 * with the API stopped, so no photo is uploaded meanwhile:
 *
 *   docker compose run --rm api node src/copy-photos.ts
 *
 * Nothing is deleted from either store, and a photo copied already is left as it is.
 */
import { createBlobStore, s3Options } from './blobs/configured.ts';
import { copyPhotos } from './blobs/copy.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { loadEnvOrExit } from './env.ts';
import { createLogger } from './logger.ts';

const say = (line: string) => process.stdout.write(`${line}\n`);

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL, process.stderr);
const source = env.BLOB_STORE === 's3' ? 'local' : 's3';
if (source === 's3' && !s3Options(env)) {
  process.stderr.write(
    'To copy the photos from the bucket, keep S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY set.\n',
  );
  process.exit(1);
}

const db = openDatabase(env.DATABASE_PATH);
try {
  // The API may not have started on this database since it was upgraded.
  migrateDatabase(db);
  // Which store is which, this says itself.
  const quiet = logger.child({}, { level: 'warn' });
  const from = createBlobStore(env, quiet, source);
  const to = createBlobStore(env, quiet);
  say(
    `Copying the photos ${source === 's3' ? 'from the bucket into BLOB_DIR' : 'from BLOB_DIR into the bucket'}.`,
  );
  const { copied, present, missing } = await copyPhotos(db, { from, to, logger }, (done, total) => {
    if (done % 100 === 0 || done === total) say(`${String(done)} of ${String(total)} files`);
  });
  say(`Copied ${String(copied)} files; ${String(present)} were there already.`);
  if (missing.length > 0) {
    say(
      `${String(missing.length)} were missing from where they were copied from, so they're missing from where they're copied to as well. The log names them.`,
    );
  }
} catch (error) {
  logger.fatal({ err: error }, 'could not copy the photos');
  process.exitCode = 1;
} finally {
  db.$client.close();
}
