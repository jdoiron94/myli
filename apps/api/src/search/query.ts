import {
  can,
  INGREDIENT_SUGGESTIONS_MAX,
  type IngredientSuggestions,
  type PolicyUser,
  RECIPES_PER_PAGE,
  type RecipeSearchQuery,
  type RecipeSearchResult,
  type RecipeSummary,
  SEARCH_FACETS,
  type SearchFacet,
} from '@myli/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  MeilisearchRequestError,
  MeilisearchRequestTimeOutError,
  type MultiSearchParams,
  type MultiSearchQuery,
  type MultiSearchResponse,
  type SearchForFacetValuesParams,
  type SearchForFacetValuesResponse,
} from 'meilisearch';
import type { Db } from '../db/database.ts';
import { recipe, recipeIngredient } from '../db/schema.ts';
import { coversOf } from '../images/images.ts';
import type { Logger } from '../logger.ts';
import { HttpProblem } from '../problems.ts';
import { ratingSummaries, summaryOf } from '../ratings/ratings.ts';
import type { RecipeSearchDocument } from './document.ts';
import { RECIPES_INDEX, synonymGroup } from './settings.ts';
import { isMeilisearchError } from './setup.ts';

/** What searching needs from Meilisearch. The API's client has it; tests can stand in for it. */
export interface SearchClient {
  multiSearch(params: MultiSearchParams): Promise<MultiSearchResponse>;
  index(uid: string): {
    searchForFacetValues(params: SearchForFacetValuesParams): Promise<SearchForFacetValuesResponse>;
  };
}

export const SEARCH_UNAVAILABLE =
  'Search is unavailable right now. Everything else works: try searching again in a few minutes.';

type Attribute = keyof RecipeSearchDocument;

/** The document attribute each facet counts. */
const FACET_ATTRIBUTES = {
  cuisine: 'cuisine',
  mealType: 'mealType',
  diet: 'diet',
  tag: 'customTags',
  allergen: 'allergens',
  difficulty: 'difficulty',
} as const satisfies Record<SearchFacet, Attribute>;

/**
 * Filters that take any of their values (spec §3.4): a recipe has one cuisine, so asking for two
 * means either. Each is counted without its own choices, so its counts say what adding a value
 * would give ("disjunctive" facets). The others take all of their values.
 */
const ANY_OF = ['cuisine', 'mealType', 'difficulty'] as const satisfies SearchFacet[];
type AnyOfFacet = (typeof ANY_OF)[number];

