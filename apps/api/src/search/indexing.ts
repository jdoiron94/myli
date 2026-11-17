import { z } from 'zod';
import { defineJob } from '../jobs/define.ts';
import { buildRecipeDocument, type RecipeSearchDocument } from './document.ts';
import { RECIPES_INDEX } from './settings.ts';

/** How long to wait for Meilisearch to apply one recipe's change. */
const TASK_TIMEOUT_MS = 30_000;

/**
 * Keeps one recipe's search document in step with SQLite (spec §4): sends it as it is now, or
 * takes it out once the recipe is deleted. It reads the recipe when it runs, so running it again,
 * or after a later change's job, does no harm. Queue it with `enqueueJob` in the transaction of
 * every write that changes the document.
 *
 * While Meilisearch is unavailable it fails and is retried. The worker's default would give up
 * after about four minutes; this keeps trying for about thirteen hours (backoff doubles from two
 * seconds up to an hour), so an outage doesn't leave the index behind.
 */
export const indexRecipeJob = defineJob({
  type: 'search.index-recipe',
  payload: z.object({ recipeId: z.string() }),
  maxAttempts: 24,
  async handle({ recipeId }, { services: { db, search }, logger }) {
    const { client } = search;
    if (!client) throw new Error('Search is unavailable');
    const index = client.index<RecipeSearchDocument>(RECIPES_INDEX);
    const document = buildRecipeDocument(db, recipeId);
    const task = await (document
      ? index.addDocuments([document])
      : index.deleteDocument(recipeId)
    ).waitTask({ timeout: TASK_TIMEOUT_MS });
    if (task.status !== 'succeeded') {
      throw new Error(
        `Meilisearch could not ${document ? 'index' : 'remove'} the recipe: ${task.error?.message ?? task.status}`,
      );
    }
    logger.debug({ recipeId, removed: !document }, 'search index updated');
  },
});
