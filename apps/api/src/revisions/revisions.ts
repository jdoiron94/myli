import {
  type Avatar,
  type RecipeRevision,
  type RecipeRevisionSummary,
  recipeContentSchema,
  recipeRevisionContentSchema,
  restoredMessage,
} from '@myli/shared';
import { and, desc, eq, inArray, notExists } from 'drizzle-orm';
import { avatarColumn } from '../account/avatar.ts';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeRevision, tag, user } from '../db/schema.ts';
import { toImage } from '../images/images.ts';
import {
  atVersion,
  auditedRecipe,
  loadRecipe,
  publishContent,
  type WriteResult,
} from '../recipes/recipes.ts';
import { latestRevision, readSnapshot, snapshotOf } from './snapshot.ts';

/** The message of the first revision of a recipe saved before revisions were kept. */
export const BACKFILLED_MESSAGE = 'As it was when myli started keeping revisions.';

/**
 * Gives each recipe saved before revisions were kept, deleted ones included, its first revision:
 * the recipe as it is, by its owner, dated when it was last changed. The API runs it on startup,
 * after the migrations; once every recipe has a revision, it does nothing. How many it gave one.
 */
export function backfillRevisions(db: Db): number {
  return db.transaction((tx) => {
    const missing = tx
      .select({ id: recipe.id, ownerId: recipe.ownerId, updatedAt: recipe.updatedAt })
      .from(recipe)
      .where(
        notExists(
          tx
            .select({ id: recipeRevision.id })
            .from(recipeRevision)
            .where(eq(recipeRevision.recipeId, recipe.id)),
        ),
      )
      .all();
    for (const { id, ownerId, updatedAt } of missing) {
      const current = loadRecipe(tx, id, { includeDeleted: true });
      // Read in this transaction, which nothing else can write in.
      if (!current) throw new Error('a recipe to backfill could not be read');
      tx.insert(recipeRevision)
        .values({
          recipeId: id,
          number: 1,
          snapshot: snapshotOf(current),
          authorId: ownerId,
          message: BACKFILLED_MESSAGE,
          createdAt: updatedAt,
        })
        .run();
    }
    return missing.length;
  });
}

/** The recipe's history, newest first: the published revision comes first. */
export function listRevisions(db: Db, recipeId: string): RecipeRevisionSummary[] {
  return db
    .select(revisionColumns)
    .from(recipeRevision)
    .innerJoin(user, eq(user.id, recipeRevision.authorId))
    .where(eq(recipeRevision.recipeId, recipeId))
    .orderBy(desc(recipeRevision.number))
    .all()
    .map(({ row, authorName, authorAvatar }) => summaryOf(row, authorName, authorAvatar));
}

const revisionColumns = {
  row: recipeRevision,
  authorName: user.name,
  authorAvatar: avatarColumn(recipeRevision.authorId),
};

function summaryOf(
  row: typeof recipeRevision.$inferSelect,
  authorName: string,
  authorAvatar: Avatar | null,
): RecipeRevisionSummary {
  return {
    number: row.number,
    author: { id: row.authorId, name: authorName, avatar: authorAvatar },
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The stored revision `number` of the recipe, with its author, if there is one. */
function findRevision(db: Db | Tx, recipeId: string, number: number) {
  return db
    .select(revisionColumns)
    .from(recipeRevision)
    .innerJoin(user, eq(user.id, recipeRevision.authorId))
    .where(and(eq(recipeRevision.recipeId, recipeId), eq(recipeRevision.number, number)))
    .get();
}

/**
 * Revision `number` of the recipe, its photos whole, with the alt text they had then. `undefined`
 * if the recipe has no such revision.
 */
export function loadRevision(db: Db, recipeId: string, number: number): RecipeRevision | undefined {
  const found = findRevision(db, recipeId, number);
  if (!found) return undefined;
  const snapshot = readSnapshot(found.row.snapshot);

  const ids = [
    ...snapshot.images.map(({ id }) => id),
    ...snapshot.steps.flatMap(({ image: photo }) => (photo ? [photo.id] : [])),
  ];
  // Only the recipe's own, which it keeps while a revision shows them.
  const rows =
    ids.length === 0
      ? []
      : db
          .select()
          .from(image)
          .where(and(inArray(image.id, ids), eq(image.recipeId, recipeId)))
          .all();
  const byId = new Map(rows.map((row) => [row.id, toImage(row)]));
  const whole = ({ id, alt }: { id: string; alt: string }) => {
    const photo = byId.get(id);
    return photo && { ...photo, alt };
  };

  return {
    ...summaryOf(found.row, found.authorName, found.authorAvatar),
    // Parsing leaves out the format's version.
    content: recipeRevisionContentSchema.parse({
      ...snapshot,
      images: snapshot.images.flatMap((photo) => whole(photo) ?? []),
      steps: snapshot.steps.map(({ body, image: photo }) => ({
        body,
        image: (photo && whole(photo)) ?? null,
      })),
    }),
  };
}

export type RestoreResult =
  | { ok: true; revision: number }
  | WriteResult
  | { ok: false; reason: 'no-revision' }
  | { ok: false; reason: 'unrestorable' };

/**
 * Publishes revision `number`'s content as the recipe's next revision, by `editorId`, with the
 * message "Restored from revision #n", if the recipe is still at `version`. Its draft stays. Tags
 * deleted since are left out. The audit event shows admins a shared recipe's title, but never a
 * private one's, as deleting it does.
 */
export function restoreRevision(
  db: Db,
  origin: AuditOrigin,
  recipeId: string,
  number: number,
  editorId: string,
  version: number,
): RestoreResult {
  return db.transaction((tx): RestoreResult => {
    const current = atVersion(tx, recipeId, version);
    if (!current.ok) return current;
    const found = findRevision(tx, recipeId, number);
    if (!found) return { ok: false, reason: 'no-revision' };
    const snapshot = readSnapshot(found.row.snapshot);

    const tagIds = snapshot.tags.map(({ id }) => id);
    const existing = new Set(
      tagIds.length === 0
        ? []
        : tx
            .select({ id: tag.id })
            .from(tag)
            .where(inArray(tag.id, tagIds))
            .all()
            .map(({ id }) => id),
    );
    // Parsing leaves out what the content doesn't hold, such as what the server worked out.
    const content = recipeContentSchema.safeParse({
      ...snapshot,
      tagIds: tagIds.filter((id) => existing.has(id)),
    });
    if (!content.success) return { ok: false, reason: 'unrestorable' };

    const published = publishContent(tx, recipeId, content.data, editorId, version, {
      message: restoredMessage(number),
      keepDraft: true,
    });
    if (!published.ok) {
      if (published.reason === 'not-found' || published.reason === 'stale') return published;
      // Its photos are the recipe's own, kept for its revisions; its tags exist.
      return { ok: false, reason: 'unrestorable' };
    }

    const restored = latestRevision(tx, recipeId);
    const row = tx
      .select({ title: recipe.title, visibility: recipe.visibility })
      .from(recipe)
      .where(eq(recipe.id, recipeId))
      .get();
    // Written in this transaction: only a bug could lose it.
    if (!row) throw new Error('a recipe just restored could not be read back');
    recordAuditEvent(tx, origin, {
      action: 'revision.restored',
      target: { type: 'recipe', id: recipeId },
      metadata: { restored: number, revision: restored, ...auditedRecipe(row) },
    });
    return { ok: true, revision: restored };
  });
}
