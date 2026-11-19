import {
  type CreateRecipeRequest,
  type UpdateRecipeRequest,
  type Visibility,
  versionETag,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { recipe } from '../db/schema.ts';
import { createRecipe } from './recipes.ts';

/** A complete, valid request to save a recipe. Override any part of it. */
export function sampleRecipeContent(
  overrides: Partial<UpdateRecipeRequest> = {},
): UpdateRecipeRequest {
  return {
    title: 'Weeknight Bread',
    description: 'A *simple* loaf.',
    source: { url: 'https://example.com/bread', title: 'Example Bakes', author: 'A. Baker' },
    equipment: ['Loaf pan', 'Stand mixer'],
    yield: { qty: 1, unit: 'loaf' },
    servings: 8,
    prepMinutes: 20,
    cookMinutes: 40,
    totalMinutes: 180,
    difficulty: 'easy',
    nutrition: {
      calories: 210,
      proteinGrams: 6,
      carbsGrams: 40,
      fatGrams: 2.5,
      fiberGrams: null,
      sugarGrams: null,
      sodiumMilligrams: 380,
    },
    ingredientGroups: [
      {
        label: null,
        ingredients: [
          {
            rawText: '3 cups all-purpose flour',
            qty: 3,
            qtyMax: null,
            unit: 'cup',
            name: 'all-purpose flour',
            note: null,
            scalable: true,
          },
          {
            rawText: 'salt to taste',
            qty: null,
            qtyMax: null,
            unit: null,
            name: 'salt',
            note: 'to taste',
            scalable: false,
          },
        ],
      },
    ],
    steps: [
      { body: 'Mix everything.', image: null },
      { body: 'Bake at **400°F**.', image: null },
    ],
    tagIds: [],
    images: [],
    coverImageId: null,
    ...overrides,
  };
}

/** A complete, valid request to create a recipe: the sample content, shared. */
export function sampleRecipeRequest(
  overrides: Partial<CreateRecipeRequest> = {},
): CreateRecipeRequest {
  return { ...sampleRecipeContent(), visibility: 'shared', ...overrides };
}

/** The `If-Match` header for a recipe's current version, as a client that just loaded it sends. */
export function ifMatch(db: Db, id: string): { 'if-match': string } {
  const row = db.select({ version: recipe.version }).from(recipe).where(eq(recipe.id, id)).get();
  if (!row) throw new Error(`no recipe ${id}`);
  return { 'if-match': versionETag(row.version) };
}

/** A new recipe owned by `ownerId`, written straight to the database. Its ID. */
export function insertRecipe(db: Db, ownerId: string, visibility: Visibility = 'shared'): string {
  const saved = createRecipe(db, ownerId, sampleRecipeRequest({ visibility }));
  if (!saved.ok) throw new Error('the sample recipe could not be saved');
  return saved.id;
}
