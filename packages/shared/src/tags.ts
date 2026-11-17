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

export const TAG_NAME_MAX_LENGTH = 50;

/** A tag's name as its creator writes it, with spacing tidied: "Middle  Eastern " is "Middle Eastern". */
export const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the tag.')
  .max(TAG_NAME_MAX_LENGTH)
  .overwrite((name) => name.replace(/\s+/g, ' '));

export const tagListSchema = z
  .object({ tags: z.array(tagSchema).describe('By type, then name.') })
  .meta({ id: 'TagList' });

export const tagListQuerySchema = z.object({
  type: tagTypeSchema.optional().describe('Only tags of this type.'),
});

export const createTagRequestSchema = z
  .object({
    type: z
      .enum(USER_TAG_TYPES)
      .describe('Any type but `allergen`: the allergens are a fixed list.'),
    name: tagNameSchema,
  })
  .meta({ id: 'CreateTagRequest' });

export const tagResultSchema = z.object({ tag: tagSchema }).meta({ id: 'TagResult' });
