// Runs against a real Meilisearch container: `pnpm test:containers`, with Docker running.
import { Meilisearch } from 'meilisearch';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import type { Db } from '../db/database.ts';
import { user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker, type Worker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { deleteRecipe, setRecipeVisibility, updateRecipe } from '../recipes/recipes.ts';
import { insertRecipe, sampleRecipeContent } from '../recipes/testing.ts';
import { buildRecipeDocument, type RecipeSearchDocument } from './document.ts';
import { RECIPES_INDEX } from './settings.ts';
import { isMeilisearchError, setUpSearch } from './setup.ts';
import { MEILI_MASTER_KEY, meilisearchContainer, meilisearchUrl } from './testing.ts';

let container: StartedTestContainer;
let client: Meilisearch;
/** Reads documents back, which the API's own key may not: the API never needs to. */
let master: Meilisearch;
let db: Db;
let worker: Worker;

beforeAll(async () => {
  container = await meilisearchContainer().start();
  client = await setUpSearch({ url: meilisearchUrl(container), masterKey: MEILI_MASTER_KEY });
  master = new Meilisearch({ host: meilisearchUrl(container), apiKey: MEILI_MASTER_KEY });
  db = createTestDatabase();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
  worker = createWorker({
    services: {
      db,
      mailer: null,
      publicUrl: 'https://myli.test',
      search: { client },
      blobs: createMemoryBlobStore(),
    },
    logger: createLogger('fatal', { write: () => undefined }),
    jobs: allJobs,
  });
});

afterAll(async () => {
  await container.stop();
});

/** Runs every job that's due. */
async function runJobs() {
  while (await worker.runOnce()) {
    // Each pass runs one job.
  }
}

const indexed = (id: string) => master.index<RecipeSearchDocument>(RECIPES_INDEX).getDocument(id);

describe('keeping the index in step with SQLite', () => {
  it('sends a new recipe, each change to it, and takes it out once deleted', async () => {
    const id = insertRecipe(db, 'owner', 'private');
    await runJobs();
    expect(await indexed(id)).toEqual(buildRecipeDocument(db, id));

    updateRecipe(db, id, sampleRecipeContent({ title: 'Seeded Rye' }));
    setRecipeVisibility(db, id, 'shared');
    await runJobs();
    expect(await indexed(id)).toMatchObject({ title: 'Seeded Rye', visibility: 'shared' });

    deleteRecipe(db, { actorId: 'owner', ip: null, userAgent: null }, id);
    await runJobs();
    const gone = await indexed(id).then(
      () => false,
      (error: unknown) => isMeilisearchError(error, 'document_not_found'),
    );
    expect(gone).toBe(true);
  });

  it('can be found by what the recipe says, once indexed', async () => {
    const id = insertRecipe(db, 'owner');
    updateRecipe(db, id, sampleRecipeContent({ title: 'Cardamom Buns' }));
    await runJobs();

    const { hits } = await client
      .index<RecipeSearchDocument>(RECIPES_INDEX)
      .search('cardamon', { filter: 'deleted = false' });
    expect(hits.map((hit) => hit.id)).toEqual([id]);
  });
});
