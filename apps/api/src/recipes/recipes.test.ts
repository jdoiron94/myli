import {
  type CreateRecipeRequest,
  type Recipe,
  type Role,
  recipeResultSchema,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditEvent, job, recipeIngredient, recipe as recipeTable, tag } from '../db/schema.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { deactivateUser } from '../users/manage.ts';
import { deleteRecipe } from './recipes.ts';
import { insertRecipe, sampleRecipeContent, sampleRecipeRequest } from './testing.ts';

afterEach(() => {
  vi.useRealTimers();
});

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

async function recipeFrom(res: Response): Promise<Recipe> {
  return recipeResultSchema.parse(await res.json()).recipe;
}

/** The fields of a validation problem, by JSON pointer. */
async function fieldErrors(res: Response): Promise<Record<string, string>> {
  expect(res.status).toBe(422);
  const { errors } = validationProblemSchema.parse(await res.json());
  return Object.fromEntries(errors.map(({ pointer, detail }) => [pointer, detail]));
}

function tagId(t: TestApp, name: string): number {
  const row = t.db.select().from(tag).where(eq(tag.name, name)).get();
  if (!row) throw new Error(`no tag ${name}`);
  return row.id;
}

async function setUp(role: Role = 'editor') {
  const t = createTestApp();
  return { t, ...(await signedInAs(t, role)) };
}

