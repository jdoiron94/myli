import {
  API_BASE_PATH,
  type Image,
  imageResultSchema,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import type { BlobStore } from '../blobs/store.ts';
import { image, job, recipe } from '../db/schema.ts';
import { JSON_ONLY_DETAIL } from '../json-only.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { UNSAVED_IMAGE_TTL_MS } from './images.ts';
import { IMAGE_CACHE_CONTROL, NOT_AN_IMAGE_DETAIL, TOO_LARGE_DETAIL } from './routes.ts';
import { insertRecipeImage, testImage } from './testing.ts';

async function setUp(blobs = createMemoryBlobStore(), logged: string[] = []) {
  const logger = createLogger('error', { write: (line: string) => void logged.push(line) });
  const t = createTestApp({ blobs, logger });
  const { user, cookie } = await signedInAs(t, 'editor');
  const upload = (
    body: RequestInit['body'],
    contentType = 'image/jpeg',
    headers: Record<string, string> = {},
  ) =>
    t.app.request(`${API_BASE_PATH}/images`, {
      method: 'POST',
      headers: { cookie, 'content-type': contentType, ...headers },
      body,
      // A stream has to say it's sent while the response may already be coming.
      ...(body instanceof ReadableStream && { duplex: 'half' }),
    });
  return { t, user, cookie, blobs, upload };
}

describe('POST /images', () => {
  it('keeps an upload at each size, as WebP, for its uploader alone until saved', async () => {
    const { t, user, blobs, upload } = await setUp();
    const before = Date.now();

    const res = await upload(await testImage(1600, 1200), 'image/jpeg; charset=binary');

    expect(res.status).toBe(201);
    const { image: uploaded } = imageResultSchema.parse(await res.json());
    expect(uploaded).toEqual({
      id: expect.any(String),
      width: 1600,
      height: 1200,
      variants: [
        { width: 640, height: 480 },
        { width: 1280, height: 960 },
        { width: 1600, height: 1200 },
      ],
    });
    const keys = ['640', '1280', '1600'].map((width) => `images/${uploaded.id}/${width}.webp`);
    expect(blobs.keys()).toEqual([...keys].sort());
    const stored = await blobs.get(keys[0] ?? '');
    expect(stored?.contentType).toBe('image/webp');
    expect(t.db.select().from(image).all()).toMatchObject([
      { id: uploaded.id, recipeId: null, uploaderId: user.id, mime: 'image/jpeg' },
    ]);
    const [discard] = t.db.select().from(job).all();
    expect(discard).toMatchObject({
      type: 'images.discard-unsaved',
      payload: { imageId: uploaded.id },
    });
    expect(discard?.runAfter.getTime()).toBeGreaterThanOrEqual(before + UNSAVED_IMAGE_TTL_MS);
  });

  it('goes by the file’s own bytes, not the type it was sent as', async () => {
    const { t, upload } = await setUp();

    const res = await upload(await testImage(800, 600, 'png'), 'image/webp');

    expect(res.status).toBe(201);
    expect(t.db.select({ mime: image.mime }).from(image).all()).toEqual([{ mime: 'image/png' }]);
  });

  it('refuses a file that isn’t a JPEG, PNG or WebP, keeping nothing', async () => {
    const { t, blobs, upload } = await setUp();
    const gif = await sharp(await testImage(10, 10))
      .gif()
      .toBuffer();

    for (const body of [gif, new TextEncoder().encode('%PDF-1.7'), new Uint8Array()]) {
      const res = await upload(body, 'image/png');
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ detail: NOT_AN_IMAGE_DETAIL });
    }
    expect(blobs.keys()).toEqual([]);
    expect(t.db.select().from(image).all()).toEqual([]);
  });

  it('says why it can’t read an image, as a validation problem', async () => {
    const { blobs, upload } = await setUp();
    const truncated = (await testImage(800, 600)).subarray(0, 300);

    const res = await upload(truncated);

    expect(res.status).toBe(422);
    expect(validationProblemSchema.parse(await res.json()).errors).toEqual([
      { in: 'body', pointer: '#', detail: "This image can't be read. The file may be damaged." },
    ]);
    expect(blobs.keys()).toEqual([]);
  });

  it('takes only an image type as the body: JSON gets as far as the route, nothing else', async () => {
    const { upload } = await setUp();

    const json = await upload('{}', 'application/json');
    expect(json.status).toBe(415);
    expect(await json.json()).toMatchObject({ detail: NOT_AN_IMAGE_DETAIL });

    for (const contentType of ['multipart/form-data; boundary=x', 'text/plain', 'image/gif']) {
      const res = await upload(await testImage(10, 10), contentType);
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ detail: JSON_ONLY_DETAIL });
    }
  });

  it('refuses more than 10 MB, whether it says so up front or not', async () => {
    const { blobs, upload } = await setUp();
    const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
    tooLarge.set(await testImage(10, 10));

    const declared = await upload(tooLarge, 'image/jpeg', {
      'content-length': String(tooLarge.byteLength),
    });
    const streamed = await upload(
      new ReadableStream({
        start(controller) {
          controller.enqueue(tooLarge);
          controller.close();
        },
      }),
    );

    for (const res of [declared, streamed]) {
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ detail: TOO_LARGE_DETAIL });
    }
    expect(blobs.keys()).toEqual([]);
  });

  it('takes away what it stored when storing the rest fails', async () => {
    const memory = createMemoryBlobStore();
    let puts = 0;
    const failing: BlobStore = {
      ...memory,
      put: (key, body, options) =>
        ++puts === 2 ? Promise.reject(new Error('disk full')) : memory.put(key, body, options),
    };
    const { t, upload } = await setUp({ ...failing, keys: () => memory.keys() });

    const res = await upload(await testImage(1600, 1200));

    expect(res.status).toBe(500);
    expect(memory.keys()).toEqual([]);
    expect(t.db.select().from(image).all()).toEqual([]);
    expect(t.db.select().from(job).all()).toEqual([]);
  });
});

