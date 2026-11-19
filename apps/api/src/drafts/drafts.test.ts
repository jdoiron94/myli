import {
  type RecipeContent,
  recipeDraftResultSchema,
  recipeResultSchema,
  validationProblemSchema,
} from '@myli/shared';
import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { image, job, recipeRevision } from '../db/schema.ts';
import { uploadImage } from '../images/testing.ts';
import { ifMatch, insertRecipe, sampleRecipeContent } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(
  t: TestApp,
  method: string,
  path: string,
  cookie: string,
  { body, headers = {} }: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      cookie,
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** Saves the draft as someone who just loaded the recipe. */
const saveDraft = (t: TestApp, id: string, cookie: string, content: RecipeContent) =>
  send(t, 'PUT', `/recipes/${id}/draft`, cookie, { body: content, headers: ifMatch(t.db, id) });

async function draftOf(t: TestApp, id: string, cookie: string) {
  const res = await send(t, 'GET', `/recipes/${id}/draft`, cookie);
  expect(res.status).toBe(200);
  return recipeDraftResultSchema.parse(await res.json()).draft;
}

async function recipeOf(t: TestApp, id: string, cookie: string) {
  return recipeResultSchema.parse(await (await send(t, 'GET', `/recipes/${id}`, cookie)).json())
    .recipe;
}

const indexJobs = (t: TestApp) =>
  t.db.select().from(job).where(eq(job.type, 'search.index-recipe')).all().length;

const revisionsOf = (t: TestApp, id: string) =>
  t.db
    .select({ number: recipeRevision.number, message: recipeRevision.message })
    .from(recipeRevision)
    .where(eq(recipeRevision.recipeId, id))
    .orderBy(asc(recipeRevision.number))
    .all();

afterEach(() => {
  vi.useRealTimers();
});

async function setUp() {
  const t = createTestApp();
  const owner = await signedInAs(t, 'editor');
  const other = await signedInAs(t, 'editor');
  const id = insertRecipe(t.db, owner.user.id, 'shared');
  return { t, owner, other, id };
}

describe('a recipe’s draft', () => {
  it('is saved for anyone who may edit the recipe to continue, while the recipe stays as it was', async () => {
    const { t, owner, other, id } = await setUp();
    const photo = await uploadImage(t, other.cookie);
    const indexed = indexJobs(t);
    const published = await recipeOf(t, id, owner.cookie);
    expect(await draftOf(t, id, owner.cookie)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 3_600_000 });

    const content = sampleRecipeContent({
      title: 'Sunday Bread',
      images: [{ id: photo.id, alt: 'A loaf.' }],
      coverImageId: photo.id,
    });
    const res = await saveDraft(t, id, other.cookie, content);
    expect(res.status).toBe(200);
    const saved = recipeDraftResultSchema.parse(await res.json()).draft;
    expect(saved).toMatchObject({
      content: { title: 'Sunday Bread', images: [{ id: photo.id, alt: 'A loaf.' }] },
      photos: [photo],
      author: { id: other.user.id },
      revision: 1,
      version: 2,
    });

    // The owner continues it, upload included, which is no longer an unsaved one.
    expect(await draftOf(t, id, owner.cookie)).toEqual(saved);
    expect(t.db.select().from(image).where(eq(image.id, photo.id)).get()?.recipeId).toBe(id);
    // As published, even when it was last changed.
    expect(await recipeOf(t, id, owner.cookie)).toMatchObject({
      title: 'Weeknight Bread',
      images: [],
      updatedAt: published.updatedAt,
      version: 2,
    });
    expect(revisionsOf(t, id)).toHaveLength(1);
    expect(indexJobs(t)).toBe(indexed);

    const again = await saveDraft(t, id, owner.cookie, { ...content, title: 'Sunday Loaf' });
    expect(recipeDraftResultSchema.parse(await again.json()).draft).toMatchObject({
      content: { title: 'Sunday Loaf' },
      author: { id: owner.user.id },
      revision: 1,
      version: 3,
    });
  });

  it('goes when the recipe is published, which records the message', async () => {
    const { t, owner, id } = await setUp();
    await saveDraft(t, id, owner.cookie, sampleRecipeContent({ title: 'Sunday Bread' }));

    const publish = (message?: string) =>
      send(t, 'PUT', `/recipes/${id}`, owner.cookie, {
        body: { ...sampleRecipeContent({ title: 'Sunday Bread' }), message },
        headers: ifMatch(t.db, id),
      });
    expect((await publish('  Less salt ')).status).toBe(200);
    await publish('');
    await publish();

    expect(await draftOf(t, id, owner.cookie)).toBeNull();
    expect((await recipeOf(t, id, owner.cookie)).title).toBe('Sunday Bread');
    expect(revisionsOf(t, id)).toEqual([
      { number: 1, message: null },
      { number: 2, message: 'Less salt' },
      { number: 3, message: null },
      { number: 4, message: null },
    ]);
  });

  it('is discarded, leaving the recipe as it was', async () => {
    const { t, owner, id } = await setUp();
    await saveDraft(t, id, owner.cookie, sampleRecipeContent({ title: 'Sunday Bread' }));
    const discard = () =>
      send(t, 'DELETE', `/recipes/${id}/draft`, owner.cookie, { headers: ifMatch(t.db, id) });

    const res = await discard();
    expect([res.status, res.headers.get('etag')]).toEqual([204, '"3"']);
    expect(await draftOf(t, id, owner.cookie)).toBeNull();
    expect((await recipeOf(t, id, owner.cookie)).title).toBe('Weeknight Bread');
    // With no draft, nothing changes, the version included.
    expect((await discard()).headers.get('etag')).toBe('"3"');
  });

  it('refuses a change based on an older version, or a photo it can’t use', async () => {
    const { t, owner, other, id } = await setUp();
    const othersUpload = await uploadImage(t, other.cookie);
    const stale = { 'if-match': '"7"' };

    const statuses = [
      await send(t, 'PUT', `/recipes/${id}/draft`, owner.cookie, {
        body: sampleRecipeContent(),
        headers: stale,
      }),
      await send(t, 'DELETE', `/recipes/${id}/draft`, owner.cookie, { headers: stale }),
      await send(t, 'DELETE', `/recipes/${id}/draft`, owner.cookie),
    ].map((res) => res.status);
    expect(statuses).toEqual([412, 412, 428]);

    const res = await saveDraft(
      t,
      id,
      owner.cookie,
      sampleRecipeContent({
        images: [{ id: othersUpload.id, alt: '' }],
        coverImageId: othersUpload.id,
      }),
    );
    expect(res.status).toBe(422);
    expect(validationProblemSchema.parse(await res.json()).errors).toEqual([
      expect.objectContaining({ pointer: '#/images/0/id' }),
    ]);
    expect(await draftOf(t, id, owner.cookie)).toBeNull();
  });
});
