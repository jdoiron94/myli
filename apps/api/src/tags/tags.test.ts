import {
  ALLERGENS,
  type TagType,
  tagListSchema,
  tagResultSchema,
  tagUsageSchema,
  type Visibility,
  validationProblemSchema,
} from '@myli/shared';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvent, job, recipe, recipeTag, tag } from '../db/schema.ts';
import { createRecipe } from '../recipes/recipes.ts';
import { sampleRecipeRequest } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { findOrCreateTag } from './tags.ts';

function send(t: TestApp, method: string, path: string, cookie?: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function tagNames(t: TestApp, cookie: string, query = '') {
  const res = await send(t, 'GET', `/tags${query}`, cookie);
  expect(res.status).toBe(200);
  return tagListSchema.parse(await res.json()).tags.map(({ type, name }) => `${type}:${name}`);
}

async function setUp() {
  const t = createTestApp();
  return { t, ...(await signedInAs(t, 'editor')) };
}

const create = (t: TestApp, cookie: string, type: string, name: string) =>
  send(t, 'POST', '/tags', cookie, { type, name });

describe('GET /tags', () => {
  it('lists the allergens on a new instance, by name', async () => {
    const { t, cookie } = await setUp();
    expect(await tagNames(t, cookie)).toEqual(
      [...ALLERGENS].sort().map((name) => `allergen:${name}`),
    );
  });

  it('lists every tag by type and then name, or the tags of one type', async () => {
    const { t, cookie } = await setUp();
    t.db
      .insert(tag)
      .values([
        { type: 'custom', name: 'Weeknight', nameKey: 'weeknight' },
        { type: 'cuisine', name: 'thai', nameKey: 'thai' },
        { type: 'cuisine', name: 'Italian', nameKey: 'italian' },
        { type: 'diet', name: 'Vegan', nameKey: 'vegan' },
        { type: 'meal_type', name: 'Breakfast', nameKey: 'breakfast' },
      ])
      .run();

    const names = await tagNames(t, cookie);
    expect(names.slice(0, 4)).toEqual([
      'cuisine:Italian',
      'cuisine:thai',
      'meal_type:Breakfast',
      'diet:Vegan',
    ]);
    expect(names.at(-1)).toBe('custom:Weeknight');
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Italian', 'cuisine:thai']);
  });
});

describe('POST /tags', () => {
  it('creates a tag, with its spacing tidied', async () => {
    const { t, cookie } = await setUp();
    const res = await create(t, cookie, 'cuisine', '  Middle   Eastern ');

    expect(res.status).toBe(201);
    const { tag: created } = tagResultSchema.parse(await res.json());
    expect(created).toEqual({ id: expect.any(Number), type: 'cuisine', name: 'Middle Eastern' });
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Middle Eastern']);
  });

  it('returns the tag that already has the name, ignoring case, instead of a second one', async () => {
    const { t, cookie } = await setUp();
    const first = tagResultSchema.parse(
      await (await create(t, cookie, 'cuisine', 'Italian')).json(),
    );

    const again = await create(t, cookie, 'cuisine', 'ITALIAN');
    expect(again.status).toBe(200);
    expect(tagResultSchema.parse(await again.json())).toEqual(first);
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Italian']);
  });

  it('creates the same name in another type as another tag', async () => {
    const { t, cookie } = await setUp();
    await create(t, cookie, 'cuisine', 'Italian');
    expect((await create(t, cookie, 'custom', 'Italian')).status).toBe(201);
  });

  it('refuses an allergen: the instance has the only ones', async () => {
    const { t, cookie } = await setUp();
    const res = await create(t, cookie, 'allergen', 'mustard');
    expect(res.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await res.json());
    expect(errors.map((error) => error.pointer)).toEqual(['#/type']);
    expect(await tagNames(t, cookie)).toHaveLength(ALLERGENS.length);
  });
});

describe('managing tags', () => {
  async function setUpAdmin() {
    const t = createTestApp();
    const admin = await signedInAs(t, 'admin');
    const editor = await signedInAs(t, 'editor');
    const tagId = (type: Exclude<TagType, 'allergen'>, name: string) =>
      findOrCreateTag(t.db, type, name).tag.id;
    const recipeWith = (ownerId: string, tagIds: number[], visibility: Visibility = 'shared') => {
      const saved = createRecipe(t.db, ownerId, sampleRecipeRequest({ visibility, tagIds }));
      if (!saved.ok) throw new Error('the recipe could not be saved');
      return saved.id;
    };
    return {
      t,
      cookie: admin.cookie,
      adminId: admin.user.id,
      editorId: editor.user.id,
      tagId,
      recipeWith,
    };
  }

  const tagsOf = (t: TestApp, recipeId: string) =>
    t.db
      .select({ name: tag.name })
      .from(recipeTag)
      .innerJoin(tag, eq(tag.id, recipeTag.tagId))
      .where(eq(recipeTag.recipeId, recipeId))
      .all()
      .map(({ name }) => name)
      .sort();

  /** The recipes the search index has been told to update since the jobs were last cleared. */
  const indexed = (t: TestApp) =>
    t.db
      .select({ type: job.type, payload: job.payload })
      .from(job)
      .all()
      .filter(({ type }) => type === 'search.index-recipe')
      .map(({ payload }) => (payload as { recipeId: string }).recipeId)
      .sort();

  const clearJobs = (t: TestApp) => t.db.delete(job).run();

  const tagEvents = (t: TestApp) =>
    t.db
      .select({
        action: auditEvent.action,
        targetType: auditEvent.targetType,
        targetId: auditEvent.targetId,
        metadata: auditEvent.metadata,
      })
      .from(auditEvent)
      .where(like(auditEvent.action, 'tag.%'))
      .all();

  it('renames a tag on every recipe, counting in its audit event only those the admin may see', async () => {
    const { t, cookie, editorId, tagId, recipeWith } = await setUpAdmin();
    const italien = tagId('cuisine', 'Italien');
    const shared = recipeWith(editorId, [italien]);
    const hidden = recipeWith(editorId, [italien], 'private');
    clearJobs(t);

    const res = await send(t, 'PUT', `/tags/${String(italien)}`, cookie, { name: ' Italian ' });

    expect(res.status).toBe(200);
    expect(tagResultSchema.parse(await res.json()).tag).toEqual({
      id: italien,
      type: 'cuisine',
      name: 'Italian',
    });
    expect([tagsOf(t, shared), tagsOf(t, hidden)]).toEqual([['Italian'], ['Italian']]);
    expect(indexed(t)).toEqual([shared, hidden].sort());
    expect(tagEvents(t)).toEqual([
      {
        action: 'tag.renamed',
        targetType: 'tag',
        targetId: String(italien),
        metadata: { type: 'cuisine', from: 'Italien', to: 'Italian', recipes: 1 },
      },
    ]);
  });

  it('refuses a name another tag of its type has, but takes a new case for its own', async () => {
    const { t, cookie, tagId } = await setUpAdmin();
    const italian = tagId('cuisine', 'Italian');
    const thai = tagId('cuisine', 'Thai');

    const taken = await send(t, 'PUT', `/tags/${String(thai)}`, cookie, { name: 'italian' });
    expect(taken.status).toBe(422);
    expect(validationProblemSchema.parse(await taken.json()).errors).toEqual([
      expect.objectContaining({
        pointer: '#/name',
        detail: 'Another tag of this type is already called “Italian”. Merge into it instead.',
      }),
    ]);

    const recased = await send(t, 'PUT', `/tags/${String(italian)}`, cookie, { name: 'ITALIAN' });
    expect(recased.status).toBe(200);
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:ITALIAN', 'cuisine:Thai']);
  });

  it('merges a tag into another, which each recipe then has once, in its place', async () => {
    const { t, cookie, editorId, tagId, recipeWith } = await setUpAdmin();
    const italien = tagId('cuisine', 'Italien');
    const italian = tagId('cuisine', 'Italian');
    const one = recipeWith(editorId, [italien]);
    const both = recipeWith(editorId, [italien, italian]);
    clearJobs(t);

    const res = await send(t, 'POST', `/tags/${String(italien)}/merge`, cookie, {
      intoId: italian,
    });

    expect(res.status).toBe(200);
    expect(tagResultSchema.parse(await res.json()).tag).toEqual({
      id: italian,
      type: 'cuisine',
      name: 'Italian',
    });
    expect([tagsOf(t, one), tagsOf(t, both)]).toEqual([['Italian'], ['Italian']]);
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual(['cuisine:Italian']);
    expect(indexed(t)).toEqual([one, both].sort());
    expect(tagEvents(t)).toEqual([
      {
        action: 'tag.merged',
        targetType: 'tag',
        targetId: String(italien),
        metadata: {
          type: 'cuisine',
          name: 'Italien',
          into: { id: italian, name: 'Italian' },
          recipes: 2,
        },
      },
    ]);
  });

  it('refuses a merge into the tag itself, a tag of another type or one that’s gone, at intoId', async () => {
    const { t, cookie, tagId } = await setUpAdmin();
    const italien = tagId('cuisine', 'Italien');
    const intoIds = { itself: italien, 'another type': tagId('custom', 'Italian'), gone: 9999 };

    const results: Record<string, unknown> = {};
    for (const [name, intoId] of Object.entries(intoIds)) {
      const res = await send(t, 'POST', `/tags/${String(italien)}/merge`, cookie, { intoId });
      const { errors } = validationProblemSchema.parse(await res.json());
      results[name] = [res.status, ...errors.map(({ pointer, detail }) => `${pointer} ${detail}`)];
    }

    expect(results).toEqual({
      itself: [422, '#/intoId Choose another tag to merge it into.'],
      'another type': [422, '#/intoId Choose a tag of the same type.'],
      gone: [422, '#/intoId That tag no longer exists.'],
    });
    expect(tagEvents(t)).toEqual([]);
  });

  it('deletes a tag, taking it off every recipe that had it', async () => {
    const { t, cookie, editorId, tagId, recipeWith } = await setUpAdmin();
    const italian = tagId('cuisine', 'Italian');
    const weeknight = tagId('custom', 'Weeknight');
    const id = recipeWith(editorId, [italian, weeknight]);
    clearJobs(t);

    expect((await send(t, 'DELETE', `/tags/${String(italian)}`, cookie)).status).toBe(204);

    expect(tagsOf(t, id)).toEqual(['Weeknight']);
    expect(await tagNames(t, cookie, '?type=cuisine')).toEqual([]);
    expect(indexed(t)).toEqual([id]);
    expect(tagEvents(t)).toEqual([
      {
        action: 'tag.deleted',
        targetType: 'tag',
        targetId: String(italian),
        metadata: { type: 'cuisine', name: 'Italian', recipes: 1 },
      },
    ]);
  });

  it('refuses to change an allergen, or a tag that doesn’t exist', async () => {
    const { t, cookie, tagId } = await setUpAdmin();
    const milk = t.db.select({ id: tag.id }).from(tag).where(eq(tag.nameKey, 'milk')).get()?.id;
    const italian = tagId('cuisine', 'Italian');
    const changes = {
      rename: (id: number) => send(t, 'PUT', `/tags/${String(id)}`, cookie, { name: 'Dairy' }),
      merge: (id: number) =>
        send(t, 'POST', `/tags/${String(id)}/merge`, cookie, { intoId: italian }),
      delete: (id: number) => send(t, 'DELETE', `/tags/${String(id)}`, cookie),
    };

    const results: Record<string, number> = {};
    for (const [change, run] of Object.entries(changes)) {
      results[`${change} allergen`] = (await run(milk ?? 0)).status;
      results[`${change} missing`] = (await run(9999)).status;
    }

    expect(results).toEqual({
      'rename allergen': 409,
      'rename missing': 404,
      'merge allergen': 409,
      'merge missing': 404,
      'delete allergen': 409,
      'delete missing': 404,
    });
    expect(tagEvents(t)).toEqual([]);
  });

  it('counts the recipes with each tag that the admin may see', async () => {
    const { t, cookie, adminId, editorId, tagId, recipeWith } = await setUpAdmin();
    const italian = tagId('cuisine', 'Italian');
    tagId('cuisine', 'Thai');
    recipeWith(editorId, [italian]);
    recipeWith(editorId, [italian], 'private');
    recipeWith(adminId, [italian], 'private');
    const trashed = recipeWith(adminId, [italian]);
    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, trashed)).run();

    const res = await send(t, 'GET', '/tags/usage', cookie);

    expect(res.status).toBe(200);
    expect(tagUsageSchema.parse(await res.json()).usage).toEqual([{ tagId: italian, recipes: 2 }]);
  });
});
