import { z } from 'zod';
import { normalizeIngredientName } from './ingredients.ts';
import { DIFFICULTIES, RECIPE_LIMITS } from './recipe.ts';
import { ALLERGENS, TAG_NAME_MAX_LENGTH } from './tags.ts';
import { VISIBILITIES } from './visibility.ts';

/**
 * Where the latest rebuild of the search index stands: waiting for its turn, under way, waiting to
 * try again after a failed attempt (as while search is unavailable), done, or given up on.
 */
export const REBUILD_STATES = ['queued', 'running', 'retrying', 'succeeded', 'failed'] as const;

export type RebuildState = (typeof REBUILD_STATES)[number];

export const searchIndexStatusSchema = z
  .object({
    available: z.boolean().describe('Whether search works right now.'),
    rebuild: z
      .object({
        state: z.enum(REBUILD_STATES),
        queuedAt: z.iso.datetime().describe('When the rebuild was asked for.'),
      })
      .nullable()
      .describe('The latest rebuild, or null if there has been none.'),
  })
  .meta({ id: 'SearchIndexStatus' });

export type SearchIndexStatus = z.infer<typeof searchIndexStatusSchema>;

/** Recipes on one page of search results. Divides into rows of two, three and four. */
export const SEARCH_PAGE_SIZE = 24;

/** The deepest page a search goes to. Meilisearch counts results up to its own limit (1000). */
export const SEARCH_PAGE_MAX = Math.ceil(1000 / SEARCH_PAGE_SIZE);

/**
 * How results are ordered (spec §3.4). Relevance is the default with a query, newest without one.
 * Rating sorts by the Bayesian average once ratings exist.
 */
export const SEARCH_SORTS = ['relevance', 'rating', 'newest', 'quickest', 'slowest'] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Where a query looks: everywhere, or only in ingredient names (spec §3.4). */
export const SEARCH_SCOPES = ['all', 'ingredients'] as const;

/** Values chosen for one filter, at most. */
const FILTER_VALUES_MAX = 20;

/**
 * A query parameter that may be repeated (`?cuisine=Thai&cuisine=Italian`). Given once, it arrives
 * as a string, so it's made a list first.
 */
const listParam = <T extends z.ZodType>(item: T, description: string) =>
  z
    .preprocess(
      (value) => (value === undefined || Array.isArray(value) ? value : [value]),
      z.array(item).max(FILTER_VALUES_MAX),
    )
    .optional()
    .describe(description);

const tagName = z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH);
/** Read as recipes' ingredient names are, so "Scallions" finds "scallion". */
const ingredientName = z
  .string()
  .max(RECIPE_LIMITS.ingredientName)
  .transform(normalizeIngredientName)
  .pipe(z.string().min(1, 'Enter an ingredient.'));
const minutes = z.coerce.number().int().min(0).max(RECIPE_LIMITS.minutes);

export const recipeSearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().describe('What to look for. Typos are forgiven.'),
    in: z
      .enum(SEARCH_SCOPES)
      .default('all')
      .describe('Where to look for it: everywhere, or only in ingredient names.'),
    ingredient: listParam(
      ingredientName,
      'Recipes with all of these ingredients, or a name that means the same (scallion, green onion). Names are read as recipes’ are: "Scallions" is "scallion".',
    ),
    cuisine: listParam(tagName, 'Recipes of any of these cuisines.'),
    mealType: listParam(tagName, 'Recipes for any of these meals.'),
    diet: listParam(tagName, 'Recipes that fit all of these diets.'),
    tag: listParam(tagName, 'Recipes with all of these other tags.'),
    excludeCuisine: listParam(tagName, 'No recipes of these cuisines.'),
    excludeMealType: listParam(tagName, 'No recipes for these meals.'),
    excludeDiet: listParam(tagName, 'No recipes that fit these diets.'),
    excludeTag: listParam(tagName, 'No recipes with these other tags.'),
    excludeAllergen: listParam(z.enum(ALLERGENS), 'No recipes that contain any of these.'),
    difficulty: listParam(z.enum(DIFFICULTIES), 'Recipes of any of these difficulties.'),
    minMinutes: minutes.optional().describe('Recipes that take at least this long in all.'),
    maxMinutes: minutes.optional().describe('Recipes that take at most this long in all.'),
    sort: z
      .enum(SEARCH_SORTS)
      .optional()
      .describe('How to order them. Relevance with a query, newest without one.'),
    page: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).default(1),
  })
  .refine(
    ({ minMinutes, maxMinutes }) =>
      minMinutes === undefined || maxMinutes === undefined || minMinutes <= maxMinutes,
    { path: ['maxMinutes'], message: 'Make it at least the shortest time.' },
  );

export type RecipeSearchQuery = z.infer<typeof recipeSearchQuerySchema>;

export const recipeSearchHitSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    difficulty: z.enum(DIFFICULTIES).nullable(),
    totalMinutes: z.number().int().nullable(),
    cuisine: z.array(z.string()),
    mealType: z.array(z.string()),
    diet: z.array(z.string()),
    tags: z.array(z.string()).describe('Its other tags.'),
    allergens: z.array(z.enum(ALLERGENS)),
    visibility: z.enum(VISIBILITIES),
  })
  .meta({ id: 'RecipeSearchHit' });

export type RecipeSearchHit = z.infer<typeof recipeSearchHitSchema>;

/** The filters results can be counted by: each value's number of recipes. */
export const SEARCH_FACETS = [
  'cuisine',
  'mealType',
  'diet',
  'tag',
  'allergen',
  'difficulty',
] as const;

export type SearchFacet = (typeof SEARCH_FACETS)[number];

const counts = z.record(z.string(), z.number().int());

export const recipeSearchResultSchema = z
  .object({
    hits: z.array(recipeSearchHitSchema),
    totalHits: z.number().int().describe('How many recipes match, across every page.'),
    page: z.number().int(),
    totalPages: z.number().int(),
    facets: z
      .object(
        Object.fromEntries(SEARCH_FACETS.map((facet) => [facet, counts])) as Record<
          SearchFacet,
          typeof counts
        >,
      )
      .describe(
        "How many recipes each filter value would give. A filter that takes any of its values (cuisine, meal, difficulty) is counted without its own choices, so its other values' counts say what adding them would give.",
      ),
  })
  .meta({ id: 'RecipeSearchResult' });

export type RecipeSearchResult = z.infer<typeof recipeSearchResultSchema>;

/** Ingredient suggestions at most, the most used first. */
export const INGREDIENT_SUGGESTIONS_MAX = 10;

export const ingredientSuggestionQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(RECIPE_LIMITS.ingredientName)
    .default('')
    .describe('The start of an ingredient name. Typos are forgiven. Empty for the most used.'),
});

export const ingredientSuggestionsSchema = z
  .object({
    ingredients: z.array(
      z.object({
        name: z
          .string()
          .describe('As recipes’ ingredient names are read, for the `ingredient` filter.'),
        recipes: z.number().int().describe('How many recipes the caller may see use it.'),
      }),
    ),
  })
  .meta({ id: 'IngredientSuggestions' });

export type IngredientSuggestions = z.infer<typeof ingredientSuggestionsSchema>;
