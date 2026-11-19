import { eq, notExists } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { recipe, recipeRevision } from '../db/schema.ts';
import { loadRecipe } from '../recipes/recipes.ts';
import { snapshotOf } from './snapshot.ts';

/** The message of the first revision of a recipe saved before revisions were kept. */
export const BACKFILLED_MESSAGE = 'As it was when myli started keeping revisions.';

/**
 * Gives each recipe saved before revisions were kept, deleted ones included, its first revision:
 * the recipe as it is, by its owner, dated when it was last changed. The API runs it on startup,
 * after the migrations; once every recipe has a revision, it does nothing. How many it gave one.
 */
export function backfillRevisions(db: Db): number {
  return db.transaction((tx) => {
    const missing = tx
      .select({ id: recipe.id, ownerId: recipe.ownerId, updatedAt: recipe.updatedAt })
      .from(recipe)
      .where(
        notExists(
          tx
            .select({ id: recipeRevision.id })
            .from(recipeRevision)
            .where(eq(recipeRevision.recipeId, recipe.id)),
        ),
      )
      .all();
    for (const { id, ownerId, updatedAt } of missing) {
      const current = loadRecipe(tx, id, { includeDeleted: true });
      // Read in this transaction, which nothing else can write in.
      if (!current) throw new Error('a recipe to backfill could not be read');
      tx.insert(recipeRevision)
        .values({
          recipeId: id,
          number: 1,
          snapshot: snapshotOf(current),
          authorId: ownerId,
          message: BACKFILLED_MESSAGE,
          createdAt: updatedAt,
        })
        .run();
    }
    return missing.length;
  });
}
