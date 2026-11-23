import { can, type PolicyUser, type TrashedRecipe } from '@myli/shared';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db } from '../db/database.ts';
import { recipe, user } from '../db/schema.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { auditedRecipe, type WriteResult } from '../recipes/recipes.ts';
import { indexRecipeJob } from '../search/indexing.ts';

/**
 * The trash (spec §3.2): deleting a recipe (`deleteRecipe`) moves it here, hidden everywhere else,
 * until it's restored, or purged once it has been here `TRASH_RETENTION_DAYS`. Only whoever may
 * restore it (`recipe.trash`) sees it: its owner, and admins while it's shared.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** When a recipe deleted at `deletedAt` is due to be deleted for good. */
export const purgeDate = (deletedAt: Date, retentionDays: number) =>
  new Date(deletedAt.getTime() + retentionDays * DAY_MS);

/**
 * The recipes in the trash that `reader` may restore, most recently deleted first. Each is checked
 * with `can()` itself rather than a restatement in SQL: the trash holds only what was deleted in
 * the last `retentionDays`, few enough to read in full.
 */
export function listTrash(db: Db, reader: PolicyUser, retentionDays: number): TrashedRecipe[] {
  return db
    .select({
      id: recipe.id,
      title: recipe.title,
      visibility: recipe.visibility,
      ownerId: recipe.ownerId,
      ownerName: user.name,
      deletedAt: recipe.deletedAt,
      version: recipe.version,
    })
    .from(recipe)
    .innerJoin(user, eq(user.id, recipe.ownerId))
    .where(isNotNull(recipe.deletedAt))
    .orderBy(desc(recipe.deletedAt), asc(recipe.id))
    .all()
    .flatMap((row) =>
      row.deletedAt && can(reader, 'recipe.trash', row)
        ? [
            {
              id: row.id,
              title: row.title,
              visibility: row.visibility,
              owner: { id: row.ownerId, name: row.ownerName },
              deletedAt: row.deletedAt.toISOString(),
              purgeAt: purgeDate(row.deletedAt, retentionDays).toISOString(),
              version: row.version,
            },
          ]
        : [],
    );
}

/**
 * Takes a recipe out of the trash, if it's still at `version`, as it was: who sees it, its draft,
 * history, photos and favorites, and when it was last changed. Refused if it isn't in the trash.
 * The audit event names it as deleting it did.
 */
export function restoreRecipe(
  db: Db,
  origin: AuditOrigin,
  id: string,
  version: number,
): WriteResult {
  return db.transaction((tx): WriteResult => {
    const inTrash = and(eq(recipe.id, id), isNotNull(recipe.deletedAt));
    const row = tx
      .select({ version: recipe.version, title: recipe.title, visibility: recipe.visibility })
      .from(recipe)
      .where(inTrash)
      .get();
    if (!row) return { ok: false, reason: 'not-found' };
    if (row.version !== version) return { ok: false, reason: 'stale' };
    tx.update(recipe)
      .set({ deletedAt: null, version: version + 1, updatedAt: sql`${recipe.updatedAt}` })
      .where(and(inTrash, eq(recipe.version, version)))
      .run();
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    recordAuditEvent(tx, origin, {
      action: 'recipe.restored',
      target: { type: 'recipe', id },
      metadata: auditedRecipe(row),
    });
    return { ok: true };
  });
}
