// Runs against a real Meilisearch container: `pnpm test:containers`, with Docker running.
import { Meilisearch } from 'meilisearch';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/database.ts';
import { job, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { deleteRecipe } from '../recipes/recipes.ts';
import { insertRecipe } from '../recipes/testing.ts';
import { buildRecipeDocument, type RecipeSearchDocument } from './document.ts';
import { queueReindexIfEmpty, rebuildRecipeIndex } from './reindex.ts';
import { API_KEY, RECIPES_INDEX, RECIPES_SETTINGS } from './settings.ts';
import { setUpSearch } from './setup.ts';
import { MEILI_MASTER_KEY, meilisearchContainer, meilisearchUrl } from './testing.ts';

const silent = createLogger('fatal', { write: () => undefined });

let container: StartedTestContainer;
let url: string;
/** Reads and arranges what the tests check, which the API's key may not do. */
let master: Meilisearch;
let client: Meilisearch;
let db: Db;

beforeAll(async () => {
  container = await meilisearchContainer().start();
  url = meilisearchUrl(container);
  master = new Meilisearch({ host: url, apiKey: MEILI_MASTER_KEY });
});

afterAll(async () => {
  await container.stop();
});

// Each test starts from a Meilisearch that has never seen the API, and an empty database.
beforeEach(async () => {
  const { results } = await master.getIndexes();
  for (const { uid } of results) await master.deleteIndex(uid).waitTask();
  await master.deleteKey(API_KEY.uid).catch(() => undefined);
  client = await setUpSearch({ url, masterKey: MEILI_MASTER_KEY });
  db = createTestDatabase();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
});

const recipes = () => master.index<RecipeSearchDocument>(RECIPES_INDEX);
function documentOf(id: string): RecipeSearchDocument {
  const document = buildRecipeDocument(db, id);
  if (!document) throw new Error(`no recipe ${id}`);
  return document;
}
const indexNames = async () => (await master.getIndexes()).results.map(({ uid }) => uid).sort();
async function indexedIds() {
  const { results } = await recipes().getDocuments({ limit: 1000 });
  return results.map(({ id }) => id).sort();
}

describe('rebuildRecipeIndex', () => {
  it('fills the index with exactly the live recipes, as SQLite holds them', async () => {
    const kept = [insertRecipe(db, 'owner'), insertRecipe(db, 'owner', 'private')];
    const deleted = insertRecipe(db, 'owner');
    deleteRecipe(db, { actorId: 'owner', ip: null, userAgent: null }, deleted);
    // What the index had before: a recipe since deleted, and one with an old title.
    await recipes()
      .addDocuments([
        { ...documentOf(kept[0] ?? ''), title: 'Old title' },
        { ...documentOf(kept[1] ?? ''), id: deleted },
      ])
      .waitTask();

    expect(await rebuildRecipeIndex(db, client)).toBe(2);

    expect(await indexedIds()).toEqual([...kept].sort());
    for (const id of kept)
      expect(await recipes().getDocument(id)).toEqual(buildRecipeDocument(db, id));
    expect(await indexNames()).toEqual([RECIPES_INDEX]);
    const settings = await recipes().getSettings();
    expect(settings.filterableAttributes).toEqual(
      expect.arrayContaining([...RECIPES_SETTINGS.filterableAttributes]),
    );
    expect(settings.synonyms).toEqual(RECIPES_SETTINGS.synonyms);
  });

  it('sends recipes in batches, for an index larger than one', async () => {
    const ids = Array.from({ length: 501 }, () => insertRecipe(db, 'owner'));

    expect(await rebuildRecipeIndex(db, client)).toBe(501);
    expect((await recipes().getStats()).numberOfDocuments).toBe(501);
    expect(await indexedIds()).toEqual(ids.sort());
  });

  it('removes what a rebuild that stopped halfway left behind', async () => {
    await master.createIndex(`${RECIPES_INDEX}_rebuild_1`, { primaryKey: 'id' }).waitTask();
    insertRecipe(db, 'owner');

    await rebuildRecipeIndex(db, client);

    expect(await indexNames()).toEqual([RECIPES_INDEX]);
  });
});

describe('queueReindexIfEmpty', () => {
  const queued = () =>
    db
      .select()
      .from(job)
      .all()
      .filter(({ type }) => type === 'search.reindex');

  it('queues a rebuild when the index is empty but SQLite has recipes', async () => {
    const id = insertRecipe(db, 'owner');
    await queueReindexIfEmpty(db, client, silent);
    expect(queued()).toHaveLength(1);

    // The worker rebuilds it, after the update the recipe's creation queued.
    const worker = createWorker({
      services: { db, mailer: null, publicUrl: 'https://myli.test', search: { client } },
      logger: silent,
      jobs: allJobs,
    });
    while (await worker.runOnce()) {
      // One job a pass.
    }
    expect(await indexedIds()).toEqual([id]);
    expect(
      db
        .select()
        .from(job)
        .all()
        .map(({ status }) => status),
    ).toEqual(['succeeded', 'succeeded']);
  });

  it('leaves an index alone that has recipes, and an empty one when SQLite has none', async () => {
    await queueReindexIfEmpty(db, client, silent);
    expect(queued()).toEqual([]);

    const id = insertRecipe(db, 'owner');
    await recipes()
      .addDocuments([documentOf(id)])
      .waitTask();
    await queueReindexIfEmpty(db, client, silent);
    expect(queued()).toEqual([]);
  });
});
