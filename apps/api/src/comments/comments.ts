import type { Comment, PolicyComment } from '@myli/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { avatarColumn } from '../account/avatar.ts';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db } from '../db/database.ts';
import { comment, recipe, user } from '../db/schema.ts';
import { auditedRecipe } from '../recipes/recipes.ts';

const columns = {
  id: comment.id,
  authorId: comment.authorId,
  authorName: user.name,
  authorAvatar: avatarColumn(comment.authorId),
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
  authorAvatar: string | null;
  bodyMd: string;
  createdAt: Date;
  editedAt: Date | null;
}): Comment {
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName, avatar: row.authorAvatar },
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

/**
 * Deletes a comment for good, and records it in the audit log, in one transaction: who wrote it and
 * on which recipe, named by its title only while it's shared. Not what it said, since it's gone.
 */
export function deleteComment(db: Db, origin: AuditOrigin, id: string): void {
  db.transaction((tx) => {
    const deleted = tx
      .select({
        recipeId: comment.recipeId,
        authorId: comment.authorId,
        authorName: user.name,
        title: recipe.title,
        visibility: recipe.visibility,
      })
      .from(comment)
      .innerJoin(user, eq(user.id, comment.authorId))
      .innerJoin(recipe, eq(recipe.id, comment.recipeId))
      .where(eq(comment.id, id))
      .get();
    if (!deleted) return;
    tx.delete(comment).where(eq(comment.id, id)).run();
    recordAuditEvent(tx, origin, {
      action: 'comment.deleted',
      target: { type: 'recipe', id: deleted.recipeId },
      metadata: {
        ...auditedRecipe(deleted),
        comment: { id, author: { id: deleted.authorId, name: deleted.authorName } },
      },
    });
  });
}