describe('POST /recipes', () => {
  it('creates a recipe the caller owns, and answers with it and where it lives', async () => {
    const { t, user, cookie } = await setUp();
    const res = await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest());

    expect(res.status).toBe(201);
    const created = await recipeFrom(res);
    expect(res.headers.get('location')).toBe(`/api/v1/recipes/${created.id}`);
    expect(created).toMatchObject({
      owner: { id: user.id, name: user.name },
      visibility: 'shared',
      title: 'Weeknight Bread',
      description: 'A *simple* loaf.',
      yield: { qty: 1, unit: 'loaf' },
      totalMinutes: 180,
      steps: [{ body: 'Mix everything.' }, { body: 'Bake at **400°F**.' }],
    });
  });

  it('reads back exactly what was sent, plus what the server works out', async () => {
    const { t, user, cookie } = await setUp();
    const request = sampleRecipeRequest({ tagIds: [tagId(t, 'wheat')] });
    const created = await recipeFrom(await send(t, 'POST', '/recipes', cookie, request));

    // toEqual skips properties that are undefined: the request's IDs become what they name.
    expect(created).toEqual({
      ...request,
      tagIds: undefined,
      imageIds: undefined,
      images: [],
      steps: request.steps.map(({ body }) => ({ body, image: null })),
      id: expect.any(String),
      owner: { id: user.id, name: user.name },
      ingredientGroups: request.ingredientGroups.map((group) => ({
        ...group,
        ingredients: group.ingredients.map((line) => ({
          ...line,
          normalizedName: line.name === 'salt' ? 'salt' : 'all purpose flour',
        })),
      })),
      tags: [{ id: tagId(t, 'wheat'), type: 'allergen', name: 'wheat' }],
      createdAt: expect.any(String),
      updatedAt: created.createdAt,
    });
    expect(
      t.db.select().from(recipeTable).where(eq(recipeTable.id, created.id)).get()?.ownerId,
    ).toBe(user.id);
  });

  it('stores a unit by the unit table’s name, and empty optional text as null', async () => {
    const { t, cookie } = await setUp();
    const request = sampleRecipeRequest({
      source: { url: null, title: '  ', author: '' },
      yield: { qty: 24, unit: '' },
      ingredientGroups: [
        {
          label: ' ',
          ingredients: [
            {
              rawText: '2 Tablespoons honey',
              qty: 2,
              qtyMax: null,
              unit: 'Tablespoons',
              name: 'Honey',
              note: '',
              scalable: true,
            },
            {
              rawText: '1 knob butter',
              qty: 1,
              qtyMax: null,
              unit: 'knob',
              name: 'butter',
              note: null,
              scalable: true,
            },
          ],
        },
      ],
    });
    const created = await recipeFrom(await send(t, 'POST', '/recipes', cookie, request));

    expect(created.source).toEqual({ url: null, title: null, author: null });
    expect(created.yield).toEqual({ qty: 24, unit: null });
    const [group] = created.ingredientGroups;
    expect(group?.label).toBeNull();
    expect(
      group?.ingredients.map(({ unit, note, normalizedName }) => [unit, note, normalizedName]),
    ).toEqual([
      ['tbsp', null, 'honey'],
      ['knob', null, 'butter'],
    ]);
  });

  it('keeps groups and lines in order, and tags by type and then name', async () => {
    const { t, cookie } = await setUp();
    const line = (name: string) => ({
      rawText: name,
      qty: null,
      qtyMax: null,
      unit: null,
      name,
      note: null,
      scalable: true,
    });
    const italian = t.db
      .insert(tag)
      .values({ type: 'cuisine', name: 'Italian', nameKey: 'italian' })
      .returning()
      .get();
    const request = sampleRecipeRequest({
      ingredientGroups: [
        { label: 'For the dough', ingredients: [line('flour'), line('water'), line('yeast')] },
        { label: 'For the filling', ingredients: [line('cheese')] },
      ],
      tagIds: [tagId(t, 'wheat'), italian.id, tagId(t, 'milk')],
    });
    const created = await recipeFrom(await send(t, 'POST', '/recipes', cookie, request));

    expect(
      created.ingredientGroups.map(({ label, ingredients }) => [
        label,
        ingredients.map(({ name }) => name),
      ]),
    ).toEqual([
      ['For the dough', ['flour', 'water', 'yeast']],
      ['For the filling', ['cheese']],
    ]);
    expect(created.tags.map(({ name }) => name)).toEqual(['Italian', 'milk', 'wheat']);
  });

  it('creates a private recipe, and one with nothing but a title and servings', async () => {
    const { t, cookie } = await setUp();
    const bare: CreateRecipeRequest = {
      ...sampleRecipeRequest(),
      visibility: 'private',
      description: '',
      source: { url: null, title: null, author: null },
      equipment: [],
      yield: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      difficulty: null,
      nutrition: {
        calories: null,
        proteinGrams: null,
        carbsGrams: null,
        fatGrams: null,
        fiberGrams: null,
        sugarGrams: null,
        sodiumMilligrams: null,
      },
      ingredientGroups: [],
      steps: [],
    };
    const res = await send(t, 'POST', '/recipes', cookie, bare);
    expect(res.status).toBe(201);
    expect(await recipeFrom(res)).toMatchObject({ visibility: 'private', ingredientGroups: [] });
  });

  it('names each tag that no longer exists, and saves nothing', async () => {
    const { t, cookie } = await setUp();
    const request = sampleRecipeRequest({ tagIds: [tagId(t, 'milk'), 9999, 8888] });
    const res = await send(t, 'POST', '/recipes', cookie, request);

    expect(await fieldErrors(res)).toEqual({
      '#/tagIds/1': 'This tag no longer exists. Choose another.',
      '#/tagIds/2': 'This tag no longer exists. Choose another.',
    });
    expect(t.db.select().from(recipeTable).all()).toEqual([]);
  });

  it.each<[string, Partial<CreateRecipeRequest>, string]>([
    ['a blank title', { title: '   ' }, '#/title'],
    ['no servings', { servings: 0 }, '#/servings'],
    ['a fraction of a serving', { servings: 2.5 }, '#/servings'],
    ['negative minutes', { cookMinutes: -5 }, '#/cookMinutes'],
    [
      'a source that is not a web address',
      { source: { url: 'javascript:alert(1)', title: null, author: null } },
      '#/source/url',
    ],
    ['the same tag twice', { tagIds: [1, 1] }, '#/tagIds'],
    ['a step without words', { steps: [{ body: ' ', imageId: null }] }, '#/steps/0/body'],
    [
      'an empty ingredient group',
      { ingredientGroups: [{ label: null, ingredients: [] }] },
      '#/ingredientGroups/0/ingredients',
    ],
  ])('refuses %s', async (_, overrides, pointer) => {
    const { t, cookie } = await setUp();
    const res = await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest(overrides));
    expect(Object.keys(await fieldErrors(res))).toContain(pointer);
  });

  it('refuses a range that goes down', async () => {
    const { t, cookie } = await setUp();
    const request = sampleRecipeRequest();
    const [group] = request.ingredientGroups;
    const [line] = group?.ingredients ?? [];
    if (!group || !line) throw new Error('the sample has a line');
    group.ingredients = [{ ...line, qty: 3, qtyMax: 2 }];
    const res = await send(t, 'POST', '/recipes', cookie, request);
    expect(await fieldErrors(res)).toEqual({
      '#/ingredientGroups/0/ingredients/0/qtyMax':
        'The top of a range must be more than its bottom.',
    });
  });

  it('refuses more than 200 ingredients across the groups', async () => {
    const { t, cookie } = await setUp();
    const line = {
      rawText: 'salt',
      qty: null,
      qtyMax: null,
      unit: null,
      name: 'salt',
      note: null,
      scalable: true,
    };
    const group = { label: null, ingredients: Array.from({ length: 101 }, () => line) };
    const res = await send(
      t,
      'POST',
      '/recipes',
      cookie,
      sampleRecipeRequest({ ingredientGroups: [group, group] }),
    );
    expect(await fieldErrors(res)).toEqual({
      '#/ingredientGroups': 'A recipe can have up to 200 ingredients.',
    });
  });
});

