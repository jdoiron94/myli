import {
  type Collection,
  type CollectionIngredients,
  type CollectionSummary,
  type GroceryIngredient,
  type MOVE_DIRECTIONS,
  type PolicyUser,
  RECIPES_PER_PAGE,
  tagNameKey,
} from '@myli/shared';
import { and, asc, count, eq, max } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { collection, collectionItem, recipe, recipeIngredient } from '../db/schema.ts';
import { pageOffset, readableBy, recipeListPage, SUMMARY_COLUMNS } from '../recipes/list.ts';

const owned = (ownerId: string, id: string) =>
  and(eq(collection.id, id), eq(collection.ownerId, ownerId));

/** Whether `ownerId` has a collection with this ID. No one else's is ever found, admins' included. */
export function ownsCollection(db: Db, ownerId: string, id: string): boolean {
  return db.select().from(collection).where(owned(ownerId, id)).get() !== undefined;
}

/**
 * The user's collections, by name, each with how many of its recipes they may see now: one they
 * may no longer see stays in it, uncounted.
 */
export function listCollections(db: Db, user: PolicyUser): CollectionSummary[] {
  return db
    .select({ id: collection.id, name: collection.name, recipeCount: count(recipe.id) })
    .from(collection)
    .leftJoin(collectionItem, eq(collectionItem.collectionId, collection.id))
    .leftJoin(recipe, and(eq(recipe.id, collectionItem.recipeId), readableBy(user)))
    .where(eq(collection.ownerId, user.id))
    .groupBy(collection.id)
    .orderBy(asc(collection.nameKey), asc(collection.id))
    .all();
}

/** Creates a collection for the owner, with no recipes yet. Its name needn't differ from theirs. */
export function createCollection(db: Db, ownerId: string, name: string): CollectionSummary {
  const [created] = db
    .insert(collection)
    .values({ ownerId, name, nameKey: tagNameKey(name) })
    .returning({ id: collection.id })
    .all();
  if (!created) throw new Error('the collection was not created');
  return { id: created.id, name, recipeCount: 0 };
}

/** Renames one of the owner's collections. Whether they have one with this ID. */
export function renameCollection(db: Db, ownerId: string, id: string, name: string): boolean {
  return (
    db
      .update(collection)
      .set({ name, nameKey: tagNameKey(name) })
      .where(owned(ownerId, id))
      .run().changes > 0
  );
}

/** Deletes one of the owner's collections, not its recipes. Whether it had one with this ID. */
export function deleteCollection(db: Db, ownerId: string, id: string): boolean {
  return db.delete(collection).where(owned(ownerId, id)).run().changes > 0;
}

/** The recipes in a collection that the user may see now. */
const visibleIn = (user: PolicyUser, id: string) =>
  and(eq(collectionItem.collectionId, id), readableBy(user));

/**
 * One of the user's collections, with one page of the recipes in it they may see now, in its order,
 * `null` if they have none with this ID.
 */
export function loadCollection(
  db: Db,
  user: PolicyUser,
  id: string,
  page: number,
): Collection | null {
  const row = db
    .select({ id: collection.id, name: collection.name })
    .from(collection)
    .where(owned(user.id, id))
    .get();
  if (!row) return null;
  const where = visibleIn(user, id);
  const total =
    db
      .select({ value: count() })
      .from(collectionItem)
      .innerJoin(recipe, eq(recipe.id, collectionItem.recipeId))
      .where(where)
      .get()?.value ?? 0;
  const rows = db
    .select(SUMMARY_COLUMNS)
    .from(collectionItem)
    .innerJoin(recipe, eq(recipe.id, collectionItem.recipeId))
    .where(where)
    .orderBy(asc(collectionItem.position), asc(recipe.id))
    .limit(RECIPES_PER_PAGE)
    .offset(pageOffset(page))
    .all();
  return { ...row, ...recipeListPage(db, user, rows, { total, page }) };
}

/**
 * What one of the user's collections' grocery list is worked out from (spec §3.5): the ingredients
 * of every recipe in it that they may see now, as published, in its order, all at once. `null` if
 * they have no collection with this ID.
 */
