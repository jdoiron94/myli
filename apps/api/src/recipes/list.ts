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

/**
 * `recipe.read` (policy.ts) restated in SQL, so the list can be paged in the database: shared
 * recipes, and the caller's own private ones. Deleted ones are gone for everyone. Each row is still
 * checked with `can()`, and `list.test.ts` compares the two over every kind of recipe.
 */
const readableBy = (user: PolicyUser) =>
  and(isNull(recipe.deletedAt), or(eq(recipe.visibility, 'shared'), eq(recipe.ownerId, user.id)));

/**
 * One page of the recipes the caller may see, newest first, from SQLite. Unlike search, it doesn't
 * need Meilisearch, so home works while search is unavailable.
 */
export function listRecipes(db: Db, user: PolicyUser, page: number): RecipeList {
  const where = readableBy(user);
  const total = db.select({ value: count() }).from(recipe).where(where).get()?.value ?? 0;
  const rows = db
    .select({
      id: recipe.id,
      title: recipe.title,
      difficulty: recipe.difficulty,
      prepMin: recipe.prepMin,
      cookMin: recipe.cookMin,
      totalMin: recipe.totalMin,
      visibility: recipe.visibility,
      ownerId: recipe.ownerId,
    })
    .from(recipe)
    .where(where)
    .orderBy(desc(recipe.createdAt), asc(recipe.id))
    .limit(RECIPES_PER_PAGE)
    .offset((page - 1) * RECIPES_PER_PAGE)
    .all()
    .filter((row) => can(user, 'recipe.read', row));

  const tags =
    rows.length === 0
      ? []
      : db
          .select({ recipeId: recipeTag.recipeId, type: tag.type, name: tag.name })
          .from(recipeTag)
          .innerJoin(tag, eq(tag.id, recipeTag.tagId))
          .where(
            inArray(
              recipeTag.recipeId,
              rows.map(({ id }) => id),
            ),
          )
          .orderBy(asc(tag.nameKey))
          .all();
  const covers = coversOf(
    db,
    rows.map(({ id }) => id),
  );
  const named = (recipeId: string, type: TagType) =>
    tags.filter((t) => t.recipeId === recipeId && t.type === type).map((t) => t.name);

  return {
    recipes: rows.map(
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
      }),
    ),
    total,
    page,
    totalPages: Math.ceil(total / RECIPES_PER_PAGE),
  };
}
