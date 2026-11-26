/**
 * Sets up Garage for the API's photos, then exits (`setUpGarage()`, ADR 0004): its node's place in
 * the cluster, the API's key and the bucket. The `s3` Compose profile runs it in the API's image
 * before the API starts, every time, leaving what's done as it is:
 *
 *   node src/set-up-garage.ts
 *
 * compose.yaml gives it its variables: Garage's admin API and token, and the API's bucket and key.
 */
import { z } from 'zod';
import { GarageSetupError, setUpGarage } from './blobs/garage.ts';
import { envSchema, loadOrExit, loadVariables, required } from './env.ts';
import { createLogger } from './logger.ts';

const garageEnvSchema = z.object({
  LOG_LEVEL: envSchema.shape.LOG_LEVEL,
  GARAGE_ADMIN_URL: z.url({ protocol: /^https?$/, ...required }),
  GARAGE_ADMIN_TOKEN: z.string(required),
  S3_BUCKET: z.string(required),
  S3_ACCESS_KEY_ID: z.string(required),
  S3_SECRET_ACCESS_KEY: z.string(required),
});

const env = loadOrExit(() =>
  loadVariables(garageEnvSchema, ['GARAGE_ADMIN_TOKEN', 'S3_SECRET_ACCESS_KEY'], process.env),
);
const logger = createLogger(env.LOG_LEVEL);
try {
  await setUpGarage(
    {
      adminUrl: env.GARAGE_ADMIN_URL,
      adminToken: env.GARAGE_ADMIN_TOKEN,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    logger,
  );
} catch (error) {
  if (error instanceof GarageSetupError) logger.fatal(error.message);
  else logger.fatal({ err: error }, 'could not set up Garage');
  process.exitCode = 1;
}
