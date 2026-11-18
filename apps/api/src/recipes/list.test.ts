import {
  type CreateRecipeRequest,
  can,
  RECIPES_PER_PAGE,
  type Role,
  recipeListSchema,
  validationProblemSchema,
} from '@myli/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recipe, tag } from '../db/schema.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { createRecipe } from './recipes.ts';
import { sampleRecipeRequest } from './testing.ts';

async function setUp(role: Role = 'editor') {
  const t = createTestApp();
  const { user, cookie } = await signedInAs(t, role);
  const get = (query = '') => t.app.request(`/api/v1/recipes${query}`, { headers: { cookie } });
  const list = async (query = '') => {
    const res = await get(query);
    expect(res.status).toBe(200);
    return recipeListSchema.parse(await res.json());
  };
  return { t, user, get, list };
}

/** A recipe of `ownerId`'s, created `minutesAgo` minutes ago, so the list's order is known. */
function recipeOf(
  t: TestApp,
  ownerId: string,
  { minutesAgo = 0, ...request }: Partial<CreateRecipeRequest> & { minutesAgo?: number } = {},
) {
  const saved = createRecipe(t.db, ownerId, sampleRecipeRequest(request));
  if (!saved.ok) throw new Error('the recipe could not be saved');
  t.db
    .update(recipe)
    .set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) })
    .where(eq(recipe.id, saved.id))
    .run();
  return saved.id;
}

const deleteRow = (t: TestApp, id: string) =>
  t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, id)).run();

describe('GET /recipes', () => {
  it('lists shared recipes and the caller’s own private ones, newest first', async () => {
    const { t, user, list } = await setUp();
    const { user: other } = await signedInAs(t, 'editor');
    recipeOf(t, user.id, { title: 'Mine, private', visibility: 'private', minutesAgo: 10 });
    recipeOf(t, other.id, { title: 'Theirs, shared', minutesAgo: 5 });
    recipeOf(t, other.id, { title: 'Theirs, private', visibility: 'private', minutesAgo: 3 });
    deleteRow(t, recipeOf(t, other.id, { title: 'Theirs, deleted', minutesAgo: 1 }));
    recipeOf(t, user.id, { title: 'Mine, shared' });

    const { recipes, total, page, totalPages } = await list();

    expect(recipes.map(({ title }) => title)).toEqual([
      'Mine, shared',
      'Theirs, shared',
      'Mine, private',
    ]);
    expect({ total, page, totalPages }).toEqual({ total: 3, page: 1, totalPages: 1 });
  });

  it.each<Role>(['admin', 'editor', 'viewer'])(
    'lists exactly the recipes the policy lets the %s read',
    async (role) => {
      const { t, user, list } = await setUp(role);
      const { user: other } = await signedInAs(t, 'editor');
      for (const ownerId of [user.id, other.id]) {
        for (const visibility of ['private', 'shared'] as const) {
          recipeOf(t, ownerId, { visibility });
          deleteRow(t, recipeOf(t, ownerId, { visibility }));
        }
      }
      const readable = t.db
        .select({ id: recipe.id, ownerId: recipe.ownerId, visibility: recipe.visibility })
        .from(recipe)
        .where(isNull(recipe.deletedAt))
        .all()
        .filter((row) => can(user, 'recipe.read', row))
        .map(({ id }) => id);

      const { recipes, total } = await list();

      expect(recipes.map(({ id }) => id).sort()).toEqual(readable.sort());
      // Counted in SQL: a condition looser than the policy would show here.
      expect(total).toBe(readable.length);
      // Their own two, and the other's shared one.
      expect(readable).toHaveLength(3);
    },
  );

  it('shows each recipe as its card does, with its tags by type', async () => {
    const { t, user, list } = await setUp();
    const tagId = (type: 'allergen', name: string) =>
      t.db
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.type, type), eq(tag.name, name)))
        .get()?.id ?? 0;
    const added = (type: 'cuisine' | 'meal_type' | 'diet' | 'custom', name: string) =>
      t.db.insert(tag).values({ type, name, nameKey: name.toLowerCase() }).returning().get().id;
    const id = recipeOf(t, user.id, {
      visibility: 'private',
      tagIds: [
        added('custom', 'Weeknight'),
        added('cuisine', 'Italian'),
        added('cuisine', 'French'),
        added('diet', 'Vegetarian'),
        added('meal_type', 'Dinner'),
        tagId('allergen', 'wheat'),
        tagId('allergen', 'milk'),
      ],
    });

    expect((await list()).recipes).toEqual([
      {
        id,
        title: 'Weeknight Bread',
        difficulty: 'easy',
        totalMinutes: 180,
        cuisine: ['French', 'Italian'],
        mealType: ['Dinner'],
        diet: ['Vegetarian'],
        tags: ['Weeknight'],
        allergens: ['milk', 'wheat'],
        visibility: 'private',
        cover: null,
      },
    ]);
  });

  it('shows each recipe’s cover photo', async () => {
    const { t, user, list } = await setUp();
    const withCover = recipeOf(t, user.id);
    const without = recipeOf(t, user.id, { minutesAgo: 1 });
    const cover = await insertRecipeImage(t, withCover);
    await insertRecipeImage(t, withCover);
    t.db.update(recipe).set({ coverImageId: cover }).where(eq(recipe.id, withCover)).run();

    expect((await list()).recipes.map(({ id, cover }) => [id, cover])).toEqual([
      [withCover, { id: cover, width: 64, height: 48, variants: [{ width: 64, height: 48 }] }],
      [without, null],
    ]);
  });

  it(`gives ${String(RECIPES_PER_PAGE)} recipes a page`, async () => {
    const { t, user, list } = await setUp();
    for (let n = 0; n <= RECIPES_PER_PAGE; n++) {
      recipeOf(t, user.id, { title: `Recipe ${String(n)}`, minutesAgo: n });
    }

    const first = await list();
    const second = await list('?page=2');
    const beyond = await list('?page=3');

    expect(first.recipes).toHaveLength(RECIPES_PER_PAGE);
    expect(first.recipes[0]?.title).toBe('Recipe 0');
    expect(second.recipes.map(({ title }) => title)).toEqual([
      `Recipe ${String(RECIPES_PER_PAGE)}`,
    ]);
    expect(beyond.recipes).toEqual([]);
    for (const { total, totalPages } of [first, second, beyond]) {
      expect({ total, totalPages }).toEqual({ total: RECIPES_PER_PAGE + 1, totalPages: 2 });
    }
  });

  it('refuses a page that isn’t a whole number from 1', async () => {
    const { get } = await setUp();

    for (const page of ['0', 'two', '1.5']) {
      const res = await get(`?page=${page}`);
      expect(res.status).toBe(422);
      expect(validationProblemSchema.parse(await res.json()).errors).toMatchObject([
        { pointer: '#/page' },
      ]);
    }
  });
});
