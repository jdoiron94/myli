import { recipeTotalMinutes, type TagType, type Visibility } from '@myli/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { recipe, recipeIngredient, recipeStep, recipeTag, tag } from '../db/schema.ts';

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
  /** Bayesian average of the ratings, for sorting by rating. */
  ratingScore: number;
  /** When it was first published, in milliseconds since the epoch, for sorting by newest. */
  publishedAt: number;
  deleted: boolean;
}

const unique = (values: readonly string[]) => [...new Set(values.filter((value) => value !== ''))];

/**
 * A recipe's search document, from what SQLite holds now. `undefined` if it doesn't exist or was
 * deleted, so it's taken out of the index. Until Phase 2 adds drafts, the recipe as saved is its
 * published version.
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
    // Ratings come in Phase 2; until then every recipe ranks the same.
    ratingScore: 0,
    publishedAt: row.createdAt.getTime(),
    deleted: false,
  };
}
