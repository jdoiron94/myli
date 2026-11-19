import type { RecipeContent, RecipeDraft } from '@myli/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeDraft, user } from '../db/schema.ts';
import { toImage } from '../images/images.ts';
import {
  atVersion,
  type ContentRefusal,
  liveAt,
  photoUses,
  refusedContent,
  type WriteResult,
} from '../recipes/recipes.ts';
import { latestRevision } from '../revisions/snapshot.ts';

/**
 * Drafts (spec §3.3): one working copy per recipe, which anyone who may edit the recipe can
 * continue, while the published recipe stays as it is. Publishing (`updateRecipe`) replaces it.
 * Every change to it moves the recipe's version on (ADR 0007), so two people saving the same draft
 * can't overwrite each other unknowingly.
 */

/** The recipe's draft, with what showing it takes, or `null` if it has none. */
export function loadDraft(db: Db | Tx, recipeId: string): RecipeDraft | null {
  const found = db
    .select({ draft: recipeDraft, authorName: user.name, version: recipe.version })
    .from(recipeDraft)
    .innerJoin(user, eq(user.id, recipeDraft.authorId))
    .innerJoin(recipe, eq(recipe.id, recipeDraft.recipeId))
    .where(eq(recipeDraft.recipeId, recipeId))
    .get();
  if (!found) return null;
  const { draft, authorName, version } = found;

  const ids = photoUses(draft.content).map(({ id }) => id);
  // Only the recipe's own: a draft can't show another recipe's photo, whatever it holds.
  const rows =
    ids.length === 0
      ? []
      : db
          .select()
          .from(image)
          .where(and(inArray(image.id, ids), eq(image.recipeId, recipeId)))
          .all();
  const byId = new Map(rows.map((row) => [row.id, toImage(row)]));
  return {
    content: draft.content,
    photos: ids.flatMap((id) => byId.get(id) ?? []),
    author: { id: draft.authorId, name: authorName },
    updatedAt: draft.updatedAt.toISOString(),
    revision: draft.revision,
    version,
  };
}

/** Moves the recipe on from `version` without changing what's published, when it was last saved. */
function nextVersion(tx: Tx, recipeId: string, version: number) {
  tx.update(recipe)
    .set({ version: version + 1, updatedAt: sql`${recipe.updatedAt}` })
    .where(liveAt(recipeId, version))
    .run();
}

/**
 * Saves `content` as the recipe's draft, by `editorId`, if the recipe is still at `version`. Its
 * photos are checked as publishing it would check them. The uploads it names become the recipe's,
 * in no place, so they aren't discarded after a day and whoever continues the draft sees them.
 */
export function saveDraft(
  db: Db,
  recipeId: string,
  content: RecipeContent,
  editorId: string,
  version: number,
): WriteResult | ContentRefusal {
  return db.transaction((tx): WriteResult | ContentRefusal => {
    const current = atVersion(tx, recipeId, version);
    if (!current.ok) return current;
    const refused = refusedContent(tx, recipeId, editorId, content);
    if (refused) return refused;

    const named = photoUses(content).map(({ id }) => id);
    if (named.length > 0) {
      tx.update(image)
        .set({ recipeId })
        .where(and(inArray(image.id, named), isNull(image.recipeId)))
        .run();
    }
    tx.insert(recipeDraft)
      .values({ recipeId, content, revision: latestRevision(tx, recipeId), authorId: editorId })
      .onConflictDoUpdate({
        target: recipeDraft.recipeId,
        set: { content, authorId: editorId, updatedAt: new Date() },
      })
      .run();
    nextVersion(tx, recipeId, version);
    return { ok: true };
  });
}

/** Discards the recipe's draft, if it's still at `version`. Without a draft, nothing changes. */
export function discardDraft(db: Db, recipeId: string, version: number): WriteResult {
  return db.transaction((tx): WriteResult => {
    const current = atVersion(tx, recipeId, version);
    if (!current.ok) return current;
    const [discarded] = tx
      .delete(recipeDraft)
      .where(eq(recipeDraft.recipeId, recipeId))
      .returning({ recipeId: recipeDraft.recipeId })
      .all();
    if (discarded) nextVersion(tx, recipeId, version);
    return { ok: true };
  });
}
