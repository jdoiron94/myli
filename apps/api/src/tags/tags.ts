import {
  type PolicyUser,
  TAG_TYPES,
  type Tag,
  type TagType,
  type TagUsage,
  tagNameKey,
} from '@myli/shared';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import { recipe, recipeTag, tag } from '../db/schema.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { readableBy } from '../recipes/list.ts';
import { indexRecipeJob } from '../search/indexing.ts';

/**
 * Tags (spec §3.2). Editors create them as they tag recipes; admins rename, merge and delete them.
 * The allergen tags are seeded and never change.
 */

const TAG_COLUMNS = { id: tag.id, type: tag.type, name: tag.name };

/** How tags are listed everywhere: by type in `TAG_TYPES` order, then by name. */
export function byTypeThenName(
  a: { type: TagType; nameKey: string },
  b: { type: TagType; nameKey: string },
): number {
  return (
    TAG_TYPES.indexOf(a.type) - TAG_TYPES.indexOf(b.type) || a.nameKey.localeCompare(b.nameKey)
  );
}

/** Every tag, or every tag of one type, by type and then name. */
export function listTags(db: Db, type?: TagType): Tag[] {
  const rows = db
    .select({ ...TAG_COLUMNS, nameKey: tag.nameKey })
    .from(tag)
    .where(type === undefined ? undefined : eq(tag.type, type))
    .all();
  return rows
    .sort(byTypeThenName)
    .map(({ id, type: tagType, name }) => ({ id, type: tagType, name }));
}

/**
 * The tag of this type with this name, created if there isn't one yet. Names that differ only in
 * case or spacing are the same tag (`tagNameKey`), so "italian" finds "Italian".
 */
export function findOrCreateTag(
  db: Db,
  type: Exclude<TagType, 'allergen'>,
  name: string,
): { tag: Tag; created: boolean } {
  const nameKey = tagNameKey(name);
  return db.transaction(
    (tx) => {
      const existing = tx
        .select(TAG_COLUMNS)
        .from(tag)
        .where(and(eq(tag.type, type), eq(tag.nameKey, nameKey)))
        .get();
      if (existing) return { tag: existing, created: false };
      const created = tx.insert(tag).values({ type, name, nameKey }).returning(TAG_COLUMNS).get();
      return { tag: created, created: true };
    },
    // Reads, then writes, and the seed runs it beside the API.
    { behavior: 'immediate' },
  );
}

/**
 * How many recipes `user` may see have each tag. Recipes they may not see, like someone else's
 * private ones, aren't counted, so the numbers say nothing about them.
 */
export function tagUsage(db: Db, user: PolicyUser): TagUsage['usage'] {
  return db
    .select({ tagId: recipeTag.tagId, recipes: count() })
    .from(recipeTag)
    .innerJoin(recipe, eq(recipe.id, recipeTag.recipeId))
    .where(readableBy(user))
    .groupBy(recipeTag.tagId)
    .all();
}

/** The admin making a change, for its audit event and for what it may count. */
export interface TagAdmin {
  origin: AuditOrigin;
  user: PolicyUser;
}

type Refusal = 'not-found' | 'allergen';

export type RenameTagResult =
  | { ok: true; tag: Tag }
  | { ok: false; reason: Refusal }
  | { ok: false; reason: 'name-taken'; existing: Tag };

export type MergeTagResult =
  | { ok: true; tag: Tag }
  | { ok: false; reason: Refusal | 'same-tag' | 'into-not-found' | 'other-type' };

export type DeleteTagResult = { ok: true } | { ok: false; reason: Refusal };

/** The tag to change, or why it can't be: it's gone, or it's an allergen. */
function changeableTag(tx: Tx, id: number) {
  const row = tx.select(TAG_COLUMNS).from(tag).where(eq(tag.id, id)).get();
  if (!row) return { ok: false as const, reason: 'not-found' as const };
  if (row.type === 'allergen') return { ok: false as const, reason: 'allergen' as const };
  return { ok: true as const, tag: row };
}

/**
 * Every recipe with the tag, which each need indexing again, and how many of them the admin may
 * see, for the audit event: a count that took in private recipes would tell of them.
 */
