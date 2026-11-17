import { TAG_TYPES, type Tag, type TagType, tagNameKey } from '@myli/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/database.ts';
import { tag } from '../db/schema.ts';

/**
 * Tags (spec §3.2). Editors create them as they tag recipes; admins rename, merge and delete them
 * (group G). The allergen tags are seeded and never change.
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
  return db.transaction((tx) => {
    const existing = tx
      .select(TAG_COLUMNS)
      .from(tag)
      .where(and(eq(tag.type, type), eq(tag.nameKey, nameKey)))
      .get();
    if (existing) return { tag: existing, created: false };
    const created = tx.insert(tag).values({ type, name, nameKey }).returning(TAG_COLUMNS).get();
    return { tag: created, created: true };
  });
}
