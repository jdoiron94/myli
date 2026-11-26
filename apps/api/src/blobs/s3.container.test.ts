// Runs against a real Garage container: `pnpm test:containers`, with Docker running.
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.ts';
import { describeBlobStore } from './contract.ts';
import { GarageSetupError } from './garage.ts';
import { createS3BlobStore } from './s3.ts';
import { garageContainer, setUpTestGarage } from './testing.ts';

const silent = createLogger('fatal', { write: () => undefined });

let garage: StartedTestContainer;
beforeAll(async () => {
  garage = await garageContainer().start();
}, 120_000);
afterAll(async () => {
  await garage.stop();
});

/** A bucket of its own for each store, so each starts empty. */
let buckets = 0;
const newBucket = () => `test-${String(++buckets)}`;

describeBlobStore('S3', async () =>
  createS3BlobStore(await setUpTestGarage(garage, newBucket(), silent)),
);

describe('S3 blob store', () => {
  it('fails, rather than finding nothing, when the store refuses its key', async () => {
    const settings = await setUpTestGarage(garage, newBucket(), silent);
    await createS3BlobStore(settings).put('images/a1/640.webp', new Uint8Array([1]), {
      contentType: 'image/webp',
    });
    const store = createS3BlobStore({ ...settings, secretAccessKey: 'not the secret' });

    // Taken for a missing photo, it would be a 404, and missing from exports, with no error logged.
    await expect(store.get('images/a1/640.webp')).rejects.toThrow();
  });
});

describe('setting up Garage', () => {
  it('leaves what’s set up as it is, every time it runs', async () => {
    const settings = await setUpTestGarage(garage, 'again', silent);
    const store = createS3BlobStore(settings);
    await store.put('images/a1/640.webp', new Uint8Array([1]), { contentType: 'image/webp' });

    await setUpTestGarage(garage, 'again', silent);

    expect((await store.get('images/a1/640.webp'))?.size).toBe(1);
  });

  it('refuses a key ID Garage already has with another secret, which it can’t change', async () => {
    const settings = await setUpTestGarage(garage, newBucket(), silent);

    await expect(
      setUpTestGarage(garage, newBucket(), silent, {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: 'another secret, long enough',
      }),
    ).rejects.toThrow(
      new GarageSetupError(
        'Garage already has S3_ACCESS_KEY_ID, with another secret. It can’t change a key’s secret: choose a new S3_ACCESS_KEY_ID.',
      ),
    );
  });
});
