import type { Note } from '@myli/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { userNote } from '../db/schema.ts';

const noteRow = (userId: string, recipeId: string) =>
  and(eq(userNote.userId, userId), eq(userNote.recipeId, recipeId));

/** `userId`'s note on the recipe, `null` if they have none. */
export function findNote(db: Db, userId: string, recipeId: string): Note | null {
  const row = db
    .select({ body: userNote.bodyMd, updatedAt: userNote.updatedAt })
    .from(userNote)
    .where(noteRow(userId, recipeId))
    .get();
  return row ? { body: row.body, updatedAt: row.updatedAt.toISOString() } : null;
}

/** Writes `userId`'s note on the recipe, or replaces it. */
export function saveNote(db: Db, userId: string, recipeId: string, body: string): Note {
  const now = new Date();
  db.insert(userNote)
    .values({ userId, recipeId, bodyMd: body, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [userNote.userId, userNote.recipeId],
      set: { bodyMd: body, updatedAt: now },
    })
    .run();
  return { body, updatedAt: now.toISOString() };
}

/** Deletes `userId`'s note on the recipe. With none, it changes nothing. */
export function deleteNote(db: Db, userId: string, recipeId: string): void {
  db.delete(userNote).where(noteRow(userId, recipeId)).run();
}
