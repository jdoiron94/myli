import {
  PROBLEM_CONTENT_TYPE,
  recipeSearchResultSchema,
  validationProblemSchema,
} from '@myli/shared';
import { eq } from 'drizzle-orm';
import { MeilisearchApiError, MeilisearchRequestError, type MultiSearchQuery } from 'meilisearch';
import { describe, expect, it } from 'vitest';
import { recipe } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { createTestApp, signedInAs } from '../testing.ts';
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
  const search = (params: string) =>
    t.app.request(`/api/v1/search/recipes${params}`, { headers: { cookie } });
  return { t, user, search, logs: lines };
}

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
    const { client, sent } = fakeSearchClient((query) => ({
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
    }));
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
    const { client } = fakeSearchClient((query) => ({
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
    }));
    const { t, user, search } = await setUp({ client });
    const { user: other } = await signedInAs(t, 'editor');
    const shared = insertRecipe(t.db, other.id, 'shared');
    const madePrivate = insertRecipe(t.db, other.id, 'private');
    const mine = insertRecipe(t.db, user.id, 'private');
    const deleted = insertRecipe(t.db, other.id, 'shared');
    t.db.update(recipe).set({ deletedAt: new Date() }).where(eq(recipe.id, deleted)).run();
    hitsFor.push(shared, madePrivate, mine, deleted, 'never-existed');

    const { hits } = recipeSearchResultSchema.parse(await (await search('')).json());

    expect(hits.map(({ id, visibility }) => [id, visibility])).toEqual([
      [shared, 'shared'],
      [mine, 'private'],
    ]);
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
      new MeilisearchRequestError(
        'http://meilisearch:7700/multi-search',
        new Error('ECONNREFUSED'),
      ),
      new MeilisearchApiError(new Response(null, { status: 404 }), {
        message: 'Index `recipes` not found.',
        code: 'index_not_found',
        type: 'invalid_request',
        link: '',
      }),
    ];
    for (const failure of failures) {
      const { search, logs } = await setUp({
        client: { multiSearch: () => Promise.reject(failure) },
      });

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
    const { search } = await setUp({ client: { multiSearch: () => Promise.reject(failure) } });

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
