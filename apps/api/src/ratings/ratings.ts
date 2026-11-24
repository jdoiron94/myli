import type { RatingSummary, RecipeRating } from '@myli/shared';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { rating } from '../db/schema.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { indexRecipeJob } from '../search/indexing.ts';

const NO_RATINGS: RatingSummary = { average: null, count: 0 };

/** Each recipe's ratings, as cards show them. Recipes nobody has rated have none. */
export function ratingSummaries(db: Db, recipeIds: readonly string[]): Map<string, RatingSummary> {
  if (recipeIds.length === 0) return new Map();
  const rows = db
    .select({
      recipeId: rating.recipeId,
      average: sql<number>`avg(${rating.stars})`,
      count: count(),
    })
    .from(rating)
    .where(inArray(rating.recipeId, [...recipeIds]))
    .groupBy(rating.recipeId)
    .all();
  return new Map(rows.map(({ recipeId, ...summary }) => [recipeId, summary]));
}

/** A recipe's ratings as its cards show them, `NO_RATINGS` if nobody has rated it. */
export const summaryOf = (summaries: Map<string, RatingSummary>, recipeId: string) =>
  summaries.get(recipeId) ?? NO_RATINGS;

/** A recipe's ratings, and `userId`'s own. */
export function recipeRating(db: Db, recipeId: string, userId: string): RecipeRating {
  const mine = db
    .select({ stars: rating.stars })
    .from(rating)
    .where(ratingRow(userId, recipeId))
    .get();
  return {
    ...summaryOf(ratingSummaries(db, [recipeId]), recipeId),
    mine: mine?.stars ?? null,
  };
}

const ratingRow = (userId: string, recipeId: string) =>
  and(eq(rating.userId, userId), eq(rating.recipeId, recipeId));

/**
 * Sets `userId`'s rating of the recipe, and queues its search update, since its score changes.
 * The rating it already has changes nothing.
 */
export function setRating(db: Db, userId: string, recipeId: string, stars: number): void {
  db.transaction((tx) => {
    const [changed] = tx
      .insert(rating)
      .values({ userId, recipeId, stars })
      .onConflictDoUpdate({
        target: [rating.userId, rating.recipeId],
        set: { stars, updatedAt: new Date() },
        setWhere: sql`${rating.stars} <> ${stars}`,
      })
      .returning({ stars: rating.stars })
      .all();
    if (changed) enqueueJob(tx, indexRecipeJob, { recipeId });
  });
}

/** Takes away `userId`'s rating of the recipe, if they have one, and queues its search update. */
export function removeRating(db: Db, userId: string, recipeId: string): void {
  db.transaction((tx) => {
    const [removed] = tx
      .delete(rating)
      .where(ratingRow(userId, recipeId))
      .returning({ stars: rating.stars })
      .all();
    if (removed) enqueueJob(tx, indexRecipeJob, { recipeId });
  });
}