describe('GET /recipes/{id}', () => {
  it('shows a shared recipe to everyone signed in, viewers included', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const reader = await signedInAs(t, role);
      const res = await send(t, 'GET', `/recipes/${id}`, reader.cookie);
      expect(res.status).toBe(200);
      expect((await recipeFrom(res)).id).toBe(id);
    }
  });

  it('shows a private recipe to its owner', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    expect((await send(t, 'GET', `/recipes/${id}`, cookie)).status).toBe(200);
  });

  it('answers someone else’s private recipe, admins included, exactly as a missing one', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    const admin = await signedInAs(t, 'admin');

    const hidden = await send(t, 'GET', `/recipes/${id}`, admin.cookie);
    const missing = await send(t, 'GET', '/recipes/no-such-recipe', admin.cookie);
    expect(hidden.status).toBe(404);
    const body = async (res: Response) => ({
      ...((await res.json()) as Record<string, unknown>),
      requestId: undefined,
    });
    expect(await body(hidden)).toEqual(await body(missing));
  });

  it('keeps a private recipe private after its owner is deactivated', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    const admin = await signedInAs(t, 'admin');
    const deactivated = deactivateUser(
      t.db,
      { actorId: admin.user.id, ip: null, userAgent: null },
      user.id,
    );
    expect(deactivated.ok).toBe(true);

    expect((await send(t, 'GET', `/recipes/${id}`, admin.cookie)).status).toBe(404);
  });

  it('answers 404 for a deleted recipe, even to its owner', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    t.db.update(recipeTable).set({ deletedAt: new Date() }).where(eq(recipeTable.id, id)).run();
    expect((await send(t, 'GET', `/recipes/${id}`, cookie)).status).toBe(404);
  });

  it('answers 401 to anonymous callers, before looking for the recipe', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    expect((await send(t, 'GET', `/recipes/${id}`)).status).toBe(401);
    expect((await send(t, 'GET', '/recipes/no-such-recipe')).status).toBe(401);
  });
});

