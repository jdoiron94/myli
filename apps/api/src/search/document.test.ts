import { ALLERGENS } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { recipe, tag, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { setRating } from '../ratings/ratings.ts';
import { createRecipe, deleteRecipe } from '../recipes/recipes.ts';
import { sampleRecipeRequest } from '../recipes/testing.ts';
import { findOrCreateTag } from '../tags/tags.ts';
import { buildRecipeDocument } from './document.ts';

let db: Db;

beforeEach(() => {
  db = createTestDatabase();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
});

function create(overrides: Parameters<typeof sampleRecipeRequest>[0] = {}) {
  const saved = createRecipe(db, 'owner', sampleRecipeRequest(overrides));
  if (!saved.ok) throw new Error('not saved');
  return saved.id;
}

const allergen = (name: (typeof ALLERGENS)[number]) => {
  const row = db.select().from(tag).where(eq(tag.name, name)).get();
  if (!row) throw new Error(`no allergen ${name}`);
  return row.id;
};

describe('buildRecipeDocument', () => {
  it('builds the document from what the recipe holds now', () => {
    const tagIds = [
      findOrCreateTag(db, 'cuisine', 'Italian').tag.id,
      findOrCreateTag(db, 'meal_type', 'Lunch').tag.id,
      findOrCreateTag(db, 'meal_type', 'Dinner').tag.id,
      findOrCreateTag(db, 'diet', 'Vegetarian').tag.id,
      findOrCreateTag(db, 'custom', 'Weeknight').tag.id,
      allergen('wheat'),
      allergen('milk'),
    ];
    const id = create({ tagIds, visibility: 'private' });
    const createdAt = db.select().from(recipe).where(eq(recipe.id, id)).get()?.createdAt;

    expect(buildRecipeDocument(db, id)).toEqual({
      id,
      title: 'Weeknight Bread',
      description: 'A *simple* loaf.',
      stepText: 'Mix everything.\n\nBake at **400°F**.',
      ingredientNames: ['all-purpose flour', 'salt'],
      normalizedIngredientNames: ['all purpose flour', 'salt'],
      cuisine: ['Italian'],
      mealType: ['Dinner', 'Lunch'],
      diet: ['Vegetarian'],
      allergens: ['milk', 'wheat'],
      customTags: ['Weeknight'],
      difficulty: 'easy',
      totalMinutes: 180,
      visibility: 'private',
      ownerId: 'owner',
      // Nobody has rated it: it sits at the prior.
      ratingScore: 3,
      publishedAt: createdAt?.getTime(),
      deleted: false,
    });
  });

  it('scores ratings with a Bayesian average: many 4-star ratings beat one 5-star rating', () => {
    for (const n of [1, 2, 3, 4]) {
      db.insert(user)
        .values({
          id: `rater-${String(n)}`,
          name: 'Rater',
          email: `rater-${String(n)}@example.com`,
        })
        .run();
    }
    const rated = (...stars: number[]) => {
      const id = create();
      stars.forEach((value, n) => {
        setRating(db, `rater-${String(n + 1)}`, id, value);
      });
      return id;
    };
    const recipes = {
      fourFours: rated(4, 4, 4, 4),
      oneFive: rated(5),
      unrated: rated(),
      oneOne: rated(1),
    };

    expect(
      Object.fromEntries(
        Object.entries(recipes).map(([name, id]) => [
          name,
          buildRecipeDocument(db, id)?.ratingScore,
        ]),
      ),
    ).toEqual({ fourFours: 25 / 7, oneFive: 3.5, unrated: 3, oneOne: 2.5 });
  });

  it('works out the total time from prep and cook when it isn’t set by hand', () => {
    const id = create({ prepMinutes: 15, cookMinutes: 30, totalMinutes: null });
    expect(buildRecipeDocument(db, id)?.totalMinutes).toBe(45);
    const none = create({ prepMinutes: null, cookMinutes: null, totalMinutes: null });
    expect(buildRecipeDocument(db, none)?.totalMinutes).toBeNull();
  });

  it('lists each ingredient name once, in the recipe’s order, across its groups', () => {
    const line = (name: string) => ({
      rawText: name,
      qty: null,
      qtyMax: null,
      unit: null,
      name,
      note: null,
      scalable: false,
    });
    const id = create({
      ingredientGroups: [
        { label: 'Dough', ingredients: [line('Eggs'), line('flour')] },
        { label: 'Filling', ingredients: [line('egg'), line('Flour'), line('')] },
      ],
    });

    const document = buildRecipeDocument(db, id);
    expect(document?.ingredientNames).toEqual(['Eggs', 'flour', 'egg', 'Flour']);
    expect(document?.normalizedIngredientNames).toEqual(['egg', 'flour']);
  });

  it('has nothing for a recipe that was deleted, or never existed', () => {
    const id = create();
    deleteRecipe(db, { actorId: 'owner', ip: null, userAgent: null }, id, 1);

    expect(buildRecipeDocument(db, id)).toBeUndefined();
    expect(buildRecipeDocument(db, 'no-such-recipe')).toBeUndefined();
  });
});
