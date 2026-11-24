import {
  COLLECTION_MAX_RECIPES,
  type Collection,
  type CollectionSummary,
  type PolicyUser,
  tagNameKey,
} from '@myli/shared';
import { and, asc, count, eq, max } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { collection, collectionItem, recipe } from '../db/schema.ts';
import { readableBy, recipeSummaries, SUMMARY_COLUMNS } from '../recipes/list.ts';

const owned = (ownerId: string, id: string) =>
  and(eq(collection.id, id), eq(collection.ownerId, ownerId));

/** Whether `ownerId` has a collection with this ID. No one else's is ever found, admins' included. */
export function ownsCollection(db: Db | Tx, ownerId: string, id: string): boolean {
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

/** The recipes in a collection the user may see now, in its order. */
function visibleItems(db: Db | Tx, user: PolicyUser, id: string) {
  return db
    .select(SUMMARY_COLUMNS)
    .from(collectionItem)
    .innerJoin(recipe, eq(recipe.id, collectionItem.recipeId))
    .where(and(eq(collectionItem.collectionId, id), readableBy(user)))
    .orderBy(asc(collectionItem.position), asc(recipe.id))
    .all();
}

/** One of the user's collections, with the recipes in it they may see now, `null` if none. */
export function loadCollection(db: Db, user: PolicyUser, id: string): Collection | null {
  const row = db
    .select({ id: collection.id, name: collection.name })
    .from(collection)
    .where(owned(user.id, id))
    .get();
  if (!row) return null;
  return { ...row, recipes: recipeSummaries(db, user, visibleItems(db, user, id)) };
}

/**
 * Puts a recipe at the end of a collection, which the caller has checked they own and may add it
 * to. One already in it keeps its place.
 */
export function addToCollection(
  db: Db,
  id: string,
  recipeId: string,
): { ok: true } | { ok: false; reason: 'full' } {
  return db.transaction(
    (tx) => {
      const item = and(eq(collectionItem.collectionId, id), eq(collectionItem.recipeId, recipeId));
      if (tx.select().from(collectionItem).where(item).get()) return { ok: true };
      const { held, last } = tx
        .select({ held: count(), last: max(collectionItem.position) })
        .from(collectionItem)
        .where(eq(collectionItem.collectionId, id))
        .get() ?? { held: 0, last: null };
      // Recipes the owner can't see now count too: they're still in it.
      if (held >= COLLECTION_MAX_RECIPES) return { ok: false, reason: 'full' };
      tx.insert(collectionItem)
        .values({ collectionId: id, recipeId, position: (last ?? 0) + 1 })
        .run();
      return { ok: true };
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
 * Puts the recipes the user sees in one of their collections in a new order, given as every one of
 * them, each once. They take the places those recipes had, so one the user can't see now keeps its
 * own. Refused when the IDs aren't exactly those recipes, as when it changed since it was loaded.
 */
export function reorderCollection(
  db: Db,
  user: PolicyUser,
  id: string,
  recipeIds: readonly string[],
): { ok: true } | { ok: false; reason: 'mismatch' } {
  return db.transaction((tx) => {
    const visible = new Set(visibleItems(tx, user, id).map((row) => row.id));
    const given = new Set(recipeIds);
    if (
      given.size !== recipeIds.length ||
      given.size !== visible.size ||
      recipeIds.some((recipeId) => !visible.has(recipeId))
    ) {
      return { ok: false, reason: 'mismatch' };
    }
    const places = tx
      .select({ recipeId: collectionItem.recipeId, position: collectionItem.position })
      .from(collectionItem)
      .where(eq(collectionItem.collectionId, id))
      .orderBy(asc(collectionItem.position), asc(collectionItem.recipeId))
      .all()
      .filter((item) => visible.has(item.recipeId))
      .map((item) => item.position);
    recipeIds.forEach((recipeId, index) => {
      tx.update(collectionItem)
        .set({ position: places[index] })
        .where(and(eq(collectionItem.collectionId, id), eq(collectionItem.recipeId, recipeId)))
        .run();
    });
    return { ok: true };
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