describe('PUT /recipes/{id}', () => {
  const save = (t: TestApp, id: string, cookie: string, body: unknown) =>
    send(t, 'PUT', `/recipes/${id}`, cookie, body);

  it('replaces the content, lines, steps and tags, and keeps the owner and visibility', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T10:00:00Z') });
    const { t, user, cookie } = await setUp('editor');
    const created = await recipeFrom(
      await send(
        t,
        'POST',
        '/recipes',
        cookie,
        sampleRecipeRequest({ tagIds: [tagId(t, 'milk')] }),
      ),
    );
    vi.setSystemTime(new Date('2026-11-16T10:05:00Z'));

    const content = sampleRecipeContent({
      title: 'Sunday Bread',
      servings: 12,
      ingredientGroups: [
        {
          label: 'For the starter',
          ingredients: [
            {
              rawText: '1 cup water',
              qty: 1,
              qtyMax: null,
              unit: 'cup',
              name: 'Water',
              note: null,
              scalable: true,
            },
          ],
        },
      ],
      steps: [{ body: 'Wait a day.', imageId: null }],
      tagIds: [tagId(t, 'wheat')],
    });
    const res = await save(t, created.id, cookie, content);

    expect(res.status).toBe(200);
    const saved = await recipeFrom(res);
    expect(saved).toMatchObject({
      id: created.id,
      owner: { id: user.id },
      visibility: 'shared',
      title: 'Sunday Bread',
      servings: 12,
      ingredientGroups: [
        { label: 'For the starter', ingredients: [{ name: 'Water', normalizedName: 'water' }] },
      ],
      steps: [{ body: 'Wait a day.' }],
      tags: [{ name: 'wheat' }],
      createdAt: '2026-11-16T10:00:00.000Z',
      updatedAt: '2026-11-16T10:05:00.000Z',
    });
    expect(await recipeFrom(await send(t, 'GET', `/recipes/${created.id}`, cookie))).toEqual(saved);
  });

  it('lets an editor save someone else’s shared recipe, which stays theirs', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const other = await signedInAs(t, 'editor');

    const res = await save(t, id, other.cookie, sampleRecipeContent({ title: 'Improved' }));
    expect(res.status).toBe(200);
    expect(await recipeFrom(res)).toMatchObject({ title: 'Improved', owner: { id: user.id } });
  });

  it('refuses viewers with 403, and hides someone else’s private recipe with 404', async () => {
    const { t, user } = await setUp('editor');
    const shared = insertRecipe(t.db, user.id, 'shared');
    const hidden = insertRecipe(t.db, user.id, 'private');
    const viewer = await signedInAs(t, 'viewer');
    const admin = await signedInAs(t, 'admin');

    expect((await save(t, shared, viewer.cookie, sampleRecipeContent())).status).toBe(403);
    expect((await save(t, hidden, admin.cookie, sampleRecipeContent())).status).toBe(404);
  });

  it('changes nothing when a tag no longer exists', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id);
    const res = await save(t, id, cookie, sampleRecipeContent({ title: 'Lost', tagIds: [9999] }));

    expect(await fieldErrors(res)).toEqual({
      '#/tagIds/0': 'This tag no longer exists. Choose another.',
    });
    const unchanged = await recipeFrom(await send(t, 'GET', `/recipes/${id}`, cookie));
    expect(unchanged.title).toBe('Weeknight Bread');
    expect(unchanged.ingredientGroups[0]?.ingredients).toHaveLength(2);
  });

  it('answers 404 for a deleted recipe', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id);
    t.db.update(recipeTable).set({ deletedAt: new Date() }).where(eq(recipeTable.id, id)).run();
    expect((await save(t, id, cookie, sampleRecipeContent())).status).toBe(404);
  });

  it('keeps the last save, until drafts bring a concurrency check', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id);
    const other = await signedInAs(t, 'editor');
    await save(t, id, cookie, sampleRecipeContent({ title: 'First' }));
    await save(t, id, other.cookie, sampleRecipeContent({ title: 'Second' }));
    expect((await recipeFrom(await send(t, 'GET', `/recipes/${id}`, cookie))).title).toBe('Second');
  });

  it('ignores a visibility in the body: it’s changed on its own', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const res = await save(t, id, cookie, { ...sampleRecipeContent(), visibility: 'private' });
    // Unknown keys are dropped, so the save goes through and the visibility stays.
    expect(res.status).toBe(200);
    expect((await recipeFrom(res)).visibility).toBe('shared');
  });
});

