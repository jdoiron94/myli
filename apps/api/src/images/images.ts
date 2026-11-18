import { randomUUID } from 'node:crypto';
import type { Image } from '@myli/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { BlobStore } from '../blobs/store.ts';
import type { Db } from '../db/database.ts';
import { image, type StoredImageVariant } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { ProcessedImage } from './process.ts';

/** How long an upload waits for a recipe to be saved with it before it's deleted: a day. */
export const UNSAVED_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Deletes blobs nothing refers to any more. Deleting one that's gone already is fine. */
export const deleteBlobsJob = defineJob({
  type: 'blobs.delete',
  payload: z.object({ keys: z.array(z.string()).min(1) }),
  async handle({ keys }, { services }) {
    for (const key of keys) await services.blobs.delete(key);
  },
});

/**
 * Deletes an upload no recipe was saved with, a day after it was uploaded. The row goes in the
 * same transaction that checks it's still unsaved, so a save can't take it meanwhile; its blobs
 * go in a job of their own.
 */
export const discardUnsavedImageJob = defineJob({
  type: 'images.discard-unsaved',
  payload: z.object({ imageId: z.string() }),
  handle({ imageId }, { services }) {
    services.db.transaction((tx) => {
      const discarded = tx
        .delete(image)
        .where(and(eq(image.id, imageId), isNull(image.recipeId)))
        .returning({ variants: image.variants })
        .get();
      if (discarded) {
        enqueueJob(tx, deleteBlobsJob, { keys: discarded.variants.map(({ key }) => key) });
      }
    });
    return Promise.resolve();
  },
});

/** An image as the API answers with it. */
export const toImage = (row: {
  id: string;
  width: number;
  height: number;
  variants: StoredImageVariant[];
}): Image => ({
  id: row.id,
  width: row.width,
  height: row.height,
  variants: row.variants.map(({ width, height }) => ({ width, height })),
});

/**
 * Stores a processed upload as `uploaderId`'s, belonging to no recipe yet: its blobs first, then
 * its row, with the job that deletes it if no recipe is saved with it.
 */
export async function saveUpload(
  deps: { db: Db; blobs: BlobStore },
  uploaderId: string,
  upload: ProcessedImage,
  now = new Date(),
): Promise<Image> {
  const id = randomUUID();
  const variants = upload.variants.map(({ width, height, bytes }) => ({
    width,
    height,
    key: `images/${id}/${String(width)}.webp`,
    bytes,
  }));
  const stored: string[] = [];
  try {
    for (const { key, bytes } of variants) {
      await deps.blobs.put(key, bytes, { contentType: 'image/webp' });
      stored.push(key);
    }
    deps.db.transaction((tx) => {
      tx.insert(image)
        .values({
          id,
          uploaderId,
          mime: upload.type,
          width: upload.width,
          height: upload.height,
          variants: variants.map(({ width, height, key }) => ({ width, height, key })),
        })
        .run();
      enqueueJob(
        tx,
        discardUnsavedImageJob,
        { imageId: id },
        { runAfter: new Date(now.getTime() + UNSAVED_IMAGE_TTL_MS) },
      );
    });
  } catch (error) {
    // Nothing refers to the blobs stored so far: take them away again, as far as possible.
    await Promise.allSettled(stored.map((key) => deps.blobs.delete(key)));
    throw error;
  }
  return toImage({ id, width: upload.width, height: upload.height, variants });
}
