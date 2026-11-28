import type { Avatar } from '@myli/shared';
import { eq, getTableName, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db, Tx } from '../db/database.ts';
import { image, user } from '../db/schema.ts';
import { deleteBlobsJob } from '../images/images.ts';
import { enqueueJob } from '../jobs/queue.ts';

/**
 * The profile photo of the user `userId` refers to, as a column to select beside them, or `null`.
 * One query names everyone it shows with what goes beside their name.
 */
export function avatarColumn(userId: SQLiteColumn): SQL<Avatar | null> {
  // Every name spelled out with its table: in a query on one table, drizzle writes its columns
  // without one, and in here `id` would then mean the photo's own.
  const name = (table: string, column: SQLiteColumn) =>
    sql`${sql.identifier(table)}.${sql.identifier(column.name)}`;
  const owner = name(getTableName(userId.table), userId);
  const avatar = sql.identifier('avatar');
  const narrowest = sql`(select min(json_extract(value, '$.width')) from json_each(${name('avatar', image.variants)}))`;
  const photo = sql`json_object('id', ${name('avatar', image.id)}, 'width', ${narrowest})`;
  // drizzle passes null by without decoding it.
  return sql`(select ${photo} from ${image} as ${avatar} where ${name('avatar', image.avatarOf)} = ${owner})`.mapWith(
    (value: string): Avatar | null => JSON.parse(value) as Avatar,
  );
}

/** The user's profile photo, or `null` when they have none. */
export function avatarOf(db: Db, userId: string): Avatar | null {
  const found = db
    .select({ avatar: avatarColumn(user.id) })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  return found?.avatar ?? null;
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