describe('GET /images/{id}/{width}', () => {
  async function uploaded(
    upload: (body: Uint8Array) => Response | Promise<Response>,
  ): Promise<Image> {
    const res = await upload(await testImage(1600, 1200));
    return imageResultSchema.parse(await res.json()).image;
  }
  const get = (t: TestApp, path: string, cookie: string) =>
    t.app.request(`${API_BASE_PATH}/images/${path}`, { headers: { cookie } });
  const expectNotFound = async (res: Response) => {
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ detail: 'Image not found.' });
  };

  it('gives the uploader each size of their upload, to be cached for good', async () => {
    const { t, cookie, upload } = await setUp();
    const { id, variants } = await uploaded(upload);

    for (const { width, height } of variants) {
      const res = await get(t, `${id}/${String(width)}`, cookie);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('cache-control')).toBe(IMAGE_CACHE_CONTROL);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(res.headers.get('content-length')).toBe(String(bytes.byteLength));
      const metadata = await sharp(bytes).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['webp', width, height]);
    }
  });

  it('shows an upload no recipe was saved with to no one else, admins included', async () => {
    const { t, upload } = await setUp();
    const { id } = await uploaded(upload);

    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const { cookie } = await signedInAs(t, role);
      await expectNotFound(await get(t, `${id}/640`, cookie));
    }
    await expectNotFound(await get(t, 'no-such-image/640', (await signedInAs(t, 'admin')).cookie));
  });

  it('follows its recipe: gone with it when the recipe is deleted', async () => {
    const { t, user, cookie } = await setUp();
    const recipeId = insertRecipe(t.db, user.id);
    const id = await insertRecipeImage(t, recipeId);
    expect((await get(t, `${id}/64`, cookie)).status).toBe(200);

    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, recipeId)).run();

    await expectNotFound(await get(t, `${id}/64`, cookie));
  });

  it('has no size but those it was made at', async () => {
    const { t, cookie, upload } = await setUp();
    const { id } = await uploaded(upload);

    await expectNotFound(await get(t, `${id}/2048`, cookie));
    await expectNotFound(await get(t, `${id}/641`, cookie));
    expect((await get(t, `${id}/wide`, cookie)).status).toBe(422);
  });

  it('logs a file its row says is there but the store lost, and answers 404', async () => {
    const logged: string[] = [];
    const { t, cookie, blobs, upload } = await setUp(createMemoryBlobStore(), logged);
    const { id } = await uploaded(upload);
    await blobs.delete(`images/${id}/640.webp`);

    await expectNotFound(await get(t, `${id}/640`, cookie));

    expect(logged.map((line) => JSON.parse(line) as unknown)).toMatchObject([
      { msg: 'image blob missing', imageId: id, key: `images/${id}/640.webp` },
    ]);
  });
});
