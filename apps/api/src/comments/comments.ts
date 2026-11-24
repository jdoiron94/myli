import type { Comment, PolicyComment } from '@myli/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { comment, recipe, user } from '../db/schema.ts';

const columns = {
  id: comment.id,
  authorId: comment.authorId,
  authorName: user.name,
  bodyMd: comment.bodyMd,
  createdAt: comment.createdAt,
  editedAt: comment.editedAt,
};

function selectComments(db: Db) {
  return db.select(columns).from(comment).innerJoin(user, eq(user.id, comment.authorId));
}

function toComment(row: {
  id: string;
  authorId: string;
  authorName: string;
  bodyMd: string;
  createdAt: Date;
  editedAt: Date | null;
}): Comment {
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName },
    body: row.bodyMd,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

/** A recipe's comments, oldest first: those written in the same millisecond in the order saved. */
export function recipeComments(db: Db, recipeId: string): Comment[] {
  return selectComments(db)
    .where(eq(comment.recipeId, recipeId))
    .orderBy(asc(comment.createdAt), asc(sql`${comment}.rowid`))
    .all()
    .map(toComment);
}

function loadComment(db: Db, id: string): Comment {
  const row = selectComments(db).where(eq(comment.id, id)).get();
  // Called only with a comment just written, by the same connection.
  if (!row) throw new Error('a comment just written could not be read back');
  return toComment(row);
}

/**
 * What authorizing an action on a comment needs, with its recipe. `undefined` if the comment is
 * gone or its recipe is in the trash.
 */
export function findCommentAccess(db: Db, id: string): PolicyComment | undefined {
  const row = db
    .select({
      authorId: comment.authorId,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
    })
    .from(comment)
    .innerJoin(recipe, eq(recipe.id, comment.recipeId))
    .where(and(eq(comment.id, id), isNull(recipe.deletedAt)))
    .get();
  return (
    row && { authorId: row.authorId, recipe: { ownerId: row.ownerId, visibility: row.visibility } }
  );
}

export function addComment(db: Db, recipeId: string, authorId: string, body: string): Comment {
  const { id } = db
    .insert(comment)
    .values({ recipeId, authorId, bodyMd: body })
    .returning({ id: comment.id })
    .get();
  return loadComment(db, id);
}

/** Changes what a comment says. It's marked as edited only if that changed. */
export function editComment(db: Db, id: string, body: string): Comment {
  db.update(comment)
    .set({ bodyMd: body, editedAt: new Date() })
    .where(and(eq(comment.id, id), ne(comment.bodyMd, body)))
    .run();
  return loadComment(db, id);
}

export function deleteComment(db: Db, id: string): void {
  db.delete(comment).where(eq(comment.id, id)).run();
}
