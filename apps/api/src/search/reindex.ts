import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Meilisearch } from 'meilisearch';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { job, recipe } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { Logger } from '../logger.ts';
import { buildRecipeDocument, type RecipeSearchDocument } from './document.ts';
import { RECIPES_INDEX, RECIPES_SETTINGS } from './settings.ts';
import { succeeded } from './setup.ts';

/** Recipes sent to Meilisearch at a time. */
const BATCH_SIZE = 500;
/** How long to wait for Meilisearch to apply each step, such as settings on a new index. */
const TASK_TIMEOUT_MS = 120_000;
/** What a rebuild's index is called until it's swapped in. Within the API key's `recipes*`. */
const REBUILD_PREFIX = `${RECIPES_INDEX}_rebuild_`;

/**
 * Builds the recipe index afresh from SQLite, under another name, then swaps it in (spec §4).
 * Searches use the old index until then, and Meilisearch swaps them atomically. Returns how many
 * recipes the index holds.
 *
 * Run it only through `reindexRecipesJob`. The worker runs one job at a time, so no recipe's
 * update can go to the old index while this runs and be lost in the swap: updates queued
 * meanwhile run afterwards, against the new one.
 */
export async function rebuildRecipeIndex(db: Db, client: Meilisearch): Promise<number> {
  const wait = { timeout: TASK_TIMEOUT_MS };

  // A rebuild that stopped halfway, as when the process did, leaves its index behind.
  const { results } = await client.getIndexes({ limit: 1000 });
  for (const { uid } of results.filter(({ uid }) => uid.startsWith(REBUILD_PREFIX))) {
    succeeded(await client.deleteIndex(uid).waitTask(wait), `delete the leftover ${uid} index`);
  }

  const fresh = `${REBUILD_PREFIX}${String(Date.now())}`;
  succeeded(
    await client.createIndex(fresh, { primaryKey: 'id' }).waitTask(wait),
    `create the ${fresh} index`,
  );
  const index = client.index<RecipeSearchDocument>(fresh);
  succeeded(await index.updateSettings(RECIPES_SETTINGS).waitTask(wait), `configure ${fresh}`);

  const ids = db
    .select({ id: recipe.id })
    .from(recipe)
    .where(isNull(recipe.deletedAt))
    .all()
    .map(({ id }) => id);
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const documents = ids
      .slice(start, start + BATCH_SIZE)
      .flatMap((id) => buildRecipeDocument(db, id) ?? []);
    succeeded(await index.addDocuments(documents).waitTask(wait), `fill ${fresh}`);
  }

  // The API's key can't read the swap's task, which belongs to no index. Tasks run in the order
  // they were queued, so once deleting the old index (now under the fresh name) is done, so is the
  // swap. Had the swap failed, that would delete the new index instead, which the count catches.
  await client.swapIndexes([{ indexes: [RECIPES_INDEX, fresh], rename: false }]);
  succeeded(await client.deleteIndex(fresh).waitTask(wait), `delete the old ${RECIPES_INDEX}`);
  const { numberOfDocuments } = await client.index(RECIPES_INDEX).getStats();
  if (numberOfDocuments !== ids.length) {
    throw new Error(
      `The rebuilt index has ${String(numberOfDocuments)} recipes, not ${String(ids.length)}: the swap may have failed`,
    );
  }
  return ids.length;
}

/** Rebuilds the recipe index. Queue it with `queueReindex`. */
export const reindexRecipesJob = defineJob({
  type: 'search.reindex',
  payload: z.object({}),
  // As long as index updates keep trying (indexRecipeJob).
  maxAttempts: 24,
  async handle(_, { services: { db, search }, logger }) {
    const { client } = search;
    if (!client) throw new Error('Search is unavailable');
    const recipes = await rebuildRecipeIndex(db, client);
    logger.info({ recipes }, 'search index rebuilt');
  },
});

/**
 * Queues a rebuild, unless one is already waiting or under way. Its job's ID, either way. Immediate,
 * so it holds the write lock from the start: deferred, it would read, then fail at once when it came
 * to write if another connection, like the API's worker beside `pnpm reindex`, wrote in between.
 */
export function queueReindex(db: Db): number {
  return db.transaction(
    (tx) => {
      const waiting = tx
        .select({ id: job.id })
        .from(job)
        .where(
          and(eq(job.type, reindexRecipesJob.type), inArray(job.status, ['pending', 'running'])),
        )
        .get();
      return waiting?.id ?? enqueueJob(tx, reindexRecipesJob, {});
    },
    { behavior: 'immediate' },
  );
}

/**
 * Queues a rebuild if the index is empty while SQLite has recipes, as after Meilisearch lost its
 * data or the index was new (spec §4). Run each time search is set up: on startup, and whenever
 * Meilisearch had to be set up again.
 */
export async function queueReindexIfEmpty(db: Db, client: Meilisearch, logger: Logger) {
  const { numberOfDocuments } = await client.index(RECIPES_INDEX).getStats();
  if (numberOfDocuments > 0) return;
  const recipes =
    db.select({ recipes: count() }).from(recipe).where(isNull(recipe.deletedAt)).get()?.recipes ??
    0;
  if (recipes === 0) return;
  const jobId = queueReindex(db);
  logger.info({ recipes, jobId }, 'the search index is empty, rebuilding it');
}
