import {
  type Image,
  imageResultSchema,
  type Recipe,
  type Role,
  recipeResultSchema,
  type UpdateRecipeRequest,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { image, job, recipe as recipeTable } from '../db/schema.ts';
import { testImage } from '../images/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { sampleRecipeContent, sampleRecipeRequest } from './testing.ts';

const UNAVAILABLE = "This photo isn't available any more. Upload it again.";

function send(t: TestApp, method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, ...(method !== 'GET' && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function recipeFrom(res: Response): Promise<Recipe> {
  expect(res.status).toBeLessThan(300);
  return recipeResultSchema.parse(await res.json()).recipe;
}

/** The fields of a validation problem, by JSON pointer. */
async function fieldErrors(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(422);
  const { errors } = validationProblemSchema.parse(await res.json());
  return Object.fromEntries(errors.map(({ pointer, detail }) => [pointer, detail]));
}

/** A photo the caller uploads, which no recipe has been saved with yet. */
async function upload(t: TestApp, cookie: string): Promise<Image> {
  const res = await t.app.request('/api/v1/images', {
    method: 'POST',
    headers: { cookie, 'content-type': 'image/png' },
    body: await testImage(320, 240, 'png'),
  });
  expect(res.status).toBe(201);
  return imageResultSchema.parse(await res.json()).image;
}

async function setUp(role: Role = 'editor') {
  const blobs = createMemoryBlobStore();
  const t = createTestApp({ blobs });
  return { t, blobs, ...(await signedInAs(t, role)) };
}

/** Each photo's recipe and place among its photos, as stored. */
const stored = (t: TestApp) =>
  t.db
    .select({ id: image.id, recipeId: image.recipeId, position: image.position })
    .from(image)
    .all();

/** The blobs of each photo, by its ID. */
const keysOf = (t: TestApp, id: string) =>
  t.db
    .select({ variants: image.variants })
    .from(image)
    .where(eq(image.id, id))
    .get()
    ?.variants.map(({ key }) => key);

/** The blobs that jobs were queued to delete. */
const blobsQueuedForDeletion = (t: TestApp) =>
  t.db
    .select({ payload: job.payload })
    .from(job)
    .where(eq(job.type, 'blobs.delete'))
    .all()
    .map(({ payload }) => payload);

const withSteps = (...imageIds: (string | null)[]) =>
  imageIds.map((imageId, index) => ({ body: `Step ${String(index + 1)}.`, imageId }));

describe('a recipe’s photos', () => {
  it('saves a recipe with its uploads: its photos in order, its cover and a step’s', async () => {
    const { t, cookie } = await setUp();
    const [a, b, c] = [await upload(t, cookie), await upload(t, cookie), await upload(t, cookie)];
    const viewer = await signedInAs(t, 'viewer');
    const photoAddress = `/images/${b.id}/320`;
    expect((await send(t, 'GET', photoAddress, viewer.cookie)).status).toBe(404);

    const created = await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({
          imageIds: [b.id, a.id],
          coverImageId: a.id,
          steps: withSteps(null, c.id),
        }),
      ),
    );

    expect(created).toMatchObject({
      images: [b, a],
      coverImageId: a.id,
      steps: [
        { body: 'Step 1.', image: null },
        { body: 'Step 2.', image: c },
      ],
    });
    expect(await recipeFrom(await send(t, 'GET', `/recipes/${created.id}`, cookie))).toEqual(
      created,
    );
    expect(stored(t)).toEqual(
      expect.arrayContaining([
        { id: b.id, recipeId: created.id, position: 0 },
        { id: a.id, recipeId: created.id, position: 1 },
        { id: c.id, recipeId: created.id, position: null },
      ]),
    );
    // A shared recipe's photos are anyone's to see now, as the recipe is.
    expect((await send(t, 'GET', photoAddress, viewer.cookie)).status).toBe(200);
  });

  it('refuses photos it can’t use, saying so at each, and saves nothing', async () => {
    const { t, cookie } = await setUp();
    const mine = await upload(t, cookie);
    const someoneElse = await signedInAs(t, 'editor');
    const theirs = await upload(t, someoneElse.cookie);
    const otherPhoto = await upload(t, cookie);
    const other = await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({ imageIds: [otherPhoto.id], coverImageId: otherPhoto.id }),
      ),
    );

    const res = await send(
      t,
      'POST',
      '/recipes',
      cookie,
      sampleRecipeRequest({
        imageIds: [mine.id, theirs.id, 'no-such-photo', otherPhoto.id],
        coverImageId: mine.id,
        steps: withSteps(null, 'no-such-step-photo'),
      }),
    );

    expect(await fieldErrors(res)).toEqual({
      '#/imageIds/1': UNAVAILABLE,
      '#/imageIds/2': UNAVAILABLE,
      '#/imageIds/3': UNAVAILABLE,
      '#/steps/1/imageId': UNAVAILABLE,
    });
    expect(t.db.select({ id: recipeTable.id }).from(recipeTable).all()).toEqual([{ id: other.id }]);
    expect(stored(t)).toEqual(
      expect.arrayContaining([
        { id: mine.id, recipeId: null, position: null },
        { id: theirs.id, recipeId: null, position: null },
        { id: otherPhoto.id, recipeId: other.id, position: 0 },
      ]),
    );
  });

  it.each<[string, Partial<UpdateRecipeRequest>, string, string]>([
    [
      'a cover that isn’t one of its photos',
      { imageIds: ['a'], coverImageId: 'b' },
      '#/coverImageId',
      'Choose one of its photos as the cover.',
    ],
    [
      'photos without a cover',
      { imageIds: ['a'], coverImageId: null },
      '#/coverImageId',
      'Choose one of its photos as the cover.',
    ],
    ['a cover without photos', { coverImageId: 'a' }, '#/coverImageId', 'It has no photos.'],
    [
      'the same photo twice',
      { imageIds: ['a', 'a'], coverImageId: 'a' },
      '#/imageIds/1',
      'Each photo can be used once.',
    ],
    [
      'a step’s photo that’s also one of the recipe’s',
      { imageIds: ['a'], coverImageId: 'a', steps: withSteps('a') },
      '#/steps/0/imageId',
      'Each photo can be used once.',
    ],
    [
      'two steps with the same photo',
      { steps: withSteps('a', 'a') },
      '#/steps/1/imageId',
      'Each photo can be used once.',
    ],
    [
      'more than 20 photos',
      {
        imageIds: Array.from({ length: 21 }, (_, index) => `photo-${String(index)}`),
        coverImageId: 'photo-0',
      },
      '#/imageIds',
      'A recipe can have up to 20 photos.',
    ],
  ])('refuses %s', async (_, photos, pointer, detail) => {
    const { t, cookie } = await setUp();
    const res = await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest(photos));
    expect(await fieldErrors(res)).toEqual({ [pointer]: detail });
  });

  it('saves changes to its photos, and deletes those it left out, their blobs in a job', async () => {
    const { t, blobs, cookie } = await setUp();
    const [a, b, c] = [await upload(t, cookie), await upload(t, cookie), await upload(t, cookie)];
    const { id } = await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({ imageIds: [a.id, b.id], coverImageId: a.id, steps: withSteps(c.id) }),
      ),
    );
    const added = await upload(t, cookie);
    const droppedKeys = keysOf(t, c.id);

    // b and the new upload in place of a; a moves to a new step, and the first step loses c.
    const saved = await recipeFrom(
      await send(
        t,
        'PUT',
        `/recipes/${id}`,
        cookie,
        sampleRecipeContent({
          imageIds: [b.id, added.id],
          coverImageId: added.id,
          steps: withSteps(null, a.id),
        }),
      ),
    );

    expect(saved).toMatchObject({
      images: [b, added],
      coverImageId: added.id,
      steps: [{ image: null }, { image: a }],
    });
    expect(stored(t)).toEqual(
      expect.arrayContaining([
        { id: b.id, recipeId: id, position: 0 },
        { id: added.id, recipeId: id, position: 1 },
        { id: a.id, recipeId: id, position: null },
      ]),
    );
    expect(stored(t)).toHaveLength(3);
    expect(blobsQueuedForDeletion(t)).toEqual([{ keys: droppedKeys }]);
    expect(blobs.keys()).toEqual(expect.arrayContaining(droppedKeys ?? []));
  });

  it('deletes every photo when it keeps none', async () => {
    const { t, cookie } = await setUp();
    const [a, b] = [await upload(t, cookie), await upload(t, cookie)];
    const { id } = await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({ imageIds: [a.id], coverImageId: a.id, steps: withSteps(b.id) }),
      ),
    );
    const keys = [...(keysOf(t, a.id) ?? []), ...(keysOf(t, b.id) ?? [])];

    const saved = await recipeFrom(
      await send(
        t,
        'PUT',
        `/recipes/${id}`,
        cookie,
        sampleRecipeContent({ steps: withSteps(null) }),
      ),
    );

    expect(saved).toMatchObject({ images: [], coverImageId: null, steps: [{ image: null }] });
    expect(stored(t)).toEqual([]);
    expect(blobsQueuedForDeletion(t)).toEqual([{ keys }]);
  });

  it('adds only uploads of whoever edits it, not its owner’s', async () => {
    const { t, cookie } = await setUp();
    const { id } = await recipeFrom(
      await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest()),
    );
    const ownersUpload = await upload(t, cookie);
    const editor = await signedInAs(t, 'editor');
    const editorsUpload = await upload(t, editor.cookie);
    const save = (imageIds: string[]) =>
      send(
        t,
        'PUT',
        `/recipes/${id}`,
        editor.cookie,
        sampleRecipeContent({ imageIds, coverImageId: imageIds[0] ?? null }),
      );

    expect(await fieldErrors(await save([editorsUpload.id, ownersUpload.id]))).toEqual({
      '#/imageIds/1': UNAVAILABLE,
    });
    expect((await recipeFrom(await save([editorsUpload.id]))).images).toEqual([editorsUpload]);
  });

  it('can’t take another recipe’s photo, even its editor’s own', async () => {
    const { t, cookie } = await setUp();
    const photo = await upload(t, cookie);
    await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({ imageIds: [photo.id], coverImageId: photo.id }),
      ),
    );
    const { id } = await recipeFrom(
      await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest()),
    );

    const res = await send(
      t,
      'PUT',
      `/recipes/${id}`,
      cookie,
      sampleRecipeContent({ steps: withSteps(photo.id) }),
    );

    expect(await fieldErrors(res)).toEqual({ '#/steps/0/imageId': UNAVAILABLE });
  });
});
