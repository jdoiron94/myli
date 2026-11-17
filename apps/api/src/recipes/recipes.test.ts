import {
  type CreateRecipeRequest,
  type Recipe,
  type Role,
  recipeResultSchema,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recipe as recipeTable, tag } from '../db/schema.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { deactivateUser } from '../users/manage.ts';
import { insertRecipe, sampleRecipeRequest } from './testing.ts';

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

    // toEqual skips properties that are undefined: the request's tagIds become the tags.
    expect(created).toEqual({
      ...request,
      tagIds: undefined,
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
    ['a step without words', { steps: [{ body: ' ' }] }, '#/steps/0/body'],
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
