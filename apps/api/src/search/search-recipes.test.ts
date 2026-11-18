import {
  ingredientSuggestionsSchema,
  PROBLEM_CONTENT_TYPE,
  RECIPES_PER_PAGE,
  recipeSearchResultSchema,
  type Visibility,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { MeilisearchApiError, MeilisearchRequestError, type MultiSearchQuery } from 'meilisearch';
import { describe, expect, it } from 'vitest';
import { recipe, recipeIngredient } from '../db/schema.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { fakeSearchClient } from './fake-client.ts';
import type { SearchClient } from './query.ts';

/**
 * A test app whose search goes to `client` (none: unavailable), with an editor signed in and every
 * log line kept.
 */
async function setUp(options: { client?: SearchClient | undefined } = {}) {
  const client = 'client' in options ? options.client : fakeSearchClient().client;
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger('info', {
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  const t = createTestApp({ logger, search: { isReady: () => Promise.resolve(true), client } });
  const { user, cookie } = await signedInAs(t, 'editor');
  const get = (path: string) => t.app.request(`/api/v1${path}`, { headers: { cookie } });
  const search = (params: string) => get(`/search/recipes${params}`);
  return { t, user, get, search, logs: lines };
}

/** A Meilisearch client whose every request fails with `error`. */
function failingClient(error: Error): SearchClient {
  return {
    multiSearch: () => Promise.reject(error),
    index: () => ({ searchForFacetValues: () => Promise.reject(error) }),
  };
}

const unreachable = () =>
  new MeilisearchRequestError('http://meilisearch:7700/multi-search', new Error('ECONNREFUSED'));

describe('GET /search/recipes', () => {
  it('asks for one page of the recipes the caller may see, with every filter’s counts', async () => {
    const { client, sent } = fakeSearchClient();
    const { user, search } = await setUp({ client });

    const res = await search('?q=soup&diet=Vegan&page=2');

    expect(res.status).toBe(200);
    expect(recipeSearchResultSchema.parse(await res.json())).toEqual({
      hits: [],
      totalHits: 0,
      page: 2,
      totalPages: 0,
      facets: { cuisine: {}, mealType: {}, diet: {}, tag: {}, allergen: {}, difficulty: {} },
    });
    expect(sent).toEqual([
      [
        expect.objectContaining({
          indexUid: 'recipes',
          q: 'soup',
          filter: [
            `deleted = false AND (visibility = "shared" OR ownerId = "${user.id}")`,
            'diet = "Vegan"',
          ],
          page: 2,
          hitsPerPage: 24,
          facets: ['cuisine', 'mealType', 'diet', 'customTags', 'allergens', 'difficulty'],
        }) as MultiSearchQuery,
      ],
    ]);
    expect(sent[0]?.[0]).not.toHaveProperty('attributesToSearchOn');
  });

  it('looks only in ingredient names when asked to', async () => {
    const { client, sent } = fakeSearchClient();
    const { search } = await setUp({ client });

    expect((await search('?q=basil&in=ingredients')).status).toBe(200);

    expect(sent[0]?.[0]).toMatchObject({ q: 'basil', attributesToSearchOn: ['ingredientNames'] });
  });

  it('counts an any-of filter’s values without its own choices, in a query of their own', async () => {
    const { client, sent } = fakeSearchClient({
      search: (query) => ({
        indexUid: query.indexUid,
        query: '',
        processingTimeMs: 0,
        hits: [],
        totalHits: 3,
        hitsPerPage: query.hitsPerPage ?? 0,
        page: 1,
        totalPages: 1,
        facetDistribution: Object.fromEntries(
          (query.facets ?? []).map((facet) => [
            facet,
            { [`${facet} counted ${query.facets?.length === 1 ? 'alone' : 'with the rest'}`]: 1 },
          ]),
        ),
      }),
    });
    const { search } = await setUp({ client });

    const res = await search('?cuisine=Thai&cuisine=Italian&difficulty=easy');

    const [main, cuisines, difficulties] = sent[0] ?? [];
    expect(main?.facets).toEqual(['mealType', 'diet', 'customTags', 'allergens']);
    expect(main?.filter).toContain('cuisine IN ["Thai", "Italian"]');
    expect(cuisines).toMatchObject({ facets: ['cuisine'], hitsPerPage: 0 });
    expect(cuisines?.filter).not.toContain('cuisine IN ["Thai", "Italian"]');
    expect(cuisines?.filter).toContain('difficulty IN ["easy"]');
    expect(difficulties).toMatchObject({ facets: ['difficulty'], hitsPerPage: 0 });
    expect(difficulties?.filter).toContain('cuisine IN ["Thai", "Italian"]');
    expect(difficulties?.filter).not.toContain('difficulty IN ["easy"]');
    expect(recipeSearchResultSchema.parse(await res.json()).facets).toEqual({
      cuisine: { 'cuisine counted alone': 1 },
      mealType: { 'mealType counted with the rest': 1 },
      diet: { 'diet counted with the rest': 1 },
      tag: { 'customTags counted with the rest': 1 },
      allergen: { 'allergens counted with the rest': 1 },
      difficulty: { 'difficulty counted alone': 1 },
    });
  });

  it('shows only hits the caller may still see, as SQLite has them, should the index be behind', async () => {
    const hitsFor: string[] = [];
    const { client } = fakeSearchClient({
      search: (query) => ({
        indexUid: query.indexUid,
        query: '',
        processingTimeMs: 0,
        // Everything the stale index still has as shared.
        hits: hitsFor.map((id) => ({
          id,
          title: `Recipe ${id}`,
          difficulty: null,
          totalMinutes: null,
          cuisine: [],
          mealType: [],
          diet: [],
          customTags: [],
          allergens: [],
        })),
        totalHits: hitsFor.length,
        hitsPerPage: 24,
        page: 1,
        totalPages: 1,
        facetDistribution: {},
      }),
    });
    const { t, user, search } = await setUp({ client });
    const { user: other } = await signedInAs(t, 'editor');
    const shared = insertRecipe(t.db, other.id, 'shared');
    const madePrivate = insertRecipe(t.db, other.id, 'private');
    const mine = insertRecipe(t.db, user.id, 'private');
    const deleted = insertRecipe(t.db, other.id, 'shared');
    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, deleted)).run();
    hitsFor.push(shared, madePrivate, mine, deleted, 'never-existed');

    const { hits, totalHits, totalPages } = recipeSearchResultSchema.parse(
      await (await search('')).json(),
    );

    expect(hits.map(({ id, visibility }) => [id, visibility])).toEqual([
      [shared, 'shared'],
      [mine, 'private'],
    ]);
    // Nor are the others counted, so the count matches what's shown.
    expect({ totalHits, totalPages }).toEqual({ totalHits: 2, totalPages: 1 });
  });

  it('shows each hit’s cover photo, which the index doesn’t hold, from SQLite', async () => {
    const hitsFor: string[] = [];
    const { client } = fakeSearchClient({
      search: (query) => ({
        indexUid: query.indexUid,
        query: '',
        processingTimeMs: 0,
        hits: hitsFor.map((id) => ({
          id,
          title: `Recipe ${id}`,
          difficulty: null,
          totalMinutes: null,
          cuisine: [],
          mealType: [],
          diet: [],
          customTags: [],
          allergens: [],
        })),
        totalHits: hitsFor.length,
        hitsPerPage: 24,
        page: 1,
        totalPages: 1,
        facetDistribution: {},
      }),
    });
    const { t, user, search } = await setUp({ client });
    const withCover = insertRecipe(t.db, user.id, 'shared');
    const without = insertRecipe(t.db, user.id, 'shared');
    const cover = await insertRecipeImage(t, withCover);
    t.db.update(recipe).set({ coverImageId: cover }).where(eq(recipe.id, withCover)).run();
    hitsFor.push(withCover, without);

    const { hits } = recipeSearchResultSchema.parse(await (await search('')).json());

    expect(hits.map(({ id, cover }) => [id, cover?.id ?? null])).toEqual([
      [withCover, cover],
      [without, null],
    ]);
  });

  it('counts pages without the hits SQLite leaves out', async () => {
    const page = (number: number, ids: string[], totalHits: number) => ({
      hits: ids.map((id) => ({
        id,
        title: `Recipe ${id}`,
        difficulty: null,
        totalMinutes: null,
        cuisine: [],
        mealType: [],
        diet: [],
        customTags: [],
        allergens: [],
      })),
      totalHits,
      hitsPerPage: RECIPES_PER_PAGE,
      page: number,
      totalPages: Math.ceil(totalHits / RECIPES_PER_PAGE),
    });
    let answer = page(1, [], 0);
    const { client } = fakeSearchClient({
      search: (query) => ({
        indexUid: query.indexUid,
        query: '',
        processingTimeMs: 0,
        facetDistribution: {},
        ...answer,
      }),
    });
    const { t, user, search } = await setUp({ client });
    const kept = insertRecipe(t.db, user.id, 'shared');
    const gone = insertRecipe(t.db, user.id, 'shared');
    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, gone)).run();
    const result = async (query: string) => {
      const { totalHits, page, totalPages } = recipeSearchResultSchema.parse(
        await (await search(query)).json(),
      );
      return { totalHits, page, totalPages };
    };

    // The last hit of 25 was deleted: there's one page now, not two.
    answer = page(2, [gone], RECIPES_PER_PAGE + 1);
    expect(await result('?page=2')).toEqual({
      totalHits: RECIPES_PER_PAGE,
      page: 2,
      totalPages: 1,
    });

    answer = page(2, [kept, gone], RECIPES_PER_PAGE + 2);
    expect(await result('?page=2')).toEqual({
      totalHits: RECIPES_PER_PAGE + 1,
      page: 2,
      totalPages: 2,
    });
  });

  it('answers 503 while search is unavailable', async () => {
    const { search } = await setUp({ client: undefined });

    const res = await search('?q=soup');

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toMatchObject({
      status: 503,
      detail:
        'Search is unavailable right now. Everything else works: try searching again in a few minutes.',
    });
  });

  it('answers 503 when Meilisearch can’t be reached or lost its index, and logs why', async () => {
    const failures = [
      unreachable(),
      new MeilisearchApiError(new Response(null, { status: 404 }), {
        message: 'Index `recipes` not found.',
        code: 'index_not_found',
        type: 'invalid_request',
        link: '',
      }),
    ];
    for (const failure of failures) {
      const { search, logs } = await setUp({ client: failingClient(failure) });

      expect((await search('?q=soup')).status).toBe(503);
      expect(logs.find(({ msg }) => msg === 'search is unavailable')).toMatchObject({ level: 40 });
    }
  });

  it('answers a generic 500 for any other failure, keeping its message out of the answer', async () => {
    const failure = new MeilisearchApiError(new Response(null, { status: 400 }), {
      message: 'Attribute `secret` is not filterable.',
      code: 'invalid_search_filter',
      type: 'invalid_request',
      link: '',
    });
    const { search } = await setUp({ client: failingClient(failure) });

    const res = await search('?q=soup');

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });

  it.each([
    ['page 0', '?page=0', '#/page'],
    ['a page past the last one Meilisearch counts to', '?page=43', '#/page'],
    ['an unknown difficulty', '?difficulty=extreme', '#/difficulty/0'],
    ['an unknown allergen', '?excludeAllergen=glitter', '#/excludeAllergen/0'],
    ['an unknown sort', '?sort=alphabetical', '#/sort'],
    ['an empty tag name', '?tag=', '#/tag/0'],
    ['a shortest time over the longest', '?minMinutes=30&maxMinutes=10', '#/maxMinutes'],
    ['a time that isn’t a number', '?maxMinutes=soon', '#/maxMinutes'],
    ['too many values for one filter', `?${'cuisine=x&'.repeat(21)}`, '#/cuisine'],
  ])('refuses %s with a 422', async (_, params, field) => {
    const { search } = await setUp();

    const res = await search(params);

    expect(res.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await res.json());
    expect(errors.map(({ pointer, in: where }) => [pointer, where])).toContainEqual([
      field,
      'query',
    ]);
  });
});

