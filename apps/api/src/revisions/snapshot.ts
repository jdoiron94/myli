import { type Recipe, recipeSchema } from '@myli/shared';
import { eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../db/database.ts';
import { recipeRevision } from '../db/schema.ts';

/** A photo as a revision keeps it: which one, and its alt text then. */
const snapshotPhotoSchema = z.object({ id: z.string(), alt: z.string() });

/**
 * A recipe's content as a revision stores it (ADR 0007): everything a save sets, its tags with the
 * names they had, and its photos by ID with the alt text they had. Not its owner or visibility,
 * which saving doesn't change.
 *
 * Stored snapshots are never rewritten. When this format changes, bump `schemaVersion` and make
 * `readSnapshot` upgrade the ones before, step by step; the test of a stored snapshot fails until
 * then.
 */
export const recipeSnapshotSchema = recipeSchema
  .pick({
    title: true,
    description: true,
    source: true,
    equipment: true,
    yield: true,
    servings: true,
    prepMinutes: true,
    cookMinutes: true,
    totalMinutes: true,
    difficulty: true,
    nutrition: true,
    ingredientGroups: true,
    tags: true,
    coverImageId: true,
  })
  .extend({
    schemaVersion: z.literal(1),
    images: z.array(snapshotPhotoSchema),
    steps: z.array(z.object({ body: z.string(), image: snapshotPhotoSchema.nullable() })),
  });

export type RecipeSnapshot = z.infer<typeof recipeSnapshotSchema>;

/**
 * The snapshot of a recipe as `loadRecipe` reads it. Parsing leaves out what isn't content, and
 * all of each photo but its ID and alt text.
 */
export function snapshotOf(recipe: Recipe): RecipeSnapshot {
  return recipeSnapshotSchema.parse({ ...recipe, schemaVersion: 1 });
}

/** A stored snapshot, as the current version of the format. */
export function readSnapshot(stored: unknown): RecipeSnapshot {
  return recipeSnapshotSchema.parse(stored);
}

/**
 * Records `published`, the recipe as a save has just left it, as its next revision, by
 * `authorId`. Call it in the transaction of that save. Its number.
 */
export function recordRevision(
  tx: Tx,
  published: Recipe,
  authorId: string,
  message: string | null = null,
): number {
  const latest = tx
    .select({ number: max(recipeRevision.number) })
    .from(recipeRevision)
    .where(eq(recipeRevision.recipeId, published.id))
    .get();
  const number = (latest?.number ?? 0) + 1;
  tx.insert(recipeRevision)
    .values({ recipeId: published.id, number, snapshot: snapshotOf(published), authorId, message })
    .run();
  return number;
}