function recipesWith(tx: Tx, tagId: number, admin: TagAdmin) {
  const recipeIds = tx
    .select({ id: recipeTag.recipeId })
    .from(recipeTag)
    .where(eq(recipeTag.tagId, tagId))
    .all()
    .map(({ id }) => id);
  const visible =
    recipeIds.length === 0
      ? 0
      : (tx
          .select({ value: count() })
          .from(recipe)
          .where(and(inArray(recipe.id, recipeIds), readableBy(admin.user)))
          .get()?.value ?? 0);
  return { recipeIds, visible };
}

function reindex(tx: Tx, recipeIds: readonly string[]) {
  for (const recipeId of recipeIds) enqueueJob(tx, indexRecipeJob, { recipeId });
}

/**
 * Renames a tag. A name another tag of its type already has, ignoring case and spacing, is
 * refused: the two would be one tag, which is what merging is for.
 */
export function renameTag(db: Db, admin: TagAdmin, id: number, name: string): RenameTagResult {
  return db.transaction((tx) => {
    const found = changeableTag(tx, id);
    if (!found.ok) return found;
    const old = found.tag;
    if (name === old.name) return { ok: true, tag: old };
    const nameKey = tagNameKey(name);
    const existing = tx
      .select(TAG_COLUMNS)
      .from(tag)
      .where(and(eq(tag.type, old.type), eq(tag.nameKey, nameKey), ne(tag.id, id)))
      .get();
    if (existing) return { ok: false, reason: 'name-taken', existing };
    tx.update(tag).set({ name, nameKey }).where(eq(tag.id, id)).run();
    const { recipeIds, visible } = recipesWith(tx, id, admin);
    reindex(tx, recipeIds);
    recordAuditEvent(tx, admin.origin, {
      action: 'tag.renamed',
      target: { type: 'tag', id: String(id) },
      metadata: { type: old.type, from: old.name, to: name, recipes: visible },
    });
    return { ok: true, tag: { ...old, name } };
  });
}

/**
 * Merges a tag into another of its type: every recipe that had it has the other instead, and it's
 * gone.
 */
export function mergeTag(db: Db, admin: TagAdmin, id: number, intoId: number): MergeTagResult {
  return db.transaction((tx) => {
    if (id === intoId) return { ok: false, reason: 'same-tag' };
    const found = changeableTag(tx, id);
    if (!found.ok) return found;
    const into = tx.select(TAG_COLUMNS).from(tag).where(eq(tag.id, intoId)).get();
    if (!into) return { ok: false, reason: 'into-not-found' };
    if (into.type !== found.tag.type) return { ok: false, reason: 'other-type' };
    const { recipeIds, visible } = recipesWith(tx, id, admin);
    if (recipeIds.length > 0)
      tx.insert(recipeTag)
        .values(recipeIds.map((recipeId) => ({ recipeId, tagId: intoId })))
        .onConflictDoNothing()
        .run();
    tx.delete(recipeTag).where(eq(recipeTag.tagId, id)).run();
    tx.delete(tag).where(eq(tag.id, id)).run();
    reindex(tx, recipeIds);
    recordAuditEvent(tx, admin.origin, {
      action: 'tag.merged',
      target: { type: 'tag', id: String(id) },
      metadata: {
        type: into.type,
        name: found.tag.name,
        into: { id: into.id, name: into.name },
        recipes: visible,
      },
    });
    return { ok: true, tag: into };
  });
}

/** Deletes a tag, taking it off every recipe that had it. */
export function deleteTag(db: Db, admin: TagAdmin, id: number): DeleteTagResult {
  return db.transaction((tx) => {
    const found = changeableTag(tx, id);
    if (!found.ok) return found;
    const { recipeIds, visible } = recipesWith(tx, id, admin);
    tx.delete(recipeTag).where(eq(recipeTag.tagId, id)).run();
    tx.delete(tag).where(eq(tag.id, id)).run();
    reindex(tx, recipeIds);
    recordAuditEvent(tx, admin.origin, {
      action: 'tag.deleted',
      target: { type: 'tag', id: String(id) },
      metadata: { type: found.tag.type, name: found.tag.name, recipes: visible },
    });
    return { ok: true };
  });
}
