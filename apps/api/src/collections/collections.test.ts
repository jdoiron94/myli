import {
  collectionIngredientsSchema,
  collectionListSchema,
  collectionSchema,
  collectionSummarySchema,
  RECIPES_PER_PAGE,
  recipeCollectionsSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { collectionItem, recipe } from '../db/schema.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

/** Sends a request to `/api/v1` + `path` as whoever has `cookie`. */
function send(t: TestApp, cookie: string, method: string, path: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function create(t: TestApp, cookie: string, name: string) {
  const res = await send(t, cookie, 'POST', '/collections', { name });
  expect(res.status).toBe(201);
  return collectionSummarySchema.parse(await res.json()).id;
}

/** The caller's collections, each as its name and how many recipes it shows. */
async function listed(t: TestApp, cookie: string) {
  const res = await send(t, cookie, 'GET', '/collections');
  expect(res.status).toBe(200);
  return collectionListSchema
    .parse(await res.json())
    .collections.map(({ name, recipeCount }) => `${name} (${String(recipeCount)})`);
}

/** One page of a collection, as whoever has `cookie` sees it. */
async function pageOf(t: TestApp, cookie: string, id: string, page = 1) {
  const res = await send(t, cookie, 'GET', `/collections/${id}?page=${String(page)}`);
  expect(res.status).toBe(200);
  return collectionSchema.parse(await res.json());
}

/** The titles of the recipes on a page of a collection, in its order. */
async function shown(t: TestApp, cookie: string, id: string, page = 1) {
  return (await pageOf(t, cookie, id, page)).recipes.map(({ title }) => title);
}

/** The titles of the recipes a collection's grocery list is added up from, in its order. */
async function forGroceries(t: TestApp, cookie: string, id: string) {
  const res = await send(t, cookie, 'GET', `/collections/${id}/ingredients`);
  expect(res.status).toBe(200);
  return collectionIngredientsSchema.parse(await res.json()).recipes.map(({ title }) => title);
}

/** Moves a recipe one place in a collection, as whoever has `cookie`: the status. */
async function move(
  t: TestApp,
  cookie: string,
  id: string,
  recipeId: string,
  direction: 'earlier' | 'later',
) {
  const path = `/collections/${id}/recipes/${recipeId}/move`;
  return (await send(t, cookie, 'POST', path, { direction })).status;
}

/** A shared recipe of `ownerId`'s, with this title. */
function titled(t: TestApp, ownerId: string, title: string) {
  const id = insertRecipe(t.db, ownerId);
  t.db.update(recipe).set({ title }).where(eq(recipe.id, id)).run();
  return id;
}

describe('collections', () => {
  it('are created, listed by name, renamed and deleted by their owner, names shared or not', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    const weeknight = await create(t, cookie, 'Weeknight');
    const baking = await create(t, cookie, 'baking');
    await create(t, cookie, 'Weeknight');
    expect(await listed(t, cookie)).toEqual(['baking (0)', 'Weeknight (0)', 'Weeknight (0)']);

    expect(
      (await send(t, cookie, 'PUT', `/collections/${baking}`, { name: 'Weeknight' })).status,
    ).toBe(204);
    expect((await send(t, cookie, 'DELETE', `/collections/${weeknight}`)).status).toBe(204);
    expect(await listed(t, cookie)).toEqual(['Weeknight (0)', 'Weeknight (0)']);
  });

  it('hold recipes, each once, in the order their owner puts them', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const bread = titled(t, user.id, 'Bread');
    const curry = titled(t, user.id, 'Curry');
    const tacos = titled(t, user.id, 'Tacos');
    const id = await create(t, cookie, 'Weeknight');
    const other = await create(t, cookie, 'Baking');
    for (const recipeId of [bread, curry, tacos, bread]) {
      expect((await send(t, cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`)).status).toBe(
        204,
      );
    }
    await send(t, cookie, 'PUT', `/collections/${other}/recipes/${bread}`);
    expect(await shown(t, cookie, id)).toEqual(['Bread', 'Curry', 'Tacos']);

    const moved = {
      tacosEarlier: await move(t, cookie, id, tacos, 'earlier'),
      // Already at that end.
      breadEarlier: await move(t, cookie, id, bread, 'earlier'),
      curryLater: await move(t, cookie, id, curry, 'later'),
      notInIt: await move(t, cookie, id, insertRecipe(t.db, user.id), 'later'),
    };
    expect(moved).toEqual({ tacosEarlier: 204, breadEarlier: 204, curryLater: 204, notInIt: 404 });
    expect(await shown(t, cookie, id)).toEqual(['Bread', 'Tacos', 'Curry']);

    expect((await send(t, cookie, 'DELETE', `/collections/${id}/recipes/${bread}`)).status).toBe(
      204,
    );
    expect(await shown(t, cookie, id)).toEqual(['Tacos', 'Curry']);
    expect(await listed(t, cookie)).toEqual(['Baking (1)', 'Weeknight (2)']);
    const holding = await send(t, cookie, 'GET', `/recipes/${bread}/collections`);
    expect(recipeCollectionsSchema.parse(await holding.json())).toEqual({ collectionIds: [other] });
  });

  it('are never seen or changed by anyone else, admins included', async () => {
    const t = createTestApp();
    const [owner, admin] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'admin')]);
    const recipeId = insertRecipe(t.db, owner.user.id);
    const id = await create(t, owner.cookie, 'Weeknight');
    await send(t, owner.cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`);

    const statuses = {
      get: (await send(t, admin.cookie, 'GET', `/collections/${id}`)).status,
      ingredients: (await send(t, admin.cookie, 'GET', `/collections/${id}/ingredients`)).status,
      empty: (await send(t, admin.cookie, 'DELETE', `/collections/${id}/recipes`)).status,
      rename: (await send(t, admin.cookie, 'PUT', `/collections/${id}`, { name: 'Mine' })).status,
      move: await move(t, admin.cookie, id, recipeId, 'later'),
      add: (await send(t, admin.cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`)).status,
      remove: (await send(t, admin.cookie, 'DELETE', `/collections/${id}/recipes/${recipeId}`))
        .status,
      delete: (await send(t, admin.cookie, 'DELETE', `/collections/${id}`)).status,
    };
    expect(statuses).toEqual({
      get: 404,
      ingredients: 404,
      empty: 404,
      rename: 404,
      move: 404,
      add: 404,
      remove: 404,
      delete: 404,
    });
    expect(await listed(t, admin.cookie)).toEqual([]);
    const holding = await send(t, admin.cookie, 'GET', `/recipes/${recipeId}/collections`);
    expect(recipeCollectionsSchema.parse(await holding.json())).toEqual({ collectionIds: [] });
    expect(await shown(t, owner.cookie, id)).toHaveLength(1);
  });

  it('leave out, uncounted, a recipe their owner may no longer see, which keeps its place until it’s back', async () => {
    const t = createTestApp();
    const [reader, author] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'editor')]);
    const bread = titled(t, reader.user.id, 'Bread');
    const theirs = titled(t, author.user.id, 'Their Stew');
    const curry = titled(t, reader.user.id, 'Curry');
    const id = await create(t, reader.cookie, 'Weeknight');
    for (const recipeId of [bread, theirs, curry]) {
      await send(t, reader.cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`);
    }
    const setTheirs = (values: Partial<typeof recipe.$inferInsert>) =>
      t.db.update(recipe).set(values).where(eq(recipe.id, theirs)).run();

    setTheirs({ visibility: 'private' });
    const hidden = await pageOf(t, reader.cookie, id);
    expect({ titles: hidden.recipes.map(({ title }) => title), total: hidden.total }).toEqual({
      titles: ['Bread', 'Curry'],
      total: 2,
    });
    expect(await listed(t, reader.cookie)).toEqual(['Weeknight (2)']);
    expect(await forGroceries(t, reader.cookie, id)).toEqual(['Bread', 'Curry']);
    // Past the one it shows before it, swapping places with it, around the one it doesn't.
    expect(await move(t, reader.cookie, id, curry, 'earlier')).toBe(204);
    setTheirs({ visibility: 'shared', deletedAt: new Date() });
    expect(await shown(t, reader.cookie, id)).toEqual(['Curry', 'Bread']);

    setTheirs({ deletedAt: null });
    expect(await shown(t, reader.cookie, id)).toEqual(['Curry', 'Their Stew', 'Bread']);
  });

  it('are emptied in one go, of the recipes their owner can no longer see too', async () => {
    const t = createTestApp();
    const [reader, author] = await Promise.all([signedInAs(t, 'editor'), signedInAs(t, 'editor')]);
    const theirs = titled(t, author.user.id, 'Their Stew');
    const id = await create(t, reader.cookie, 'This week');
    for (const recipeId of [titled(t, reader.user.id, 'Bread'), theirs]) {
      await send(t, reader.cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`);
    }
    const setTheirs = (visibility: 'private' | 'shared') =>
      t.db.update(recipe).set({ visibility }).where(eq(recipe.id, theirs)).run();

    setTheirs('private');
    expect((await send(t, reader.cookie, 'DELETE', `/collections/${id}/recipes`)).status).toBe(204);
    setTheirs('shared');
    expect(await shown(t, reader.cookie, id)).toEqual([]);
  });

  it('page their recipes, with no limit on how many, moved from page to page', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const id = await create(t, cookie, 'Everything');
    const held = t.db
      .insert(recipe)
      .values(
        Array.from({ length: RECIPES_PER_PAGE + 1 }, (_, index) => ({
          ownerId: user.id,
          visibility: 'shared' as const,
          title: `Recipe ${String(index + 1)}`,
          servings: 2,
        })),
      )
      .returning({ id: recipe.id })
      .all();
    t.db
      .insert(collectionItem)
      .values(held.map((row, index) => ({ collectionId: id, recipeId: row.id, position: index })))
      .run();
    const last = `Recipe ${String(RECIPES_PER_PAGE + 1)}`;

    const first = await pageOf(t, cookie, id);
    expect({ shown: first.recipes.length, total: first.total, pages: first.totalPages }).toEqual({
      shown: RECIPES_PER_PAGE,
      total: RECIPES_PER_PAGE + 1,
      pages: 2,
    });
    expect(await shown(t, cookie, id, 2)).toEqual([last]);

    const lastId = held.at(-1)?.id ?? '';
    expect(await move(t, cookie, id, lastId, 'earlier')).toBe(204);
    expect({
      endOfFirst: (await shown(t, cookie, id)).at(-1),
      second: await shown(t, cookie, id, 2),
    }).toEqual({ endOfFirst: last, second: [`Recipe ${String(RECIPES_PER_PAGE)}`] });
  });

  it('give the ingredients of all their recipes at once, in their order, for the grocery list', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const id = await create(t, cookie, 'This week');
    const bare = t.db
      .insert(recipe)
      .values(
        Array.from({ length: RECIPES_PER_PAGE }, (_, index) => ({
          ownerId: user.id,
          visibility: 'shared' as const,
          title: `Recipe ${String(index + 1)}`,
          servings: 2,
        })),
      )
      .returning({ id: recipe.id })
      .all();
    t.db
      .insert(collectionItem)
      .values(bare.map((row, index) => ({ collectionId: id, recipeId: row.id, position: index })))
      .run();
    const bread = insertRecipe(t.db, user.id);
    await send(t, cookie, 'PUT', `/collections/${id}/recipes/${bread}`);

    const res = await send(t, cookie, 'GET', `/collections/${id}/ingredients`);
    expect(res.status).toBe(200);
    const { name, recipes } = collectionIngredientsSchema.parse(await res.json());
    expect({ name, count: recipes.length, first: recipes[0]?.title, last: recipes.at(-1) }).toEqual(
      {
        name: 'This week',
        count: RECIPES_PER_PAGE + 1,
        first: 'Recipe 1',
        last: {
          id: bread,
          title: 'Weeknight Bread',
          servings: 8,
          ingredients: [
            {
              qty: 3,
              qtyMax: null,
              unit: 'cup',
              name: 'all-purpose flour',
              normalizedName: 'all purpose flour',
              scalable: true,
            },
            {
              qty: null,
              qtyMax: null,
              unit: null,
              name: 'salt',
              normalizedName: 'salt',
              scalable: false,
            },
          ],
        },
      },
    );
  });
});