describe('PUT /recipes/{id}/visibility', () => {
  const setVisibility = (t: TestApp, id: string, cookie: string, visibility: string) =>
    send(t, 'PUT', `/recipes/${id}/visibility`, cookie, { visibility });

  it('lets the owner make a shared recipe private, which hides it from everyone else', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const admin = await signedInAs(t, 'admin');
    expect((await send(t, 'GET', `/recipes/${id}`, admin.cookie)).status).toBe(200);

    const res = await setVisibility(t, id, cookie, 'private');
    expect(res.status).toBe(200);
    expect((await recipeFrom(res)).visibility).toBe('private');
    expect((await send(t, 'GET', `/recipes/${id}`, admin.cookie)).status).toBe(404);
    expect((await send(t, 'GET', `/recipes/${id}`, cookie)).status).toBe(200);
  });

  it('lets the owner share a private recipe', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    const viewer = await signedInAs(t, 'viewer');

    expect((await setVisibility(t, id, cookie, 'shared')).status).toBe(200);
    expect((await send(t, 'GET', `/recipes/${id}`, viewer.cookie)).status).toBe(200);
  });

  it('refuses everyone but the owner, admins included', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    for (const role of ['admin', 'editor'] as const) {
      const other = await signedInAs(t, role);
      expect((await setVisibility(t, id, other.cookie, 'private')).status).toBe(403);
    }
    const unchanged = await recipeFrom(
      await send(t, 'GET', `/recipes/${id}`, (await signedInAs(t, 'viewer')).cookie),
    );
    expect(unchanged.visibility).toBe('shared');
  });

  it('refuses an owner who was demoted to viewer', async () => {
    const { t, user, cookie } = await setUp('viewer');
    const id = insertRecipe(t.db, user.id, 'private');
    expect((await setVisibility(t, id, cookie, 'shared')).status).toBe(403);
  });

  it('changes nothing when the recipe already has that visibility', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const res = await setVisibility(t, id, cookie, 'shared');
    expect(res.status).toBe(200);
    expect((await recipeFrom(res)).visibility).toBe('shared');
  });

  it('refuses a visibility that doesn’t exist, and answers 404 for a deleted recipe', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    expect(Object.keys(await fieldErrors(await setVisibility(t, id, cookie, 'public')))).toEqual([
      '#/visibility',
    ]);
    t.db.update(recipeTable).set({ deletedAt: new Date() }).where(eq(recipeTable.id, id)).run();
    expect((await setVisibility(t, id, cookie, 'private')).status).toBe(404);
  });
});

describe('DELETE /recipes/{id}', () => {
  const remove = (t: TestApp, id: string, cookie: string) =>
    send(t, 'DELETE', `/recipes/${id}`, cookie);
  const deletions = (t: TestApp) =>
    t.db.select().from(auditEvent).where(eq(auditEvent.action, 'recipe.deleted')).all();

  it('hides the recipe everywhere, keeping its rows for the trash', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');

    const res = await remove(t, id, cookie);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect((await send(t, 'GET', `/recipes/${id}`, cookie)).status).toBe(404);
    expect((await send(t, 'PUT', `/recipes/${id}`, cookie, sampleRecipeContent())).status).toBe(
      404,
    );
    expect(
      (await send(t, 'PUT', `/recipes/${id}/visibility`, cookie, { visibility: 'private' })).status,
    ).toBe(404);
    expect((await remove(t, id, cookie)).status).toBe(404);

    const row = t.db.select().from(recipeTable).where(eq(recipeTable.id, id)).get();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(
      t.db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, id)).all(),
    ).toHaveLength(2);
  });

  it('records who deleted it, and a shared recipe’s title', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    await t.app.request(`/api/v1/recipes/${id}`, {
      method: 'DELETE',
      headers: { cookie, 'content-type': 'application/json', 'user-agent': 'Recipe Tests' },
    });

    expect(deletions(t)).toEqual([
      expect.objectContaining({
        actorId: user.id,
        targetType: 'recipe',
        targetId: id,
        metadata: { title: 'Weeknight Bread', visibility: 'shared' },
        userAgent: 'Recipe Tests',
      }),
    ]);
  });

  it('keeps a private recipe’s title out of the log, which admins read', async () => {
    const { t, user, cookie } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'private');
    expect((await remove(t, id, cookie)).status).toBe(204);

    const [event] = deletions(t);
    expect(event?.metadata).toEqual({ visibility: 'private' });
    expect(JSON.stringify(event)).not.toContain('Weeknight Bread');
  });

  it('lets an admin delete someone else’s shared recipe, but not an editor', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const editor = await signedInAs(t, 'editor');
    const admin = await signedInAs(t, 'admin');

    expect((await remove(t, id, editor.cookie)).status).toBe(403);
    expect((await remove(t, id, admin.cookie)).status).toBe(204);
    expect(deletions(t).map(({ actorId }) => actorId)).toEqual([admin.user.id]);
  });

  it('deletes once: a recipe already deleted is left alone, and recorded once', async () => {
    const { t, user } = await setUp('editor');
    const id = insertRecipe(t.db, user.id, 'shared');
    const origin = { actorId: user.id, ip: null, userAgent: null };

    expect(deleteRecipe(t.db, origin, id)).toBe(true);
    const { deletedAt } = t.db.select().from(recipeTable).where(eq(recipeTable.id, id)).get() ?? {};
    expect(deleteRecipe(t.db, origin, id)).toBe(false);
    expect(deleteRecipe(t.db, origin, 'no-such-recipe')).toBe(false);
    expect(deletions(t)).toHaveLength(1);
    expect(t.db.select().from(recipeTable).where(eq(recipeTable.id, id)).get()?.deletedAt).toEqual(
      deletedAt,
    );
  });

  it('hides someone else’s private recipe from admins, and refuses viewers', async () => {
    const { t, user } = await setUp('editor');
    const hidden = insertRecipe(t.db, user.id, 'private');
    const admin = await signedInAs(t, 'admin');
    const viewer = await signedInAs(t, 'viewer');
    const viewersOwn = insertRecipe(t.db, viewer.user.id, 'private');

    expect((await remove(t, hidden, admin.cookie)).status).toBe(404);
    expect((await remove(t, viewersOwn, viewer.cookie)).status).toBe(403);
    expect(deletions(t)).toEqual([]);
  });
});

