import { z } from 'zod';
import { recipeSummarySchema } from './recipe-list.ts';

/** The longest a collection's name may be, in characters. */
export const COLLECTION_NAME_MAX_LENGTH = 80;

/** The most recipes one collection may hold. */
export const COLLECTION_MAX_RECIPES = 500;

/** What creating or renaming a collection sets. */
export const collectionRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name the collection.')
      .max(
        COLLECTION_NAME_MAX_LENGTH,
        `Keep it to ${String(COLLECTION_NAME_MAX_LENGTH)} characters.`,
      ),
  })
  .meta({ id: 'CollectionRequest' });

export type CollectionRequest = z.infer<typeof collectionRequestSchema>;

/** One of the caller's collections (spec §3.3), as their list of them shows it. */
export const collectionSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    recipeCount: z
      .number()
      .int()
      .describe('How many recipes it holds that the caller may see now.'),
  })
  .meta({ id: 'CollectionSummary' });

export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const collectionListSchema = z
  .object({
    collections: z.array(collectionSummarySchema).describe('By name, ignoring case.'),
  })
  .meta({ id: 'CollectionList' });

export type CollectionList = z.infer<typeof collectionListSchema>;

/** A collection and its recipes, in its order. */
export const collectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    recipes: z
      .array(recipeSummarySchema)
      .describe(
        'In the order the caller put them, only those they may see now. One they may no longer ' +
          'see stays in the collection, and shows again if it comes back.',
      ),
  })
  .meta({ id: 'Collection' });

export type Collection = z.infer<typeof collectionSchema>;

/** What `PUT /collections/{id}/order` sets: the order of the recipes the caller sees in it. */
export const collectionOrderSchema = z
  .object({
    recipeIds: z
      .array(z.string().min(1).max(100))
      .max(COLLECTION_MAX_RECIPES)
      .describe('Every recipe the collection shows, each once, in their new order.'),
  })
  .meta({ id: 'CollectionOrder' });

export type CollectionOrder = z.infer<typeof collectionOrderSchema>;

/** Which of the caller's collections hold a recipe. */
export const recipeCollectionsSchema = z
  .object({ collectionIds: z.array(z.string()) })
  .meta({ id: 'RecipeCollections' });

export type RecipeCollections = z.infer<typeof recipeCollectionsSchema>;

export const collectionIdParamsSchema = z.object({ id: z.string().min(1).max(100) });

export const collectionRecipeParamsSchema = z.object({
  id: z.string().min(1).max(100),
  recipeId: z.string().min(1).max(100),
});
