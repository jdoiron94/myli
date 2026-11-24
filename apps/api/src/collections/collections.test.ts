import {
  COLLECTION_MAX_RECIPES,
  collectionListSchema,
  collectionSchema,
  collectionSummarySchema,
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

/** The titles of the recipes a collection shows, in its order. */
async function shown(t: TestApp, cookie: string, id: string) {
  const res = await send(t, cookie, 'GET', `/collections/${id}`);
  expect(res.status).toBe(200);
  return collectionSchema.parse(await res.json()).recipes.map(({ title }) => title);
}

/** A shared recipe of `ownerId`'s, with this title. */
function titled(t: TestApp, ownerId: string, title: string) {
  const id = insertRecipe(t.db, ownerId);
  t.db.update(recipe).set({ title }).where(eq(recipe.id, id)).run();
  return id;
}

describe('collections', () => {
  it('are named, by name, renamed and deleted by their owner, each with a name of its own', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    const weeknight = await create(t, cookie, 'Weeknight');
    const baking = await create(t, cookie, 'baking');
    expect(await listed(t, cookie)).toEqual(['baking (0)', 'Weeknight (0)']);

    const taken = {
      create: await send(t, cookie, 'POST', '/collections', { name: ' weeknight ' }),
      rename: await send(t, cookie, 'PUT', `/collections/${baking}`, { name: 'WEEKNIGHT' }),
    };
    for (const res of Object.values(taken)) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        errors: [
          { pointer: '#/name', detail: 'You already have a collection called “Weeknight”.' },
        ],
      });
    }
    // Its own name, another way.
    expect(
      (await send(t, cookie, 'PUT', `/collections/${baking}`, { name: 'Baking' })).status,
    ).toBe(204);
    expect((await send(t, cookie, 'DELETE', `/collections/${weeknight}`)).status).toBe(204);
    expect(await listed(t, cookie)).toEqual(['Baking (0)']);
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

    const order = (recipeIds: string[]) =>
      send(t, cookie, 'PUT', `/collections/${id}/order`, { recipeIds });
    expect((await order([tacos, bread, curry])).status).toBe(204);
    expect(await shown(t, cookie, id)).toEqual(['Tacos', 'Bread', 'Curry']);
    // Not exactly what it holds, as when it changed since it was loaded.
    const refused = {
      missing: (await order([tacos, bread])).status,
      twice: (await order([tacos, bread, bread])).status,
      extra: (await order([tacos, bread, curry, insertRecipe(t.db, user.id)])).status,
    };
    expect(refused).toEqual({ missing: 409, twice: 409, extra: 409 });

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
      rename: (await send(t, admin.cookie, 'PUT', `/collections/${id}`, { name: 'Mine' })).status,
      order: (
        await send(t, admin.cookie, 'PUT', `/collections/${id}/order`, { recipeIds: [recipeId] })
      ).status,
      add: (await send(t, admin.cookie, 'PUT', `/collections/${id}/recipes/${recipeId}`)).status,
      remove: (await send(t, admin.cookie, 'DELETE', `/collections/${id}/recipes/${recipeId}`))
        .status,
      delete: (await send(t, admin.cookie, 'DELETE', `/collections/${id}`)).status,
    };
    expect(statuses).toEqual({
      get: 404,
      rename: 404,
      order: 404,
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
    expect(await shown(t, reader.cookie, id)).toEqual(['Bread', 'Curry']);
    expect(await listed(t, reader.cookie)).toEqual(['Weeknight (2)']);
    // In order, the two it shows take the places they had, around the one it doesn't.
    const order = await send(t, reader.cookie, 'PUT', `/collections/${id}/order`, {
      recipeIds: [curry, bread],
    });
    expect(order.status).toBe(204);
    setTheirs({ visibility: 'shared', deletedAt: new Date() });
    expect(await shown(t, reader.cookie, id)).toEqual(['Curry', 'Bread']);

    setTheirs({ deletedAt: null });
    expect(await shown(t, reader.cookie, id)).toEqual(['Curry', 'Their Stew', 'Bread']);
  });

  it('refuse a recipe once full', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const id = await create(t, cookie, 'Everything');
    const held = t.db
      .insert(recipe)
      .values(
        Array.from({ length: COLLECTION_MAX_RECIPES }, (_, index) => ({
          ownerId: user.id,
          visibility: 'shared' as const,
          title: `Recipe ${String(index)}`,
          servings: 2,
        })),
      )
      .returning({ id: recipe.id })
      .all();
    t.db
      .insert(collectionItem)
      .values(held.map((row, index) => ({ collectionId: id, recipeId: row.id, position: index })))
      .run();

    const res = await send(
      t,
      cookie,
      'PUT',
      `/collections/${id}/recipes/${insertRecipe(t.db, user.id)}`,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      detail: `The collection is full. A collection holds at most ${String(COLLECTION_MAX_RECIPES)} recipes.`,
    });
  });
});
