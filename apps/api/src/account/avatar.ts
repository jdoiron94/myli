import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { image } from '../db/schema.ts';
import { deleteBlobsJob } from '../images/images.ts';
import { enqueueJob } from '../jobs/queue.ts';

/** The user's profile photo: its image's ID, or `null` when they have none. */
export function avatarOf(db: Db, userId: string): string | null {
  return (
    db.select({ id: image.id }).from(image).where(eq(image.avatarOf, userId)).get()?.id ?? null
  );
}

/** Deletes the user's profile photo, if they have one: its row now, its blobs in a job. */
function dropAvatar(tx: Tx, userId: string): void {
  const [dropped] = tx
    .delete(image)
    .where(eq(image.avatarOf, userId))
    .returning({ variants: image.variants })
    .all();
  if (dropped) enqueueJob(tx, deleteBlobsJob, { keys: dropped.variants.map(({ key }) => key) });
}

/**
 * Makes `imageId` the user's profile photo, deleting the one before. Only an upload of their own
 * that's in no recipe, so nobody sets anyone else's, admins included (spec §3.1). `false` for any
 * other image, or one that doesn't exist.
 */
export function setAvatar(
  db: Db,
  { userId, imageId }: { userId: string; imageId: string },
): boolean {
  return db.transaction((tx) => {
    const row = tx
      .select({ uploaderId: image.uploaderId, recipeId: image.recipeId, avatarOf: image.avatarOf })
      .from(image)
      .where(eq(image.id, imageId))
      .get();
    if (row?.uploaderId !== userId || row.recipeId !== null) return false;
    if (row.avatarOf === userId) return true;
    dropAvatar(tx, userId);
    tx.update(image).set({ avatarOf: userId }).where(eq(image.id, imageId)).run();
    return true;
  });
}

/** Deletes the user's profile photo, leaving their initials. Nothing, when they have none. */
export function removeAvatar(db: Db, userId: string): void {
  db.transaction((tx) => {
    dropAvatar(tx, userId);
  });
}
