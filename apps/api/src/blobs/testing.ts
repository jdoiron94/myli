import { randomBytes } from 'node:crypto';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { Logger } from '../logger.ts';
import { setUpGarage } from './garage.ts';

/** The Garage the container tests run against: the one compose.yaml's `s3` profile runs (a test checks). */
export const GARAGE_IMAGE =
  'dxflrs/garage:v2.5.0@sha256:677e5b758e4425a325b811c425c026bf35a4bf42f7ddbaa773de3f4fd779a5a5';

/** Garage's settings in the `s3` profile (compose.yaml), but its secrets, which come from here. */
const CONFIG = `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"

[admin]
api_bind_addr = "[::]:3903"
`;

const ADMIN_TOKEN = randomBytes(24).toString('base64url');

/** A Garage of its own, on random host ports. Set it up with `setUpTestGarage()`. */
export function garageContainer() {
  return new GenericContainer(GARAGE_IMAGE)
    .withCopyContentToContainer([{ content: CONFIG, target: '/etc/garage.toml' }])
    .withEnvironment({
      GARAGE_RPC_SECRET: randomBytes(32).toString('hex'),
      GARAGE_ADMIN_TOKEN: ADMIN_TOKEN,
    })
    .withExposedPorts(3900, 3903)
    .withWaitStrategy(Wait.forLogMessage(/Admin API server listening/));
}

/** The key the tests' stores use, unless one asks for another. */
const TEST_KEY = {
  accessKeyId: `GK${randomBytes(12).toString('hex')}`,
  secretAccessKey: randomBytes(32).toString('hex'),
};

/**
 * Sets up `container`'s Garage as the init container would, with a bucket named `bucket`, and
 * gives the S3 settings that reach it from here.
 */
export async function setUpTestGarage(
  container: StartedTestContainer,
  bucket: string,
  logger: Logger,
  key = TEST_KEY,
) {
  await setUpGarage(
    {
      adminUrl: `http://${container.getHost()}:${String(container.getMappedPort(3903))}`,
      adminToken: ADMIN_TOKEN,
      bucket,
      ...key,
    },
    logger,
  );
  return {
    endpoint: `http://${container.getHost()}:${String(container.getMappedPort(3900))}`,
    region: 'garage',
    bucket,
    ...key,
  };
}
