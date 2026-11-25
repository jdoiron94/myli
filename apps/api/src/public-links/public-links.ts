import { randomBytes } from 'node:crypto';
import { type PublicLink, recipeRevisionContentSchema } from '@myli/shared';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeStep } from '../db/schema.ts';
import { auditedRecipe, loadRecipe } from '../recipes/recipes.ts';

/**
 * A recipe's public link (spec §2): an unguessable token that lets anyone see the recipe as it's
 * published, without signing in, while it's shared, out of the trash and the link isn't revoked.
 * The token is kept as it is, so whoever may share the recipe can copy the link again. It travels
 * in the link's path, which images need, and is never logged (ADR 0016).
 */

/** 256 random bits, as 43 URL-safe characters. */
const newToken = () => randomBytes(32).toString('base64url');

/** A live, shared recipe with this token: one its link may show. */
const openedBy = (token: string) =>
  and(eq(recipe.publicToken, token), eq(recipe.visibility, 'shared'), isNull(recipe.deletedAt));

/** The recipe's public link, `null` if it has none. */
export function findPublicLink(db: Db | Tx, recipeId: string): PublicLink | null {
  const row = db
    .select({ token: recipe.publicToken })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
    .get();
  const token = row?.token ?? null;
  return token === null ? null : { token };
}

/**
 * Gives a shared recipe a public link, which the caller has checked they may (`recipe.share`): a
 * new one, recorded in the audit log, or the one it has. Never changes the recipe's version, since
 * what it says doesn't change.
 */
export function createPublicLink(db: Db, origin: AuditOrigin, recipeId: string): PublicLink {
  return db.transaction((tx) => {
    const existing = findPublicLink(tx, recipeId);
    if (existing) return existing;
    const token = newToken();
    const [shared] = tx
      .update(recipe)
      .set({ publicToken: token, updatedAt: sql`${recipe.updatedAt}` })
      .where(
        and(eq(recipe.id, recipeId), eq(recipe.visibility, 'shared'), isNull(recipe.deletedAt)),
      )
      .returning({ title: recipe.title, visibility: recipe.visibility })
      .all();
    if (!shared) throw new Error('only a live, shared recipe can have a public link');
    recordAuditEvent(tx, origin, {
      action: 'public_link.created',
      target: { type: 'recipe', id: recipeId },
      metadata: auditedRecipe(shared),
    });
    return { token };
  });
}

/**
 * Takes away a recipe's public link, if it has one, which the caller has checked they may
 * (`recipe.share`): anyone who has it can no longer open it. Recorded in the audit log. Making the
 * recipe private takes it away too (`setRecipeVisibility`).
 */
export function revokePublicLink(db: Db, origin: AuditOrigin, recipeId: string): void {
  db.transaction((tx) => {
    const [revoked] = tx
      .update(recipe)
      .set({ publicToken: null, updatedAt: sql`${recipe.updatedAt}` })
      .where(and(eq(recipe.id, recipeId), isNotNull(recipe.publicToken)))
      .returning({ title: recipe.title, visibility: recipe.visibility })
      .all();
    if (!revoked) return;
    recordAuditEvent(tx, origin, {
      action: 'public_link.revoked',
      target: { type: 'recipe', id: recipeId },
      metadata: auditedRecipe(revoked),
    });
  });
}

/**
 * What a public link shows: what its recipe says, as published, `undefined` if it shows none now.
 * Only that: the schema leaves out everything else the recipe has, like who wrote it, which the
 * response wouldn't (Hono doesn't strip what a response schema leaves out).
 */
export function findPublicRecipe(db: Db, token: string) {
  const row = db.select({ id: recipe.id }).from(recipe).where(openedBy(token)).get();
  const loaded = row && loadRecipe(db, row.id);
  return loaded && recipeRevisionContentSchema.parse(loaded);
}

/**
 * A photo the recipe a public link shows uses as published: one of its photos or a step's. Not one
 * only its older revisions or its draft use, nor anyone else's. `undefined` otherwise.
 */
export function findPublicPhoto(db: Db, token: string, imageId: string) {
  return db
    .select({ variants: image.variants })
    .from(image)
    .innerJoin(recipe, eq(recipe.id, image.recipeId))
    .leftJoin(recipeStep, and(eq(recipeStep.recipeId, recipe.id), eq(recipeStep.imageId, image.id)))
    .where(
      and(
        eq(image.id, imageId),
        openedBy(token),
        or(isNotNull(image.position), isNotNull(recipeStep.imageId)),
      ),
    )
    .get();
}
