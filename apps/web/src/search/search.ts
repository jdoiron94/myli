import { type RecipeSearchQuery, recipeSearchQuerySchema } from '@myli/shared';
import { keepPreviousData, queryOptions } from '@tanstack/vue-query';
import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import { api, responseData } from '@/api/client.ts';
import type { components } from '@/api/schema.ts';

export type SearchResult = components['schemas']['RecipeSearchResult'];

/** The parameters of a search that hold lists of values. */
const LIST_KEYS = [
  'ingredient',
  'cuisine',
  'mealType',
  'diet',
  'tag',
  'excludeCuisine',
  'excludeMealType',
  'excludeDiet',
  'excludeTag',
  'excludeAllergen',
  'difficulty',
] as const satisfies (keyof RecipeSearchQuery)[];

/**
 * The search the address describes (spec §3.4: the whole search lives in the URL). Parameters it
 * can't read are left out, so an old or hand-edited link still searches for the rest.
 */
export function searchFromQuery(query: LocationQuery): RecipeSearchQuery {
  const params = new Map<string, string | string[]>();
  for (const [key, value] of Object.entries(query)) {
    const values = (Array.isArray(value) ? value : [value]).filter((item) => item !== null);
    if (values.length > 0) params.set(key, values.length === 1 ? (values[0] ?? '') : values);
  }
  // Each pass drops what the last couldn't read, so it ends by the time nothing's left.
  for (;;) {
    const parsed = recipeSearchQuerySchema.safeParse(Object.fromEntries(params));
    if (parsed.success) return parsed.data;
    const unreadable = parsed.error.issues
      .map(({ path }) => String(path[0]))
      .filter((key) => params.has(key));
    if (unreadable.length === 0) return recipeSearchQuerySchema.parse({});
    for (const key of unreadable) params.delete(key);
  }
}

/** The address of a search: only what differs from the defaults, so links stay short. */
export function queryFromSearch(search: Partial<RecipeSearchQuery>): LocationQueryRaw {
  const query: LocationQueryRaw = {};
  if (search.q) query.q = search.q;
  if (search.in === 'ingredients') query.in = 'ingredients';
  for (const key of LIST_KEYS) {
    const values = search[key];
    if (values?.length) query[key] = [...values];
  }
  if (search.minMinutes !== undefined) query.minMinutes = String(search.minMinutes);
  if (search.maxMinutes !== undefined) query.maxMinutes = String(search.maxMinutes);
  if (search.sort) query.sort = search.sort;
  if (search.page !== undefined && search.page > 1) query.page = String(search.page);
  return query;
}

/** Whether the search narrows anything down, beyond its order and page. */
export function narrowed(search: RecipeSearchQuery): boolean {
  return (
    Boolean(search.q) ||
    LIST_KEYS.some((key) => search[key]?.length) ||
    search.minMinutes !== undefined ||
    search.maxMinutes !== undefined
  );
}

/**
 * One page of the recipes a search finds. While another page or search loads, the last one stays,
 * so the page doesn't jump back to its loading state.
 */
export const recipeSearchQuery = (search: RecipeSearchQuery) => {
  const query = queryFromSearch(search);
  return queryOptions({
    queryKey: ['search', 'recipes', query],
    queryFn: async () =>
      responseData(await api.GET('/search/recipes', { params: { query: { ...search } } })),
    placeholderData: keepPreviousData,
  });
};

export type IngredientSuggestion =
  components['schemas']['IngredientSuggestions']['ingredients'][number];

/**
 * The ingredients recipes the reader may see use, starting like `q`, most used first. While the
 * next ones load, the last stay, so the list doesn't empty with each letter typed.
 */
export const ingredientSuggestionsQuery = (q: string) =>
  queryOptions({
    queryKey: ['search', 'ingredients', q],
    queryFn: async () =>
      responseData(await api.GET('/search/ingredients', { params: { query: { q } } })).ingredients,
    placeholderData: keepPreviousData,
  });
