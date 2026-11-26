import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';
import { createLocalBlobStore } from './local.ts';
import { createS3BlobStore, type S3Options } from './s3.ts';
import type { BlobStore } from './store.ts';

/** The bucket the environment names, or `null` if it doesn't name one in full. */
export function s3Options(env: Env): S3Options | null {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (S3_BUCKET === undefined || S3_ACCESS_KEY_ID === undefined) return null;
  if (S3_SECRET_ACCESS_KEY === undefined) return null;
  return {
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

/** The store photos are kept in (ADR 0004): `BLOB_STORE`'s, unless `kind` names the other. */
export function createBlobStore(env: Env, logger: Logger, kind = env.BLOB_STORE): BlobStore {
  if (kind === 'local') {
    logger.info({ directory: env.BLOB_DIR }, 'photos are kept in a directory');
    return createLocalBlobStore(env.BLOB_DIR);
  }
  const options = s3Options(env);
  if (!options) {
    // loadEnv refuses this when BLOB_STORE is s3.
    throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set');
  }
  const { endpoint = 'AWS', region, bucket } = options;
  logger.info({ endpoint, region, bucket }, 'photos are kept in an S3 bucket');
  return createS3BlobStore(options);
}