describe('GET /search/ingredients', () => {
  /** A recipe of `ownerId`'s that uses exactly these ingredients. */
  function recipeUsing(t: TestApp, ownerId: string, visibility: Visibility, names: string[]) {
    const id = insertRecipe(t.db, ownerId, visibility);
    t.db.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id)).run();
    t.db
      .insert(recipeIngredient)
      .values(
        names.map((name, position) => ({
          recipeId: id,
          groupPosition: 0,
          position,
          rawText: name,
          name,
          normalizedName: name,
        })),
      )
      .run();
    return id;
  }

  it('suggests names that recipes the caller may see use, starting like the query', async () => {
    const { client, facetSearches, sent } = fakeSearchClient({
      facetSearch: () => [
        { value: 'basil', count: 3 },
        { value: 'bay leaf', count: 2 },
        { value: 'secret basil', count: 1 },
        { value: 'gone basil', count: 1 },
        { value: 'never used', count: 1 },
      ],
    });
    const { t, user, get } = await setUp({ client });
    const { user: other } = await signedInAs(t, 'editor');
    // What SQLite holds now. The index is behind on the last three.
    recipeUsing(t, other.id, 'shared', ['basil']);
    recipeUsing(t, user.id, 'private', ['bay leaf']);
    recipeUsing(t, other.id, 'private', ['secret basil']);
    const deleted = recipeUsing(t, other.id, 'shared', ['gone basil']);
    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, deleted)).run();

    const res = await get('/search/ingredients?q=ba');

    expect(res.status).toBe(200);
    expect(ingredientSuggestionsSchema.parse(await res.json())).toEqual({
      ingredients: [
        { name: 'basil', recipes: 3 },
        { name: 'bay leaf', recipes: 2 },
      ],
    });
    const filter = `deleted = false AND (visibility = "shared" OR ownerId = "${user.id}")`;
    expect(facetSearches).toEqual([
      { facetName: 'normalizedIngredientNames', facetQuery: 'ba', filter },
    ]);
    expect(sent).toEqual([
      [
        {
          indexUid: 'recipes',
          q: 'ba',
          attributesToSearchOn: ['ingredientNames'],
          filter,
          facets: ['normalizedIngredientNames'],
          hitsPerPage: 0,
        },
      ],
    ]);
  });

  it('suggests names with any word that starts like the query, most used first', async () => {
    const { client } = fakeSearchClient({
      // Facet search matches only the start of a name.
      facetSearch: () => [{ value: 'flour', count: 1 }],
      // The recipes with a word like "flour" in their ingredients, and every name they use.
      search: (query) => ({
        indexUid: query.indexUid,
        query: query.q ?? '',
        processingTimeMs: 0,
        hits: [],
        facetDistribution: {
          normalizedIngredientNames: {
            'bread flour': 2,
            salt: 3,
            cornflour: 1,
            'flour tortilla': 1,
            flour: 1,
          },
        },
        totalHits: 3,
        hitsPerPage: 0,
        page: 1,
        totalPages: 0,
      }),
    });
    const { t, user, get } = await setUp({ client });
    recipeUsing(t, user.id, 'shared', ['bread flour', 'salt']);
    recipeUsing(t, user.id, 'shared', ['bread flour', 'salt', 'cornflour']);
    recipeUsing(t, user.id, 'shared', ['flour', 'flour tortilla', 'salt']);

    const { ingredients } = ingredientSuggestionsSchema.parse(
      await (await get('/search/ingredients?q=%20Flour%20')).json(),
    );

    expect(ingredients).toEqual([
      { name: 'bread flour', recipes: 2 },
      { name: 'flour', recipes: 1 },
      { name: 'flour tortilla', recipes: 1 },
    ]);
  });

  it('suggests ten at most, and the most used with no query', async () => {
    const names = Array.from({ length: 12 }, (_, n) => `spice ${String(n).padStart(2, '0')}`);
    const { client, facetSearches, sent } = fakeSearchClient({
      facetSearch: () => names.map((value) => ({ value, count: 1 })),
    });
    const { t, user, get } = await setUp({ client });
    recipeUsing(t, user.id, 'shared', names);

    const { ingredients } = ingredientSuggestionsSchema.parse(
      await (await get('/search/ingredients')).json(),
    );

    expect(ingredients.map(({ name }) => name)).toEqual(names.slice(0, 10));
    expect(facetSearches[0]?.facetQuery).toBe('');
    // With nothing typed, there's nothing to find inside a name.
    expect(sent).toEqual([]);
  });

  it('answers 503 while search is unavailable, or can’t be reached', async () => {
    expect(
      (await (await setUp({ client: undefined })).get('/search/ingredients?q=ba')).status,
    ).toBe(503);
    const { get, logs } = await setUp({ client: failingClient(unreachable()) });
    expect((await get('/search/ingredients?q=ba')).status).toBe(503);
    expect(logs.find(({ msg }) => msg === 'search is unavailable')).toMatchObject({ level: 40 });
  });
});