describe('the search index', () => {
  /** The recipes the search index has been told to update, in the order it was told. */
  const indexed = (t: TestApp) =>
    t.db
      .select({ type: job.type, payload: job.payload })
      .from(job)
      .all()
      .filter(({ type }) => type === 'search.index-recipe')
      .map(({ payload }) => payload);

  it('is told of every change to a recipe: creating, saving, sharing and deleting it', async () => {
    const { t, cookie } = await setUp();
    const { id } = await recipeFrom(
      await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest({ visibility: 'private' })),
    );
    expect(indexed(t)).toEqual([{ recipeId: id }]);

    expect(
      (await send(t, 'PUT', `/recipes/${id}`, cookie, sampleRecipeContent({ title: 'Rye' })))
        .status,
    ).toBe(200);
    expect(
      (await send(t, 'PUT', `/recipes/${id}/visibility`, cookie, { visibility: 'shared' })).status,
    ).toBe(200);
    expect((await send(t, 'DELETE', `/recipes/${id}`, cookie)).status).toBe(204);

    expect(indexed(t)).toEqual([
      { recipeId: id },
      { recipeId: id },
      { recipeId: id },
      { recipeId: id },
    ]);
  });

  it('isn’t told of changes that were refused, which change nothing', async () => {
    const { t, cookie, user } = await setUp();
    const viewer = await signedInAs(t, 'viewer');
    const id = insertRecipe(t.db, user.id);
    const before = indexed(t).length;
    const missingTag = { tagIds: [987_654] };

    const refused = [
      await send(t, 'POST', '/recipes', cookie, sampleRecipeRequest(missingTag)),
      await send(t, 'PUT', `/recipes/${id}`, cookie, sampleRecipeContent(missingTag)),
      await send(t, 'PUT', `/recipes/${id}`, viewer.cookie, sampleRecipeContent()),
      await send(t, 'PUT', `/recipes/${id}/visibility`, viewer.cookie, { visibility: 'private' }),
      await send(t, 'DELETE', `/recipes/${id}`, viewer.cookie),
    ].map((res) => res.status);
    expect(refused).toEqual([422, 422, 403, 403, 403]);
    expect(indexed(t)).toHaveLength(before);

    deleteRecipe(t.db, { actorId: user.id, ip: null, userAgent: null }, id);
    const afterDelete = indexed(t).length;
    const gone = [
      await send(t, 'PUT', `/recipes/${id}`, cookie, sampleRecipeContent()),
      await send(t, 'PUT', `/recipes/${id}/visibility`, cookie, { visibility: 'private' }),
      await send(t, 'DELETE', `/recipes/${id}`, cookie),
    ].map((res) => res.status);
    expect(gone).toEqual([404, 404, 404]);
    expect(indexed(t)).toHaveLength(afterDelete);
  });
});