/** A value in a Meilisearch filter, quoted, so a tag name can't change the filter's meaning. */
export const quote = (value: string) => `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;

const list = (values: readonly string[]) => `[${values.map(quote).join(', ')}]`;

/** What every query is limited to: recipes the caller may see (spec §4). */
export const accessFilter = (userId: string) =>
  `deleted = false AND (visibility = "shared" OR ownerId = ${quote(userId)})`;

/**
 * The query's filters, as Meilisearch's list form (each entry must hold), with the access filter
 * first. `without` leaves out one any-of filter's choices, to count its values.
 */
export function searchFilter(
  query: RecipeSearchQuery,
  userId: string,
  without?: AnyOfFacet,
): string[] {
  const filters = [accessFilter(userId)];
  const anyOf = (facet: AnyOfFacet, values: readonly string[] | undefined) => {
    if (facet !== without && values?.length) {
      filters.push(`${FACET_ATTRIBUTES[facet]} IN ${list(values)}`);
    }
  };
  const allOf = (attribute: Attribute, values: readonly string[] | undefined) => {
    for (const value of values ?? []) filters.push(`${attribute} = ${quote(value)}`);
  };
  const noneOf = (attribute: Attribute, values: readonly string[] | undefined) => {
    if (values?.length) filters.push(`${attribute} NOT IN ${list(values)}`);
  };

  // Every ingredient chosen, each by any name that means the same.
  for (const name of query.ingredient ?? []) {
    filters.push(`normalizedIngredientNames IN ${list(synonymGroup(name))}`);
  }
  anyOf('cuisine', query.cuisine);
  anyOf('mealType', query.mealType);
  anyOf('difficulty', query.difficulty);
  allOf('diet', query.diet);
  allOf('customTags', query.tag);
  noneOf('cuisine', query.excludeCuisine);
  noneOf('mealType', query.excludeMealType);
  noneOf('diet', query.excludeDiet);
  noneOf('customTags', query.excludeTag);
  noneOf('allergens', query.excludeAllergen);
  // A recipe without a total time matches neither bound.
  if (query.minMinutes !== undefined) filters.push(`totalMinutes >= ${String(query.minMinutes)}`);
  if (query.maxMinutes !== undefined) filters.push(`totalMinutes <= ${String(query.maxMinutes)}`);
  return filters;
}

/** How to order the results. Relevance needs a query; without one, newest first. */
export function searchSort({ q, sort }: RecipeSearchQuery): string[] | undefined {
  const chosen = sort ?? (q ? 'relevance' : 'newest');
  switch (chosen) {
    case 'relevance':
      return q ? undefined : ['publishedAt:desc'];
    case 'rating':
      return ['ratingScore:desc', 'publishedAt:desc'];
    case 'newest':
      return ['publishedAt:desc'];
    // Recipes without a total time come last either way.
    case 'quickest':
      return ['totalMinutes:asc'];
    case 'slowest':
      return ['totalMinutes:desc'];
  }
}

const HIT_ATTRIBUTES = [
  'id',
  'title',
  'difficulty',
  'totalMinutes',
  'cuisine',
  'mealType',
  'diet',
  'customTags',
  'allergens',
] satisfies Attribute[];

const isUnreachable = (error: unknown) =>
  error instanceof MeilisearchRequestError ||
  error instanceof MeilisearchRequestTimeOutError ||
  // Meilisearch lost its data; the search service sets it up again (`service.ts`).
  isMeilisearchError(error, 'index_not_found') ||
  isMeilisearchError(error, 'invalid_api_key');

interface SearchDeps {
  db: Db;
  client: SearchClient | undefined;
  logger: Logger;
}

/** Asks Meilisearch, answering 503 while it's unavailable. Other failures are left as they are. */
async function ask<T>(
  { client, logger }: SearchDeps,
  request: (client: SearchClient) => Promise<T>,
) {
  if (!client) throw new HttpProblem(503, SEARCH_UNAVAILABLE);
  try {
    return await request(client);
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    logger.warn({ err: error }, 'search is unavailable');
    throw new HttpProblem(503, SEARCH_UNAVAILABLE);
  }
}

/**
 * One page of the recipes the caller may see that match the query, with each filter value's count
 * (spec §3.4). Throws a 503 while Meilisearch can't be reached.
 */
export async function searchRecipes(
  deps: SearchDeps,
  user: PolicyUser,
  query: RecipeSearchQuery,
): Promise<RecipeSearchResult> {
  const base = {
    indexUid: RECIPES_INDEX,
    q: query.q ?? '',
    ...(query.in === 'ingredients' && { attributesToSearchOn: ['ingredientNames'] }),
  } satisfies MultiSearchQuery;
  // Any-of filters with choices are counted in queries of their own, without those choices.
  const chosenAnyOf = ANY_OF.filter((facet) => query[facet]?.length);
  const queries: MultiSearchQuery[] = [
    {
      ...base,
      filter: searchFilter(query, user.id),
      sort: searchSort(query),
      page: query.page,
      hitsPerPage: RECIPES_PER_PAGE,
      attributesToRetrieve: HIT_ATTRIBUTES,
      facets: SEARCH_FACETS.filter((facet) => !chosenAnyOf.includes(facet as AnyOfFacet)).map(
        (facet) => FACET_ATTRIBUTES[facet],
      ),
    },
    ...chosenAnyOf.map((facet) => ({
      ...base,
      filter: searchFilter(query, user.id, facet),
      hitsPerPage: 0,
      facets: [FACET_ATTRIBUTES[facet]],
    })),
  ];

  const { results } = await ask(deps, (client) => client.multiSearch({ queries }));

  const [main, ...counted] = results;
  const distribution = Object.assign(
    {},
    main?.facetDistribution,
    ...counted.map((result) => result.facetDistribution),
  ) as Partial<Record<Attribute, Record<string, number>>>;
  const facets = Object.fromEntries(
    SEARCH_FACETS.map((facet) => [facet, distribution[FACET_ATTRIBUTES[facet]] ?? {}]),
  ) as RecipeSearchResult['facets'];

  const found = (main?.hits ?? []) as SearchedRecipe[];
  const hits = visibleHits(deps.db, user, found);
  // What SQLite left out isn't counted either, so the count matches what's shown, as just after
  // a recipe was deleted. Other pages can still be behind; the facet counts are left as they are.
  const totalHits = Math.max((main?.totalHits ?? 0) - (found.length - hits.length), 0);
  return {
    hits,
    totalHits,
    page: main?.page ?? query.page,
    totalPages: Math.ceil(totalHits / RECIPES_PER_PAGE),
    facets,
  };
}

type SearchedRecipe = Pick<RecipeSearchDocument, (typeof HIT_ATTRIBUTES)[number]>;

/**
 * The hits the caller may still see, as SQLite holds them now. The index can be behind, as while
 * an update waits to be retried: a recipe made private since must not show to anyone else.
 */
function visibleHits(db: Db, user: PolicyUser, hits: SearchedRecipe[]): RecipeSummary[] {
  if (hits.length === 0) return [];
  const rows = db
    .select({ id: recipe.id, ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(
      and(
        inArray(
          recipe.id,
          hits.map(({ id }) => id),
        ),
        isNull(recipe.deletedAt),
      ),
    )
    .all();
  const current = new Map(rows.map((row) => [row.id, row]));
  const ids = rows.map(({ id }) => id);
  const covers = coversOf(db, ids);
  const ratings = ratingSummaries(db, ids);
  return hits.flatMap((hit) => {
    const row = current.get(hit.id);
    if (!row || !can(user, 'recipe.read', row)) return [];
    return [
      {
        id: hit.id,
        title: hit.title,
        difficulty: hit.difficulty,
        totalMinutes: hit.totalMinutes,
        cuisine: hit.cuisine,
        mealType: hit.mealType,
        diet: hit.diet,
        tags: hit.customTags,
        allergens: hit.allergens as RecipeSummary['allergens'],
        visibility: row.visibility,
        cover: covers.get(hit.id) ?? null,
        rating: summaryOf(ratings, hit.id),
      },
    ];
  });
}

/**
 * The ingredient names recipes the caller may see use, with a word starting like `q` (or the most
 * used, for an empty one), for picking ingredients to search by (spec §3.4), most used first.
 *
 * Meilisearch's facet search matches only the start of a name, typos forgiven: "bre" finds "bread
 * flour", but "flour" doesn't. So a search on ingredient names finds the recipes with a word like
 * `q`, and their names with a word that starts with it are added, with the counts the search gives:
 * exact, since every recipe with "bread flour" matches "flour". It counts the 100 names most used
 * in those recipes (Meilisearch's `maxValuesPerFacet`), which a large instance could pass.
 */
export async function suggestIngredients(
  deps: SearchDeps,
  user: PolicyUser,
  q: string,
): Promise<IngredientSuggestions['ingredients']> {
  const facet = 'normalizedIngredientNames' satisfies Attribute;
  const filter = accessFilter(user.id);
  const term = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const [{ facetHits }, inside] = await ask(deps, (client) =>
    Promise.all([
      client.index(RECIPES_INDEX).searchForFacetValues({ facetName: facet, facetQuery: q, filter }),
      term
        ? client.multiSearch({
            queries: [
              {
                indexUid: RECIPES_INDEX,
                q: term,
                // As written: the normalized names are only for filtering and counting.
                attributesToSearchOn: ['ingredientNames' satisfies Attribute],
                filter,
                facets: [facet],
                hitsPerPage: 0,
              },
            ],
          })
        : undefined,
    ]),
  );

  const counts = new Map(facetHits.map(({ value, count }) => [value, count]));
  for (const [value, count] of Object.entries(
    inside?.results[0]?.facetDistribution?.[facet] ?? {},
  )) {
    if (` ${value}`.includes(` ${term}`))
      counts.set(value, Math.max(counts.get(value) ?? 0, count));
  }
  const ranked = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const visible = new Set(
    visibleIngredientNames(
      deps.db,
      user,
      ranked.map(([value]) => value),
    ),
  );
  return ranked
    .filter(([value]) => visible.has(value))
    .slice(0, INGREDIENT_SUGGESTIONS_MAX)
    .map(([name, recipes]) => ({ name, recipes }));
}

/**
 * Those of `names` that a recipe the caller may see uses, as SQLite has them now. As with search
 * results, the index can be behind, and a private recipe's ingredients must not show.
 */
function visibleIngredientNames(db: Db, user: PolicyUser, names: string[]): string[] {
  if (names.length === 0) return [];
  const rows = db
    .selectDistinct({
      name: recipeIngredient.normalizedName,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
    })
    .from(recipeIngredient)
    .innerJoin(recipe, eq(recipe.id, recipeIngredient.recipeId))
    .where(and(inArray(recipeIngredient.normalizedName, names), isNull(recipe.deletedAt)))
    .all();
  return rows.filter((row) => can(user, 'recipe.read', row)).map(({ name }) => name);
}
