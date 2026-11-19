import { favoriteSchema, RECIPES_PER_PAGE, recipeListSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { favorite } from '../db/schema.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';

function send(t: TestApp, method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: { cookie, ...(method !== 'GET' && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function isFavorite(t: TestApp, cookie: string, recipeId: string) {
  const res = await send(t, 'GET', `/recipes/${recipeId}/favorite`, cookie);
  expect(res.status).toBe(200);
  return favoriteSchema.parse(await res.json()).favorite;
}

async function choose(t: TestApp, cookie: string, recipeId: string, value: boolean) {
  const res = await send(t, 'PUT', `/recipes/${recipeId}/favorite`, cookie, { favorite: value });
  expect(res.status).toBe(200);
  expect(favoriteSchema.parse(await res.json())).toEqual({ favorite: value });
}

async function favorites(t: TestApp, cookie: string, page = 1) {
  const res = await send(t, 'GET', `/me/favorites?page=${String(page)}`, cookie);
  expect(res.status).toBe(200);
  return recipeListSchema.parse(await res.json());
}

describe('/recipes/{id}/favorite', () => {
  it('keeps each user’s favorites apart, and setting what it is already changes nothing', async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const other = await signedInAs(t, 'admin');
    const id = insertRecipe(t.db, other.user.id);

    expect(await isFavorite(t, cookie, id)).toBe(false);
    await choose(t, cookie, id, true);
    await choose(t, cookie, id, true);
    expect(await isFavorite(t, cookie, id)).toBe(true);
    expect(await isFavorite(t, other.cookie, id)).toBe(false);
    expect(t.db.select().from(favorite).where(eq(favorite.userId, user.id)).all()).toHaveLength(1);

    await choose(t, cookie, id, false);
    await choose(t, cookie, id, false);
    expect(await isFavorite(t, cookie, id)).toBe(false);
  });
});

describe('GET /me/favorites', () => {
  it(`lists the caller’s favorites, most recently chosen first, ${String(RECIPES_PER_PAGE)} a page`, async () => {
    const t = createTestApp();
    const { user, cookie } = await signedInAs(t, 'editor');
    const other = await signedInAs(t, 'editor');
    // Chosen a minute apart, the first one longest ago.
    const chosen = Array.from({ length: RECIPES_PER_PAGE + 1 }, (_, n) => {
      const id = insertRecipe(t.db, other.user.id);
      t.db
        .insert(favorite)
        .values({
          userId: user.id,
          recipeId: id,
          createdAt: new Date(Date.UTC(2026, 10, 18, 0, n)),
        })
        .run();
      return id;
    });
    // Someone else's favorite, and a recipe that's no one's.
    t.db
      .insert(favorite)
      .values({ userId: other.user.id, recipeId: insertRecipe(t.db, user.id) })
      .run();
    insertRecipe(t.db, user.id);

    const first = await favorites(t, cookie);
    const second = await favorites(t, cookie, 2);

    expect([...first.recipes, ...second.recipes].map(({ id }) => id)).toEqual(chosen.toReversed());
    expect(first.recipes).toHaveLength(RECIPES_PER_PAGE);
    for (const { total, totalPages } of [first, second]) {
      expect({ total, totalPages }).toEqual({ total: RECIPES_PER_PAGE + 1, totalPages: 2 });
    }
  });

  it('leaves out a favorite made private or deleted, uncounted, until it comes back', async () => {
    const t = createTestApp();
    const { cookie } = await signedInAs(t, 'editor');
    const owner = await signedInAs(t, 'editor');
    const kept = insertRecipe(t.db, owner.user.id);
    const madePrivate = insertRecipe(t.db, owner.user.id);
    const deleted = insertRecipe(t.db, owner.user.id);
    for (const id of [kept, madePrivate, deleted]) await choose(t, cookie, id, true);

    await send(t, 'PUT', `/recipes/${madePrivate}/visibility`, owner.cookie, {
      visibility: 'private',
    });
    await send(t, 'DELETE', `/recipes/${deleted}`, owner.cookie);

    const { recipes, total } = await favorites(t, cookie);
    expect(recipes.map(({ id }) => id)).toEqual([kept]);
    expect(total).toBe(1);

    await send(t, 'PUT', `/recipes/${madePrivate}/visibility`, owner.cookie, {
      visibility: 'shared',
    });
    expect((await favorites(t, cookie)).recipes.map(({ id }) => id).sort()).toEqual(
      [kept, madePrivate].sort(),
    );
  });
});
