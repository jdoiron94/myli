import { type PolicyUser, RECIPES_PER_PAGE, type RecipeList } from '@myli/shared';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { favorite, recipe } from '../db/schema.ts';
import { pageOffset, readableBy, recipeListPage, SUMMARY_COLUMNS } from '../recipes/list.ts';

const favoriteRow = (userId: string, recipeId: string) =>
  and(eq(favorite.userId, userId), eq(favorite.recipeId, recipeId));

export function isFavorite(db: Db, userId: string, recipeId: string): boolean {
  return db.select().from(favorite).where(favoriteRow(userId, recipeId)).get() !== undefined;
}

/** Makes a recipe one of the user's favorites, or not. Setting what it already is changes nothing. */
export function setFavorite(db: Db, userId: string, recipeId: string, value: boolean): void {
  if (value) {
    db.insert(favorite).values({ userId, recipeId }).onConflictDoNothing().run();
  } else {
    db.delete(favorite).where(favoriteRow(userId, recipeId)).run();
  }
}

/**
 * One page of the user's favorites they may still see, newest favorite first. One they may no
 * longer see is left out and not counted, as everywhere else (spec §2).
 */
export function listFavorites(db: Db, user: PolicyUser, page: number): RecipeList {
  const where = and(eq(favorite.userId, user.id), readableBy(user));
  const total =
    db
      .select({ value: count() })
      .from(favorite)
      .innerJoin(recipe, eq(recipe.id, favorite.recipeId))
      .where(where)
      .get()?.value ?? 0;
  const rows = db
    .select(SUMMARY_COLUMNS)
    .from(favorite)
    .innerJoin(recipe, eq(recipe.id, favorite.recipeId))
    .where(where)
    .orderBy(desc(favorite.createdAt), asc(recipe.id))
    .limit(RECIPES_PER_PAGE)
    .offset(pageOffset(page))
    .all();
  return recipeListPage(db, user, rows, { total, page });
}
