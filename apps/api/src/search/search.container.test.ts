// Runs against real Meilisearch containers: `pnpm test:containers`, with Docker running.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Meilisearch } from 'meilisearch';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger.ts';
import { createTestApp, freePort } from '../testing.ts';
import type { RecipeSearchDocument } from './document.ts';
import { createSearchService } from './service.ts';
import { API_KEY, RECIPES_INDEX, RECIPES_SETTINGS } from './settings.ts';
import { isMeilisearchError, setUpSearch } from './setup.ts';

const IMAGE = 'getmeili/meilisearch:v1.56.1';
const MASTER_KEY = randomBytes(24).toString('base64url');

/** Containers that tests start themselves, stopped at the end. */
const started: StartedTestContainer[] = [];
afterAll(async () => {
  await Promise.all(started.map((container) => container.stop()));
});

/** Meilisearch as production runs it, on a random host port unless given one. */
function meilisearch(hostPort?: number) {
  return new GenericContainer(IMAGE)
    .withEnvironment({
      MEILI_MASTER_KEY: MASTER_KEY,
      MEILI_ENV: 'production',
      MEILI_NO_ANALYTICS: 'true',
    })
    .withExposedPorts(hostPort === undefined ? 7700 : { container: 7700, host: hostPort })
    .withWaitStrategy(Wait.forHttp('/health', 7700).forStatusCode(200));
}

const urlOf = (container: StartedTestContainer) =>
  `http://${container.getHost()}:${String(container.getMappedPort(7700))}`;

const sorted = (values: readonly string[]) => [...values].sort();

/** Settles a promise that should fail, and says whether Meilisearch refused the key. */
async function refusedKey(request: Promise<unknown>) {
  try {
    await request;
    return false;
  } catch (error) {
    return isMeilisearchError(error, 'invalid_api_key');
  }
}

function recipe(fields: Partial<RecipeSearchDocument> & Pick<RecipeSearchDocument, 'id'>) {
  return {
    title: 'Recipe',
    description: '',
    stepText: '',
    ingredientNames: [],
    normalizedIngredientNames: [],
    cuisine: [],
    mealType: [],
    diet: [],
    allergens: [],
    customTags: [],
    difficulty: null,
    totalMinutes: null,
    visibility: 'shared',
    ownerId: 'owner',
    ratingScore: 0,
    publishedAt: 0,
    deleted: false,
    ...fields,
  } satisfies RecipeSearchDocument;
}

function capturedLogger() {
  const lines: string[] = [];
  const logger = createLogger('debug', {
    write(line: string) {
      lines.push(line);
    },
  });
  return { logger, text: () => lines.join('') };
}

