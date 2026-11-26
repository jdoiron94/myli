// Runs the copy script under plain Node, the way it's run for real, into a real Garage container:
// `pnpm test:containers`, with Docker running.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalBlobStore } from './blobs/local.ts';
import { createS3BlobStore } from './blobs/s3.ts';
import { garageContainer, setUpTestGarage } from './blobs/testing.ts';
import { migrateDatabase, openDatabase } from './db/database.ts';
import { uploadImage } from './images/testing.ts';
import { createLogger } from './logger.ts';
import { createTestApp, signedInAs } from './testing.ts';

const SCRIPT = fileURLToPath(new URL('./copy-photos.ts', import.meta.url));

let garage: StartedTestContainer;
const dir = mkdtempSync(join(tmpdir(), 'myli-copy-'));
beforeAll(async () => {
  garage = await garageContainer().start();
}, 120_000);
afterAll(async () => {
  await garage.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('copy-photos.ts', { timeout: 30_000 }, () => {
  it('copies the photos from BLOB_DIR into the bucket, then exits', async () => {
    const databasePath = join(dir, 'myli.db');
    const blobDir = join(dir, 'blobs');
    const db = openDatabase(databasePath);
    migrateDatabase(db);
    const t = createTestApp({ db, blobs: createLocalBlobStore(blobDir) });
    const { cookie } = await signedInAs(t, 'editor');
    const photo = await uploadImage(t, cookie);
    db.$client.close();
    const s3 = await setUpTestGarage(garage, 'copied', createLogger('silent'));

    const child = spawn(process.execPath, [SCRIPT], {
      // Exactly these, so the shell and .env can't leak in.
      env: {
        PUBLIC_URL: 'https://myli.example',
        BETTER_AUTH_SECRET: 'Vq7mZ2x9Lk4pR8tW1nB6cY3hJ0fS5gD8aE2uQ7iO4rM=',
        MEILI_MASTER_KEY: 'master-key-hunter2-secret',
        LOG_LEVEL: 'warn',
        DATABASE_PATH: databasePath,
        BLOB_DIR: blobDir,
        BLOB_STORE: 's3',
        S3_ENDPOINT: s3.endpoint,
        S3_BUCKET: s3.bucket,
        S3_ACCESS_KEY_ID: s3.accessKeyId,
        S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { stdout: '', stderr: '' };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output.stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output.stderr += chunk));
    const [code] = await once(child, 'exit');

    expect({ code, ...output }).toEqual({
      code: 0,
      stdout: expect.stringContaining(
        `Copied ${String(photo.variants.length)} files; 0 were there already.`,
      ) as unknown,
      stderr: '',
    });
    const bucket = createS3BlobStore(s3);
    const sizes = await Promise.all(
      photo.variants.map(async ({ width }) => {
        const blob = await bucket.get(`images/${photo.id}/${String(width)}.webp`);
        blob?.body.destroy();
        return blob?.size;
      }),
    );
    expect(sizes.every((size) => size !== undefined && size > 0)).toBe(true);
  });
});
