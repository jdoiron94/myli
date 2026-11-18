import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { BlobStore } from '../blobs/store.ts';
import type { Db } from '../db/database.ts';
import { image, recipe } from '../db/schema.ts';

/** A plain image of `width` × `height` pixels, as a file of `format`, for upload tests. */
export function testImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c0784a' } })
    .toFormat(format)
    .toBuffer();
}

/**
 * A 64 × 48 photo stored straight in the database and blob store, belonging to `recipeId` and
 * uploaded by its owner. Its ID.
 */
export async function insertRecipeImage(
  t: { db: Db; blobs: BlobStore },
  recipeId: string,
): Promise<string> {
  const id = randomUUID();
  const key = `images/${id}/64.webp`;
  const owner = t.db
    .select({ ownerId: recipe.ownerId })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .get();
  if (!owner) throw new Error(`no recipe ${recipeId}`);
  await t.blobs.put(key, await testImage(64, 48, 'webp'), { contentType: 'image/webp' });
  t.db
    .insert(image)
    .values({
      id,
      recipeId,
      uploaderId: owner.ownerId,
      mime: 'image/webp',
      width: 64,
      height: 48,
      variants: [{ width: 64, height: 48, key }],
    })
    .run();
  return id;
}
