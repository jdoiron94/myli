import type { Visibility } from '@myli/shared';

/**
 * One recipe in the search index, built from its published version (spec §4). Recipes and their
 * indexing arrive in Phase 1. The index settings are typed against this, so they can't name a
 * field that doesn't exist.
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
