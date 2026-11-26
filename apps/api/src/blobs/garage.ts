import { z } from 'zod';
import type { Logger } from '../logger.ts';

/**
 * Sets up a new single-node Garage for myli's photos (ADR 0004), through its admin API: gives the
 * node its place in the cluster, then imports the API's key and creates its bucket. Each step that's
 * done already is left as it is, so it runs on every start: `src/set-up-garage.ts`, in the `s3`
 * Compose profile's init container. The container tests set up theirs with it too.
 */
export interface GarageSetup {
  /** The admin API, like `http://garage:3903`. */
  adminUrl: string;
  adminToken: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class GarageSetupError extends Error {
  override name = 'GarageSetupError';
}

/** The zone the node is in: one node, one zone. */
const ZONE = 'myli';

export async function setUpGarage(setup: GarageSetup, logger: Logger): Promise<void> {
  const admin = garageAdmin(setup);

  // The node's place: without one, it stores nothing.
  const status = await admin.call(clusterStatus, 'GET', 'GetClusterStatus');
  const [node, ...others] = status.nodes;
  if (!node || others.length > 0) {
    throw new GarageSetupError(
      `expected Garage to run on one node, found ${String(status.nodes.length)}`,
    );
  }
  const layout = await admin.call(clusterLayout, 'GET', 'GetClusterLayout');
  if (layout.roles.some(({ id }) => id === node.id)) {
    logger.info('Garage’s node already has its place in the cluster');
  } else {
    await admin.call(z.unknown(), 'POST', 'UpdateClusterLayout', {
      roles: [
        {
          id: node.id,
          zone: ZONE,
          // Garage only weighs nodes against each other by it: with one, any size does. Its disk's.
          capacity: node.dataPartition?.total ?? 1e12,
          tags: [],
        },
      ],
    });
    await admin.call(z.unknown(), 'POST', 'ApplyClusterLayout', { version: layout.version + 1 });
    logger.info('gave Garage’s node its place in the cluster');
  }

  const key = await admin.find(keyInfo, 'GetKeyInfo', {
    id: setup.accessKeyId,
    showSecretKey: 'true',
  });
  if (!key) {
    await admin.call(z.unknown(), 'POST', 'ImportKey', {
      name: 'myli',
      accessKeyId: setup.accessKeyId,
      secretAccessKey: setup.secretAccessKey,
    });
    logger.info('imported the API’s key into Garage');
  } else if (key.secretAccessKey !== setup.secretAccessKey) {
    // Garage can't change a key's secret, nor take an ID back once it's been used.
    throw new GarageSetupError(
      'Garage already has S3_ACCESS_KEY_ID, with another secret. It can’t change a key’s secret: choose a new S3_ACCESS_KEY_ID.',
    );
  }

  let bucket = await admin.find(bucketInfo, 'GetBucketInfo', { globalAlias: setup.bucket });
  if (bucket) {
    logger.info('Garage already has the bucket');
  } else {
    bucket = await admin.call(bucketInfo, 'POST', 'CreateBucket', { globalAlias: setup.bucket });
    logger.info('created the bucket in Garage');
  }
  // Allowing what's allowed already changes nothing. Reading, writing and deleting objects only:
  // not changing the bucket's settings or permissions.
  await admin.call(z.unknown(), 'POST', 'AllowBucketKey', {
    bucketId: bucket.id,
    accessKeyId: setup.accessKeyId,
    permissions: { read: true, write: true, owner: false },
  });
  logger.info('Garage is ready for photos');
}

// What setting up needs of the admin API's answers.
const clusterStatus = z.object({
  nodes: z.array(
    z.object({ id: z.string(), dataPartition: z.object({ total: z.number() }).nullish() }),
  ),
});
const clusterLayout = z.object({
  version: z.number(),
  roles: z.array(z.object({ id: z.string() })),
});
const keyInfo = z.object({ secretAccessKey: z.string().nullish() });
const bucketInfo = z.object({ id: z.string() });
const problem = z.object({ message: z.string() });

/** Garage's admin API (version 2): each call names its operation. */
function garageAdmin({ adminUrl, adminToken }: GarageSetup) {
  async function request(
    method: 'GET' | 'POST',
    operation: string,
    { query, body }: { query?: Record<string, string>; body?: unknown },
  ) {
    const url = new URL(`/v2/${operation}`, adminUrl);
    url.search = new URLSearchParams(query).toString();
    // eslint-disable-next-line no-restricted-globals -- the operator's own Garage, at an address from the environment, never one a user gave (ADR 0017)
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return response;
  }

  async function failure(operation: string, response: Response) {
    // Garage's errors say what's wrong, such as a key ID it won't take, and never hold the token.
    const detail = await response.json().then(
      (answer: unknown) => problem.safeParse(answer).data?.message,
      () => undefined,
    );
    return new GarageSetupError(
      `Garage refused ${operation} (${String(response.status)})${detail ? `: ${detail}` : ''}`,
    );
  }

  return {
    async call<T>(answer: z.ZodType<T>, method: 'GET' | 'POST', operation: string, body?: unknown) {
      const response = await request(method, operation, { body });
      if (!response.ok) throw await failure(operation, response);
      return answer.parse(await response.json());
    },
    /** What a lookup finds, or `null` for a 404. */
    async find<T>(answer: z.ZodType<T>, operation: string, query: Record<string, string>) {
      const response = await request('GET', operation, { query });
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(operation, response);
      return answer.parse(await response.json());
    },
  };
}