export function collectionIngredients(
  db: Db,
  user: PolicyUser,
  id: string,
): CollectionIngredients | null {
  const row = db
    .select({ id: collection.id, name: collection.name })
    .from(collection)
    .where(owned(user.id, id))
    .get();
  if (!row) return null;
  const recipes = db
    .select({ id: recipe.id, title: recipe.title, servings: recipe.servings })
    .from(collectionItem)
    .innerJoin(recipe, eq(recipe.id, collectionItem.recipeId))
    .where(visibleIn(user, id))
    .orderBy(asc(collectionItem.position), asc(recipe.id))
    .all();
  // Every line of every recipe in it: only those of the recipes they may see are used.
  const lines = db
    .select({
      recipeId: recipeIngredient.recipeId,
      qty: recipeIngredient.qty,
      qtyMax: recipeIngredient.qtyMax,
      unit: recipeIngredient.unit,
      name: recipeIngredient.name,
      normalizedName: recipeIngredient.normalizedName,
      scalable: recipeIngredient.scalable,
    })
    .from(recipeIngredient)
    .innerJoin(collectionItem, eq(collectionItem.recipeId, recipeIngredient.recipeId))
    .where(eq(collectionItem.collectionId, id))
    .orderBy(asc(recipeIngredient.groupPosition), asc(recipeIngredient.position))
    .all();
  const byRecipe = new Map<string, GroceryIngredient[]>();
  for (const { recipeId, ...line } of lines) {
    byRecipe.set(recipeId, [...(byRecipe.get(recipeId) ?? []), line]);
  }
  return {
    ...row,
    recipes: recipes.map((found) => ({ ...found, ingredients: byRecipe.get(found.id) ?? [] })),
  };
}

/**
 * Puts a recipe at the end of a collection, which the caller has checked they own and may add it
 * to. One already in it keeps its place.
 */
export function addToCollection(db: Db, id: string, recipeId: string): void {
  db.transaction(
    (tx) => {
      const item = and(eq(collectionItem.collectionId, id), eq(collectionItem.recipeId, recipeId));
      if (tx.select().from(collectionItem).where(item).get()) return;
      const last = tx
        .select({ value: max(collectionItem.position) })
        .from(collectionItem)
        .where(eq(collectionItem.collectionId, id))
        .get()?.value;
      tx.insert(collectionItem)
        .values({ collectionId: id, recipeId, position: (last ?? 0) + 1 })
        .run();
    },
    // Reads, then writes, and the seed runs it beside the API.
    { behavior: 'immediate' },
  );
}

/** Takes a recipe out of a collection. One that isn't in it changes nothing. */
export function removeFromCollection(db: Db, id: string, recipeId: string): void {
  db.delete(collectionItem)
    .where(and(eq(collectionItem.collectionId, id), eq(collectionItem.recipeId, recipeId)))
    .run();
}

/**
 * Moves a recipe in one of the user's collections one place earlier or later among those they see
 * now, swapping places with that one: one they can't see keeps its own. One already at that end
 * stays. Whether the recipe is in it, for them to see.
 */
export function moveInCollection(
  db: Db,
  user: PolicyUser,
  id: string,
  recipeId: string,
  direction: (typeof MOVE_DIRECTIONS)[number],
): boolean {
  return db.transaction((tx) => {
    const items = tx
      .select({ recipeId: collectionItem.recipeId, position: collectionItem.position })
      .from(collectionItem)
      .innerJoin(recipe, eq(recipe.id, collectionItem.recipeId))
      .where(visibleIn(user, id))
      .orderBy(asc(collectionItem.position), asc(recipe.id))
      .all();
    const index = items.findIndex((item) => item.recipeId === recipeId);
    if (index < 0) return false;
    const moving = items[index];
    const passed = items[direction === 'earlier' ? index - 1 : index + 1];
    if (!moving || !passed) return true;
    const place = (item: (typeof items)[number], position: number) =>
      tx
        .update(collectionItem)
        .set({ position })
        .where(and(eq(collectionItem.collectionId, id), eq(collectionItem.recipeId, item.recipeId)))
        .run();
    place(moving, passed.position);
    place(passed, moving.position);
    return true;
  });
}

/** The IDs of `ownerId`'s collections that hold the recipe, by name. */
export function collectionsHolding(db: Db, ownerId: string, recipeId: string): string[] {
  return db
    .select({ id: collection.id })
    .from(collectionItem)
    .innerJoin(collection, eq(collection.id, collectionItem.collectionId))
    .where(and(eq(collection.ownerId, ownerId), eq(collectionItem.recipeId, recipeId)))
    .orderBy(asc(collection.nameKey), asc(collection.id))
    .all()
    .map(({ id }) => id);
}