describe('setUpSearch', () => {
  let container: StartedTestContainer;
  let url: string;
  let master: Meilisearch;

  beforeAll(async () => {
    container = await meilisearch().start();
    url = urlOf(container);
    master = new Meilisearch({ host: url, apiKey: MASTER_KEY });
  });

  afterAll(async () => {
    await container.stop();
  });

  // Each test starts from a Meilisearch that has never seen the API.
  beforeEach(async () => {
    await master.deleteIndex(RECIPES_INDEX).waitTask();
    await master.deleteKey(API_KEY.uid).catch((error: unknown) => {
      if (!isMeilisearchError(error, 'api_key_not_found')) throw error;
    });
  });

  it('creates the API key, the recipe index and its settings', async () => {
    const client = await setUpSearch({ url, masterKey: MASTER_KEY });

    const key = await master.getKey(API_KEY.uid);
    expect(sorted(key.actions)).toEqual(sorted(API_KEY.actions));
    expect(key.indexes).toEqual(API_KEY.indexes);
    expect(key.expiresAt).toBeNull();
    expect(client.config.apiKey).toBe(key.key);

    expect(await master.getRawIndex(RECIPES_INDEX)).toMatchObject({ primaryKey: 'id' });
    const settings = await master.index(RECIPES_INDEX).getSettings();
    expect(settings.searchableAttributes).toEqual(RECIPES_SETTINGS.searchableAttributes);
    expect(sorted(settings.filterableAttributes as string[])).toEqual(
      sorted(RECIPES_SETTINGS.filterableAttributes),
    );
    expect(sorted(settings.sortableAttributes ?? [])).toEqual(
      sorted(RECIPES_SETTINGS.sortableAttributes),
    );
    expect(settings.rankingRules).toEqual(RECIPES_SETTINGS.rankingRules);
    expect(settings.synonyms).toEqual(RECIPES_SETTINGS.synonyms);
  });

  it('can run again: it keeps the key and the index and their documents', async () => {
    const first = await setUpSearch({ url, masterKey: MASTER_KEY });
    const { createdAt } = await master.getKey(API_KEY.uid);
    await first
      .index(RECIPES_INDEX)
      .addDocuments([recipe({ id: 'kept' })])
      .waitTask();

    const second = await setUpSearch({ url, masterKey: MASTER_KEY });

    expect(second.config.apiKey).toBe(first.config.apiKey);
    expect((await master.getKey(API_KEY.uid)).createdAt).toEqual(createdAt);
    expect((await master.index(RECIPES_INDEX).getStats()).numberOfDocuments).toBe(1);
  });

  it('replaces a key with its ID that grants something else', async () => {
    await master.createKey({ ...API_KEY, actions: ['*'], indexes: ['*'] });

    await setUpSearch({ url, masterKey: MASTER_KEY });

    const key = await master.getKey(API_KEY.uid);
    expect(sorted(key.actions)).toEqual(sorted(API_KEY.actions));
    expect(key.indexes).toEqual(API_KEY.indexes);
  });

  it('gives the API a key that can do only what the API needs', async () => {
    const client = await setUpSearch({ url, masterKey: MASTER_KEY });
    const recipes = client.index(RECIPES_INDEX);

    // Keys, other indexes, and the parts of the recipe index the API doesn't use.
    expect(await refusedKey(client.getKeys())).toBe(true);
    expect(await refusedKey(client.createKey({ ...API_KEY, uid: undefined }))).toBe(true);
    expect(await refusedKey(client.createIndex('users'))).toBe(true);
    expect(await refusedKey(client.getIndexes())).toBe(false); // filtered to what it may see
    expect(await refusedKey(recipes.getDocuments())).toBe(true);
    expect(await refusedKey(recipes.getSettings())).toBe(true);
    expect(await refusedKey(client.getStats())).toBe(false);

    // What it needs: a rebuild's fresh index, documents, searching, and swapping indexes.
    const fresh = `${RECIPES_INDEX}-rebuild`;
    await client.createIndex(fresh, { primaryKey: 'id' }).waitTask();
    await client
      .index(fresh)
      .addDocuments([recipe({ id: 'rebuilt' })])
      .waitTask();
    const swap = await client.swapIndexes([{ indexes: [RECIPES_INDEX, fresh], rename: false }]);

    // A swap's task belongs to no index, so a key limited to some indexes can't see it. Tasks run
    // in the order they were queued, so a rebuild waits for its next task on those indexes instead.
    await expect(client.tasks.getTask(swap.taskUid)).rejects.toSatisfy((error) =>
      isMeilisearchError(error, 'task_not_found'),
    );
    await client.deleteIndex(fresh).waitTask();
    expect((await recipes.search('')).hits.map((hit) => hit.id)).toEqual(['rebuilt']);
  });

  it("supports spec §3.4's synonyms, filters, sorts and autocomplete", async () => {
    const client = await setUpSearch({ url, masterKey: MASTER_KEY });
    const recipes = client.index<RecipeSearchDocument>(RECIPES_INDEX);
    await recipes
      .addDocuments([
        recipe({
          id: 'pancakes',
          title: 'Scallion pancakes',
          cuisine: ['Korean'],
          mealType: ['Side'],
          diet: ['vegetarian'],
          allergens: ['wheat', 'eggs'],
          difficulty: 'easy',
          totalMinutes: 25,
          ratingScore: 4.5,
          publishedAt: 3,
        }),
        recipe({
          id: 'soup',
          title: 'Hot and sour soup',
          ingredientNames: ['green onion', 'tofu'],
          cuisine: ['Chinese'],
          mealType: ['Main'],
          diet: ['vegetarian'],
          allergens: ['soy'],
          customTags: ['spicy'],
          difficulty: 'medium',
          totalMinutes: 40,
          ratingScore: 3.8,
          publishedAt: 1,
        }),
        recipe({
          id: 'salad',
          title: 'Tomato salad',
          normalizedIngredientNames: ['tomato', 'scallion'],
          cuisine: ['Korean'],
          mealType: ['Side'],
          diet: ['vegetarian', 'vegan'],
          difficulty: 'easy',
          totalMinutes: 10,
          ratingScore: 4.9,
          publishedAt: 2,
        }),
        recipe({ id: 'hidden', title: 'Scallion oil', visibility: 'private', ownerId: 'someone' }),
        recipe({ id: 'gone', title: 'Green onion dip', deleted: true }),
      ])
      .waitTask();

    // The access filter the API adds to every query (spec §4), for a caller with the ID "owner".
    const visible = 'deleted = false AND (visibility = shared OR ownerId = "owner")';
    const ids = async (query: string, options: Parameters<typeof recipes.search>[1] = {}) =>
      (await recipes.search(query, options)).hits.map((hit) => hit.id);
    const filtered = (filters: string[], sort?: string[]) =>
      ids('', { filter: [visible, ...filters], sort });

    // Each synonym finds the other, in titles and ingredient names.
    expect(sorted(await ids('green onion', { filter: visible }))).toEqual(['pancakes', 'soup']);
    expect(sorted(await ids('scallion', { filter: visible }))).toEqual(['pancakes', 'soup']);

    // Tags included, difficulty as one or more values, total time as a range.
    expect(
      await filtered(
        [
          'cuisine = Korean',
          'mealType = Side',
          'diet = vegetarian',
          'difficulty IN [easy, medium]',
          'totalMinutes 5 TO 30',
        ],
        ['publishedAt:desc'],
      ),
    ).toEqual(['pancakes', 'salad']);
    // Tags excluded, and allergens: "contains none of".
    expect(sorted(await filtered(['customTags != spicy', 'mealType != Main']))).toEqual([
      'pancakes',
      'salad',
    ]);
    expect(await filtered(['allergens NOT IN [wheat, peanuts]'], ['totalMinutes:asc'])).toEqual([
      'salad',
      'soup',
    ]);
    expect(await filtered([], ['ratingScore:desc'])).toEqual(['salad', 'pancakes', 'soup']);

    // Several ingredients require all of them, and autocomplete suggests the ones recipes use.
    expect(
      await filtered([
        'normalizedIngredientNames = scallion',
        'normalizedIngredientNames = tomato',
      ]),
    ).toEqual(['salad']);
    const { facetHits } = await recipes.searchForFacetValues({
      facetName: 'normalizedIngredientNames',
      facetQuery: 'scal',
    });
    expect(facetHits.map((hit) => hit.value)).toEqual(['scallion']);
  });

  it('fails on a wrong master key without saying what it was', async () => {
    const wrong = 'wrong-master-key-hunter2';

    const failure = setUpSearch({ url, masterKey: wrong });

    await expect(failure).rejects.toSatisfy((error) =>
      isMeilisearchError(error, 'invalid_api_key'),
    );
    await expect(failure).rejects.not.toThrow('hunter2');
  });
});

