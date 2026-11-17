import { z } from 'zod';

/**
 * Tags (spec §3.2): one system, with a type on each tag. Every type but `allergen` is defined by
 * users: editors create them, admins rename, merge or delete them.
 */
export const TAG_TYPES = ['cuisine', 'meal_type', 'diet', 'allergen', 'custom'] as const;

export const tagTypeSchema = z.enum(TAG_TYPES).meta({ id: 'TagType' });

export type TagType = z.infer<typeof tagTypeSchema>;

/** The types users can create tags of. Allergens are a fixed list. */
export const USER_TAG_TYPES = TAG_TYPES.filter(
  (type): type is Exclude<TagType, 'allergen'> => type !== 'allergen',
);

/**
 * The allergen tags, seeded by a migration and never edited (spec §3.2). Changing this list takes
 * a migration that changes the rows too; a test compares them.
 */
export const ALLERGENS = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
] as const;

/**
 * What makes two tag names of one type the same tag: "Italian", "italian" and " ITALIAN " are one.
 * Unicode-aware, unlike SQLite's `lower()` and `NOCASE`, which only fold ASCII.
 */
export function tagNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A tag as the API shows it. */
export const tagSchema = z
  .object({
    id: z.int().positive(),
    type: tagTypeSchema,
    name: z.string().describe('As its creator wrote it. Allergens are lowercase: "tree nuts".'),
  })
  .meta({ id: 'Tag' });

export type Tag = z.infer<typeof tagSchema>;
