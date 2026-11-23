import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeDraft, recipeRevision, recipeStep } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob, enqueueUnlessWaiting } from '../jobs/queue.ts';
import { readSnapshot } from '../revisions/snapshot.ts';
import { deleteBlobsJob, UNSAVED_IMAGE_TTL_MS } from './images.ts';

/** What names photos, as a recipe's content, draft and revisions all do. */
interface NamesPhotos {
  coverImageId: string | null;
  images: readonly { id: string }[];
  steps: readonly { image: { id: string } | null }[];
}

const photoIds = ({ coverImageId, images, steps }: NamesPhotos) => [
  ...(coverImageId === null ? [] : [coverImageId]),
  ...images.map(({ id }) => id),
  ...steps.flatMap(({ image }) => (image === null ? [] : [image.id])),
];

/** Every photo of the recipe's that something shows: the recipe itself, its draft or a revision. */
function photosInUse(tx: Tx, recipeId: string): Set<string> {
  const inUse = new Set<string>();
  const add = (ids: readonly (string | null)[]) => {
    for (const id of ids) if (id !== null) inUse.add(id);
  };
  // As published: its photos have places, which these photos don't, so only the cover and steps.
  add(
    tx
      .select({ id: recipe.coverImageId })
      .from(recipe)
      .where(eq(recipe.id, recipeId))
      .all()
      .map(({ id }) => id),
  );
  add(
    tx
      .select({ id: recipeStep.imageId })
      .from(recipeStep)
      .where(eq(recipeStep.recipeId, recipeId))
      .all()
      .map(({ id }) => id),
  );
  const draft = tx
    .select({ content: recipeDraft.content })
    .from(recipeDraft)
    .where(eq(recipeDraft.recipeId, recipeId))
    .get();
  if (draft) add(photoIds(draft.content));
  for (const { snapshot } of tx
    .select({ snapshot: recipeRevision.snapshot })
    .from(recipeRevision)
    .where(eq(recipeRevision.recipeId, recipeId))
    .all()) {
    add(photoIds(readSnapshot(snapshot)));
  }
  return inUse;
}

/** The recipe's photos without a place among its photos, uploaded by `uploadedBefore`. */
const unplacedBy = (uploadedBefore: Date) =>
  and(isNotNull(image.recipeId), isNull(image.position), lte(image.createdAt, uploadedBefore));

/**
 * Deletes the recipe's photos that nothing shows and nothing can again: not the recipe, its draft
 * nor any revision. How many it deleted.
 */
function sweepRecipe(db: Db, recipeId: string, uploadedBefore: Date): number {
  return db.transaction((tx) => {
    const candidates = tx
      .select({ id: image.id, variants: image.variants })
      .from(image)
      .where(and(eq(image.recipeId, recipeId), unplacedBy(uploadedBefore)))
      .all();
    const inUse = photosInUse(tx, recipeId);
    const unused = candidates.filter(({ id }) => !inUse.has(id));
    if (unused.length === 0) return 0;
    tx.delete(image)
      .where(
        inArray(
          image.id,
          unused.map(({ id }) => id),
        ),
      )
      .run();
    enqueueJob(tx, deleteBlobsJob, {
      keys: unused.flatMap(({ variants }) => variants.map(({ key }) => key)),
    });
    return unused.length;
  });
}

/**
 * Deletes the photos recipes hold that nothing shows any more, nor can again (ADR 0004): not the
 * recipe, its draft nor any revision. They come from drafts. Saving one makes its uploads the
 * recipe's, and one discarded, or saved again without a photo, leaves it behind; a photo published
 * once stays, since its revision shows it. Only those uploaded by `uploadedBefore`, a day before it
 * was queued, as for uploads no recipe was saved with. Each recipe's in a transaction of its own.
 */
export const sweepUnusedImagesJob = defineJob({
  type: 'images.sweep-unused',
  payload: z.object({ uploadedBefore: z.iso.datetime() }),
  handle({ uploadedBefore }, { services: { db }, logger }) {
    const before = new Date(uploadedBefore);
    const recipes = db
      .selectDistinct({ recipeId: image.recipeId })
      .from(image)
      .where(unplacedBy(before))
      .all();
    let swept = 0;
    for (const { recipeId } of recipes) {
      if (recipeId !== null) swept += sweepRecipe(db, recipeId, before);
    }
    if (swept > 0) logger.info({ images: swept }, 'deleted photos nothing shows');
    return Promise.resolve();
  },
});

/** Queues a sweep, unless one is already waiting or under way. Its job's ID, either way. */
export function queueImageSweep(db: Db, now = new Date()): number {
  const uploadedBefore = new Date(now.getTime() - UNSAVED_IMAGE_TTL_MS).toISOString();
  return enqueueUnlessWaiting(db, sweepUnusedImagesJob, { uploadedBefore });
}