describe('the search service and /readyz', () => {
  /** The API's view of search, with retries fast enough for a test. */
  function apiWithSearch(url: string) {
    const { logger, text } = capturedLogger();
    const search = createSearchService({
      setUp: () => setUpSearch({ url, masterKey: MASTER_KEY }),
      logger,
      retryDelayMs: () => 200,
    });
    const { app } = createTestApp({ search });
    const readyz = async () => (await app.request('/readyz')).status;
    return { search, readyz, logText: text };
  }

  const until = (check: () => Promise<number>, status: number) =>
    vi.waitFor(
      async () => {
        expect(await check()).toBe(status);
      },
      { timeout: 30_000, interval: 100 },
    );

  it('becomes ready once Meilisearch is set up, and sets it up again after it loses its data', async () => {
    const container = await meilisearch().start();
    started.push(container);
    const url = urlOf(container);
    const master = new Meilisearch({ host: url, apiKey: MASTER_KEY });
    const { search, readyz, logText } = apiWithSearch(url);

    expect(await readyz()).toBe(503);
    search.start();
    await until(readyz, 200);

    await master.deleteIndex(RECIPES_INDEX).waitTask();
    expect(await readyz()).toBe(503);
    await until(readyz, 200);

    await master.deleteKey(API_KEY.uid);
    expect(await readyz()).toBe(503);
    await until(readyz, 200);

    search.stop();
    const apiKey = (await master.getKey(API_KEY.uid)).key;
    expect(logText()).not.toContain(MASTER_KEY);
    expect(logText()).not.toContain(apiKey);
  });

  it('starts before Meilisearch does, and keeps working when Meilisearch is replaced', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${String(port)}`;
    const { search, readyz, logText } = apiWithSearch(url);

    search.start();
    await vi.waitFor(() => {
      expect(logText()).toContain('search is unavailable, retrying in the background');
    });
    expect(await readyz()).toBe(503);

    const first = await meilisearch(port).start();
    await until(readyz, 200);

    // Gone: not ready, until a new Meilisearch with none of the old data takes its place.
    await first.stop();
    expect(await readyz()).toBe(503);
    const second = await meilisearch(port).start();
    started.push(second);
    await until(readyz, 200);

    search.stop();
    expect(logText()).not.toContain(MASTER_KEY);
  });
});

describe('main.ts', () => {
  it('sets up search with the configured address and master key', async () => {
    const container = await meilisearch().start();
    started.push(container);
    const port = await freePort();
    const dataDir = mkdtempSync(join(tmpdir(), 'myli-search-'));
    const api = spawn(process.execPath, [fileURLToPath(new URL('../main.ts', import.meta.url))], {
      env: {
        HOST: '127.0.0.1',
        PORT: String(port),
        PUBLIC_URL: 'http://127.0.0.1',
        DATABASE_PATH: join(dataDir, 'myli.db'),
        BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
        MEILI_URL: urlOf(container),
        MEILI_MASTER_KEY: MASTER_KEY,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    api.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    const exited = once(api, 'exit');

    try {
      await vi.waitFor(
        async () => {
          expect((await fetch(`http://127.0.0.1:${String(port)}/readyz`)).status).toBe(200);
        },
        { timeout: 30_000, interval: 200 },
      );
    } finally {
      api.kill('SIGTERM');
      await exited;
      rmSync(dataDir, { recursive: true, force: true });
    }

    expect((await exited)[0]).toBe(0);
    expect(stdout).toContain('"msg":"search is ready"');
    expect(stdout).not.toContain(MASTER_KEY);
  });
});
