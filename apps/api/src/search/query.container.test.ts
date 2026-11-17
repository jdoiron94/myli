// Runs against a real Meilisearch container: `pnpm test:containers`, with Docker running.
import {
  type ALLERGENS,
  type Difficulty,
  type RecipeSearchResult,
  recipeSearchQuerySchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import type { Meilisearch } from 'meilisearch';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { recipe, tag, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { createRecipe } from '../recipes/recipes.ts';
import { sampleRecipeRequest } from '../recipes/testing.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { searchRecipes } from './query.ts';
import { rebuildRecipeIndex } from './reindex.ts';
import { setUpSearch } from './setup.ts';
import { MEILI_MASTER_KEY, meilisearchContainer, meilisearchUrl } from './testing.ts';

type Allergen = (typeof ALLERGENS)[number];

const QUOTED_TAG = 'Grandma\'s "best" \\ picks';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-17T12:00:00Z');

let container: StartedTestContainer;
let client: Meilisearch;
let db: Db;
const ids = new Map<string, string>();

interface Sample {
  title: string;
  owner?: string;
  visibility?: 'shared' | 'private';
  cuisine?: string[];
  meal?: string[];
  diet?: string[];
  tags?: string[];
  allergens?: Allergen[];
  difficulty?: Difficulty;
  minutes?: number | null;
  ingredients?: string[];
  daysAgo: number;
}

function add(sample: Sample) {
  const userTags = [
    ...(sample.cuisine ?? []).map((name) => findOrCreateTag(db, 'cuisine', name)),
    ...(sample.meal ?? []).map((name) => findOrCreateTag(db, 'meal_type', name)),
    ...(sample.diet ?? []).map((name) => findOrCreateTag(db, 'diet', name)),
    ...(sample.tags ?? []).map((name) => findOrCreateTag(db, 'custom', name)),
  ].map((found) => found.tag.id);
  const allergenTags = (sample.allergens ?? []).map((name) => {
    const row = db.select({ id: tag.id }).from(tag).where(eq(tag.name, name)).get();
    if (!row) throw new Error(`no allergen ${name}`);
    return row.id;
  });
  const saved = createRecipe(
    db,
    sample.owner ?? 'other',
    sampleRecipeRequest({
      title: sample.title,
      visibility: sample.visibility ?? 'shared',
      difficulty: sample.difficulty ?? 'easy',
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: sample.minutes ?? null,
      tagIds: [...userTags, ...allergenTags],
      ingredientGroups: [
        {
          label: null,
          ingredients: (sample.ingredients ?? ['water']).map((name) => ({
            rawText: name,
            qty: null,
            qtyMax: null,
            unit: null,
            name,
            note: null,
            scalable: false,
          })),
        },
      ],
    }),
  );
  if (!saved.ok) throw new Error(`could not save ${sample.title}`);
  // Created a known time ago, for sorting by newest.
  db.update(recipe)
    .set({ createdAt: new Date(NOW - sample.daysAgo * DAY_MS) })
    .where(eq(recipe.id, saved.id))
    .run();
  ids.set(sample.title, saved.id);
}

beforeAll(async () => {
  container = await meilisearchContainer().start();
  client = await setUpSearch({ url: meilisearchUrl(container), masterKey: MEILI_MASTER_KEY });
  db = createTestDatabase();
  for (const id of ['me', 'other', 'pager']) {
    db.insert(user)
      .values({ id, name: id, email: `${id}@example.com` })
      .run();
  }
  add({
    title: 'Green Curry',
    cuisine: ['Thai'],
    meal: ['Dinner'],
    diet: ['Vegan'],
    tags: ['Weeknight'],
    difficulty: 'medium',
    minutes: 40,
    ingredients: ['coconut milk', 'green onion', 'basil'],
    daysAgo: 1,
  });
  add({
    title: 'Pad Thai',
    cuisine: ['Thai'],
    meal: ['Dinner'],
    allergens: ['peanuts', 'eggs'],
    difficulty: 'medium',
    minutes: 30,
    ingredients: ['rice noodles', 'peanut', 'lime'],
    daysAgo: 2,
  });
  add({
    title: 'Margherita Pizza',
    cuisine: ['Italian'],
    meal: ['Dinner'],
    diet: ['Vegetarian'],
    tags: ['Weeknight', 'Party'],
    allergens: ['milk', 'wheat'],
    difficulty: 'hard',
    minutes: 90,
    ingredients: ['flour', 'mozzarella', 'basil'],
    daysAgo: 3,
  });
  add({
    title: 'Cardamom Buns',
    cuisine: ['Swedish'],
    meal: ['Breakfast'],
    diet: ['Vegetarian'],
    allergens: ['milk', 'wheat', 'eggs'],
    difficulty: 'hard',
    minutes: null,
    ingredients: ['flour', 'cardamom', 'butter'],
    daysAgo: 4,
  });
  add({
    title: 'Overnight Oats',
    owner: 'me',
    visibility: 'private',
    meal: ['Breakfast'],
    diet: ['Vegan'],
    minutes: 5,
    ingredients: ['oats', 'oat milk'],
    daysAgo: 5,
  });
  add({
    title: 'Secret Stew',
    visibility: 'private',
    cuisine: ['Thai'],
    meal: ['Dinner'],
    minutes: 60,
    ingredients: ['basil'],
    daysAgo: 0,
  });
  add({
    title: 'Garden Salad',
    meal: ['Side'],
    tags: [QUOTED_TAG],
    minutes: 10,
    ingredients: ['lettuce'],
    daysAgo: 6,
  });
  // Enough for two pages, seen only by their owner.
  for (let n = 1; n <= 30; n++) {
    add({
      title: `Paging ${String(n)}`,
      owner: 'pager',
      visibility: 'private',
      cuisine: ['Paging'],
      daysAgo: 10 + n,
    });
  }
  await rebuildRecipeIndex(db, client);
});

afterAll(async () => {
  await container.stop();
});

async function search(params: Record<string, unknown>, as = 'me'): Promise<RecipeSearchResult> {
  return searchRecipes(
    { db, client, logger: createLogger('fatal', { write: () => undefined }) },
    { id: as, role: 'editor' },
    recipeSearchQuerySchema.parse(params),
  );
}

const titles = async (params: Record<string, unknown>, as?: string) =>
  (await search(params, as)).hits.map(({ title }) => title);
const sortedTitles = async (params: Record<string, unknown>, as?: string) =>
  (await titles(params, as)).sort();

describe('who sees what', () => {
  it('finds shared recipes and the caller’s own private ones, never someone else’s', async () => {
    expect(await titles({})).toEqual([
      'Green Curry',
      'Pad Thai',
      'Margherita Pizza',
      'Cardamom Buns',
      'Overnight Oats',
      'Garden Salad',
    ]);
    expect(await titles({ q: 'stew' })).toEqual([]);
    expect(await sortedTitles({ mealType: 'Dinner' }, 'other')).toEqual([
      'Green Curry',
      'Margherita Pizza',
      'Pad Thai',
      'Secret Stew',
    ]);
    expect(await titles({ q: 'oats' }, 'other')).toEqual([]);
  });
});

describe('text search', () => {
  it('forgives typos, and looks in tag names and ingredients too', async () => {
    expect(await titles({ q: 'cardamon' })).toEqual(['Cardamom Buns']);
    expect(await titles({ q: 'swedish' })).toEqual(['Cardamom Buns']);
    expect(await sortedTitles({ q: 'mozzarella' })).toEqual(['Margherita Pizza']);
  });

  it('looks only in ingredient names when asked to', async () => {
    expect(await sortedTitles({ q: 'basil', in: 'ingredients' })).toEqual([
      'Green Curry',
      'Margherita Pizza',
    ]);
    expect(await titles({ q: 'curry', in: 'ingredients' })).toEqual([]);
  });
});

describe('filters', () => {
  it('takes any of the cuisines chosen', async () => {
    expect(await sortedTitles({ cuisine: ['Thai', 'Italian'] })).toEqual([
      'Green Curry',
      'Margherita Pizza',
      'Pad Thai',
    ]);
  });

  it('takes all of the diets and other tags chosen', async () => {
    expect(await sortedTitles({ diet: 'Vegetarian' })).toEqual([
      'Cardamom Buns',
      'Margherita Pizza',
    ]);
    expect(await titles({ diet: ['Vegetarian', 'Vegan'] })).toEqual([]);
    expect(await titles({ tag: ['Weeknight', 'Party'] })).toEqual(['Margherita Pizza']);
  });

  it('leaves out what’s excluded, and recipes with any allergen excluded', async () => {
    expect(await sortedTitles({ excludeCuisine: 'Thai' })).toEqual([
      'Cardamom Buns',
      'Garden Salad',
      'Margherita Pizza',
      'Overnight Oats',
    ]);
    expect(await sortedTitles({ excludeAllergen: ['milk', 'peanuts'] })).toEqual([
      'Garden Salad',
      'Green Curry',
      'Overnight Oats',
    ]);
  });

  it('takes any of the difficulties chosen', async () => {
    expect(await sortedTitles({ difficulty: ['easy', 'hard'] })).toEqual([
      'Cardamom Buns',
      'Garden Salad',
      'Margherita Pizza',
      'Overnight Oats',
    ]);
  });

  it('bounds the total time, leaving out recipes without one', async () => {
    expect(await sortedTitles({ maxMinutes: 30 })).toEqual([
      'Garden Salad',
      'Overnight Oats',
      'Pad Thai',
    ]);
    expect(await sortedTitles({ minMinutes: 40, maxMinutes: 90 })).toEqual([
      'Green Curry',
      'Margherita Pizza',
    ]);
  });

  it('finds a tag with quotes and a backslash in its name', async () => {
    expect(await titles({ tag: QUOTED_TAG })).toEqual(['Garden Salad']);
  });
});

describe('sorting', () => {
  it('puts the quickest or slowest first, and recipes without a time last either way', async () => {
    expect(await titles({ sort: 'quickest' })).toEqual([
      'Overnight Oats',
      'Garden Salad',
      'Pad Thai',
      'Green Curry',
      'Margherita Pizza',
      'Cardamom Buns',
    ]);
    expect(await titles({ sort: 'slowest' })).toEqual([
      'Margherita Pizza',
      'Green Curry',
      'Pad Thai',
      'Garden Salad',
      'Overnight Oats',
      'Cardamom Buns',
    ]);
  });
});

describe('counts', () => {
  it('counts each filter value among the results', async () => {
    const { facets, totalHits } = await search({});

    expect(totalHits).toBe(6);
    expect(facets.cuisine).toEqual({ Thai: 2, Italian: 1, Swedish: 1 });
    expect(facets.mealType).toEqual({ Dinner: 3, Breakfast: 2, Side: 1 });
    expect(facets.diet).toEqual({ Vegan: 2, Vegetarian: 2 });
    expect(facets.tag).toEqual({ Weeknight: 2, Party: 1, [QUOTED_TAG]: 1 });
    expect(facets.allergen).toEqual({ milk: 2, wheat: 2, eggs: 2, peanuts: 1 });
    expect(facets.difficulty).toEqual({ easy: 2, medium: 2, hard: 2 });
  });

  it('counts a cuisine chosen without itself, so the others say what adding them gives', async () => {
    const { facets, totalHits } = await search({ cuisine: 'Thai' });

    expect(totalHits).toBe(2);
    expect(facets.cuisine).toEqual({ Thai: 2, Italian: 1, Swedish: 1 });
    expect(facets.mealType).toEqual({ Dinner: 2 });
  });
});

describe('pages', () => {
  it('splits the results into pages, counting them all', async () => {
    const first = await search({ cuisine: 'Paging' }, 'pager');
    const second = await search({ cuisine: 'Paging', page: 2 }, 'pager');

    expect([first.hits.length, first.totalHits, first.totalPages, first.page]).toEqual([
      24, 30, 2, 1,
    ]);
    expect([second.hits.length, second.page]).toEqual([6, 2]);
    expect(second.hits.map(({ title }) => title)).toEqual([
      'Paging 25',
      'Paging 26',
      'Paging 27',
      'Paging 28',
      'Paging 29',
      'Paging 30',
    ]);
  });
});
