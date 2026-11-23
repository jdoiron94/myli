import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from '../audit/audit.ts';
import type { Db } from '../db/database.ts';
import { image, recipe, recipeDraft, recipeRevision, recipeStep } from '../db/schema.ts';
import { deleteBlobsJob } from '../images/images.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob, enqueueUnlessWaiting } from '../jobs/queue.ts';
import { auditedRecipe } from '../recipes/recipes.ts';
import { indexRecipeJob } from '../search/indexing.ts';
import { DAY_MS } from './trash.ts';

/** The purge is the server's own doing: no one's, from nowhere. */
const SERVER_ORIGIN = { actorId: null, ip: null, userAgent: null };

/**
 * Deletes a recipe in the trash for good, with what's only its: its revisions, draft and photos,
 * whose files go in a job of their own. Only if it's still in the trash, deleted by
 * `deletedBefore`. Whether it was purged.
 */
export function purgeRecipe(db: Db, id: string, deletedBefore: Date): boolean {
  return db.transaction((tx) => {
    const due = tx
      .select({ title: recipe.title, visibility: recipe.visibility })
      .from(recipe)
      .where(
        and(eq(recipe.id, id), isNotNull(recipe.deletedAt), lte(recipe.deletedAt, deletedBefore)),
      )
      .get();
    if (!due) return false;
    // These refer to the recipe or its photos without cascading, so each goes before what it
    // refers to. A recipe's photos are only ever its own, and only its revisions refer to them.
    tx.delete(recipeDraft).where(eq(recipeDraft.recipeId, id)).run();
    tx.delete(recipeRevision).where(eq(recipeRevision.recipeId, id)).run();
    tx.update(recipe).set({ coverImageId: null }).where(eq(recipe.id, id)).run();
    tx.delete(recipeStep).where(eq(recipeStep.recipeId, id)).run();
    const photos = tx
      .delete(image)
      .where(eq(image.recipeId, id))
      .returning({ variants: image.variants })
      .all();
    // Its ingredients, tags and favorites go with it.
    tx.delete(recipe).where(eq(recipe.id, id)).run();

    const keys = photos.flatMap(({ variants }) => variants.map(({ key }) => key));
    if (keys.length > 0) enqueueJob(tx, deleteBlobsJob, { keys });
    // Deleting it took it out of the index, unless that failed for good.
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    recordAuditEvent(tx, SERVER_ORIGIN, {
      action: 'recipe.purged',
      target: { type: 'recipe', id },
      metadata: auditedRecipe(due),
    });
    return true;
  });
}

/**
 * Purges the recipes deleted by `deletedBefore` (spec §3.2 Trash), each in a transaction of its
 * own. Queue it with `queueTrashPurge`, which works out when that is.
 */
export const purgeTrashJob = defineJob({
  type: 'trash.purge',
  payload: z.object({ deletedBefore: z.iso.datetime() }),
  handle({ deletedBefore }, { services: { db }, logger }) {
    const before = new Date(deletedBefore);
    const due = db
      .select({ id: recipe.id })
      .from(recipe)
      .where(and(isNotNull(recipe.deletedAt), lte(recipe.deletedAt, before)))
      .all();
    const purged = due.filter(({ id }) => purgeRecipe(db, id, before)).length;
    if (purged > 0) logger.info({ recipes: purged }, 'purged recipes from the trash');
    return Promise.resolve();
  },
});

/**
 * Queues a purge of the recipes that have been in the trash for `retentionDays` by `now`, unless
 * one is already waiting or under way. Its job's ID, either way.
 */
export function queueTrashPurge(db: Db, retentionDays: number, now = new Date()): number {
  const deletedBefore = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return enqueueUnlessWaiting(db, purgeTrashJob, { deletedBefore });
}
