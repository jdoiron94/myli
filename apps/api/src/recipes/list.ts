import {
  can,
  type PolicyUser,
  RECIPES_PER_PAGE,
  type RecipeList,
  type RecipeSummary,
  recipeTotalMinutes,
  type TagType,
} from '@myli/shared';
import { and, asc, count, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { recipe, recipeTag, tag } from '../db/schema.ts';
import { coversOf } from '../images/images.ts';
import { ratingSummaries, summaryOf } from '../ratings/ratings.ts';

/**
 * `recipe.read` (policy.ts) restated in SQL, so lists can be paged in the database: shared
 * recipes, and the caller's own private ones. Deleted ones are gone for everyone. Each row is still
 * checked with `can()`, and `list.test.ts` compares the two over every kind of recipe.
 */
export const readableBy = (user: PolicyUser) =>
  and(isNull(recipe.deletedAt), or(eq(recipe.visibility, 'shared'), eq(recipe.ownerId, user.id)));

/** What a list selects of each recipe: enough for its card, and for `can()`. */
export const SUMMARY_COLUMNS = {
  id: recipe.id,
  title: recipe.title,
  difficulty: recipe.difficulty,
  prepMin: recipe.prepMin,
  cookMin: recipe.cookMin,
  totalMin: recipe.totalMin,
  visibility: recipe.visibility,
  ownerId: recipe.ownerId,
};

type SummaryRow = Pick<typeof recipe.$inferSelect, keyof typeof SUMMARY_COLUMNS>;

/** How many rows a list skips to reach `page`. */
export const pageOffset = (page: number) => (page - 1) * RECIPES_PER_PAGE;

/**
 * One page of the recipes the caller may see, newest first, from SQLite. Unlike search, it doesn't
 * need Meilisearch, so home works while search is unavailable.
 */
export function listRecipes(db: Db, user: PolicyUser, page: number): RecipeList {
  const where = readableBy(user);
  const total = db.select({ value: count() }).from(recipe).where(where).get()?.value ?? 0;
  const rows = db
    .select(SUMMARY_COLUMNS)
    .from(recipe)
    .where(where)
    .orderBy(desc(recipe.createdAt), asc(recipe.id))
    .limit(RECIPES_PER_PAGE)
    .offset(pageOffset(page))
    .all();
  return recipeListPage(db, user, rows, { total, page });
}

/**
 * A page of a list, from its rows (`SUMMARY_COLUMNS`, already filtered with `readableBy`) and the
 * number of rows on every page together.
 */
export function recipeListPage(
  db: Db,
  user: PolicyUser,
  rows: SummaryRow[],
  { total, page }: { total: number; page: number },
): RecipeList {
  return {
    recipes: recipeSummaries(db, user, rows),
    total,
    page,
    totalPages: Math.ceil(total / RECIPES_PER_PAGE),
  };
}

/**
 * Each recipe's card, from its row (`SUMMARY_COLUMNS`, already filtered with `readableBy`), in the
 * rows' order. Each row is checked with `can()` once more.
 */
export function recipeSummaries(db: Db, user: PolicyUser, rows: SummaryRow[]): RecipeSummary[] {
  const readable = rows.filter((row) => can(user, 'recipe.read', row));
  const ids = readable.map(({ id }) => id);
  const tags =
    ids.length === 0
      ? []
      : db
          .select({ recipeId: recipeTag.recipeId, type: tag.type, name: tag.name })
          .from(recipeTag)
          .innerJoin(tag, eq(tag.id, recipeTag.tagId))
          .where(inArray(recipeTag.recipeId, ids))
          .orderBy(asc(tag.nameKey))
          .all();
  const covers = coversOf(db, ids);
  const ratings = ratingSummaries(db, ids);
  const named = (recipeId: string, type: TagType) =>
    tags.filter((t) => t.recipeId === recipeId && t.type === type).map((t) => t.name);

  return readable.map(
    (row): RecipeSummary => ({
      id: row.id,
      title: row.title,
      difficulty: row.difficulty,
      totalMinutes: recipeTotalMinutes({
        prepMinutes: row.prepMin,
        cookMinutes: row.cookMin,
        totalMinutes: row.totalMin,
      }),
      cuisine: named(row.id, 'cuisine'),
      mealType: named(row.id, 'meal_type'),
      diet: named(row.id, 'diet'),
      tags: named(row.id, 'custom'),
      // The allergen tags are seeded from ALLERGENS, and never edited (spec §3.2).
      allergens: named(row.id, 'allergen') as RecipeSummary['allergens'],
      visibility: row.visibility,
      cover: covers.get(row.id) ?? null,
      rating: summaryOf(ratings, row.id),
    }),
  );
}
