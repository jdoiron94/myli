import { recipeTotalMinutes, type TagType, type Visibility } from '@myli/shared';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { rating, recipe, recipeIngredient, recipeStep, recipeTag, tag } from '../db/schema.ts';

/**
 * One recipe in the search index, built from its published version (spec §4). The index settings
 * are typed against this, so they can't name a field that doesn't exist.
 */
export interface RecipeSearchDocument {
  id: string;
  title: string;
  description: string;
  /** Every step's text, in order. */
  stepText: string;
  ingredientNames: string[];
  /** Lowercase and singular, for autocomplete and ingredient filters. */
  normalizedIngredientNames: string[];
  /** Tag names, one list per tag type. */
  cuisine: string[];
  mealType: string[];
  diet: string[];
  allergens: string[];
  customTags: string[];
  difficulty: 'easy' | 'medium' | 'hard' | null;
  totalMinutes: number | null;
  visibility: Visibility;
  ownerId: string;
  /** The Bayesian average of its ratings, for sorting by rating (`RATING_PRIOR`). */
  ratingScore: number;
  /** When it was first published, in milliseconds since the epoch, for sorting by newest. */
  publishedAt: number;
  deleted: boolean;
}

/**
 * Sorting by rating uses a Bayesian average (spec §3.4): a recipe's ratings, plus `RATING_WEIGHT`
 * ratings of `RATING_PRIOR` stars that every recipe starts with. So one 5-star rating doesn't
 * outrank many 4-star ones, and a recipe nobody has rated sits at 3 stars. The prior is fixed, not
 * the instance's mean, so a rating changes only its own recipe's score, and only that recipe is
 * indexed again.
 */
export const RATING_PRIOR = 3;
export const RATING_WEIGHT = 3;

const unique = (values: readonly string[]) => [...new Set(values.filter((value) => value !== ''))];

/**
 * A recipe's search document, from what SQLite holds now. `undefined` if it doesn't exist or was
 * deleted, so it's taken out of the index. The recipe's tables hold its published version; drafts
 * are kept apart.
 */
export function buildRecipeDocument(db: Db, id: string): RecipeSearchDocument | undefined {
  const row = db
    .select()
    .from(recipe)
    .where(and(eq(recipe.id, id), isNull(recipe.deletedAt)))
    .get();
  if (!row) return undefined;

  const lines = db
    .select({ name: recipeIngredient.name, normalizedName: recipeIngredient.normalizedName })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, id))
    .orderBy(asc(recipeIngredient.groupPosition), asc(recipeIngredient.position))
    .all();
  const steps = db
    .select({ body: recipeStep.bodyMd })
    .from(recipeStep)
    .where(eq(recipeStep.recipeId, id))
    .orderBy(asc(recipeStep.position))
    .all();
  const tags = db
    .select({ type: tag.type, name: tag.name })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, id))
    .orderBy(asc(tag.nameKey))
    .all();
  const named = (type: TagType) => tags.filter((t) => t.type === type).map((t) => t.name);
  const ratings = db
    .select({ stars: sql<number>`coalesce(sum(${rating.stars}), 0)`, count: count() })
    .from(rating)
    .where(eq(rating.recipeId, id))
    .get() ?? { stars: 0, count: 0 };

  return {
    id: row.id,
    title: row.title,
    description: row.descriptionMd,
    stepText: steps.map(({ body }) => body).join('\n\n'),
    ingredientNames: unique(lines.map(({ name }) => name)),
    normalizedIngredientNames: unique(lines.map(({ normalizedName }) => normalizedName)),
    cuisine: named('cuisine'),
    mealType: named('meal_type'),
    diet: named('diet'),
    allergens: named('allergen'),
    customTags: named('custom'),
    difficulty: row.difficulty,
    totalMinutes: recipeTotalMinutes({
      prepMinutes: row.prepMin,
      cookMinutes: row.cookMin,
      totalMinutes: row.totalMin,
    }),
    visibility: row.visibility,
    ownerId: row.ownerId,
    ratingScore: (ratings.stars + RATING_PRIOR * RATING_WEIGHT) / (ratings.count + RATING_WEIGHT),
    publishedAt: row.createdAt.getTime(),
    deleted: false,
  };
}
