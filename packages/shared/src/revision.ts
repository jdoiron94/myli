import { z } from 'zod';
import { recipeSchema } from './recipe.ts';

/** One entry in a recipe's history (spec §3.3). */
export const recipeRevisionSummarySchema = z
  .object({
    number: z.int().positive().describe('Its place in the history, from 1.'),
    author: z.object({ id: z.string(), name: z.string() }),
    message: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'RecipeRevisionSummary' });

export type RecipeRevisionSummary = z.infer<typeof recipeRevisionSummarySchema>;

export const recipeRevisionListSchema = z
  .object({
    revisions: z
      .array(recipeRevisionSummarySchema)
      .describe('Newest first. The first is the one published.'),
  })
  .meta({ id: 'RecipeRevisionList' });

export type RecipeRevisionList = z.infer<typeof recipeRevisionListSchema>;

/** A recipe's content as a revision recorded it, its tags with the names they had then. */
export const recipeRevisionContentSchema = recipeSchema
  .pick({
    title: true,
    description: true,
    source: true,
    equipment: true,
    yield: true,
    servings: true,
    prepMinutes: true,
    cookMinutes: true,
    totalMinutes: true,
    difficulty: true,
    nutrition: true,
    ingredientGroups: true,
    steps: true,
    tags: true,
    images: true,
    coverImageId: true,
  })
  .meta({ id: 'RecipeRevisionContent' });

export type RecipeRevisionContent = z.infer<typeof recipeRevisionContentSchema>;

export const recipeRevisionSchema = recipeRevisionSummarySchema
  .extend({ content: recipeRevisionContentSchema })
  .meta({ id: 'RecipeRevision' });

export type RecipeRevision = z.infer<typeof recipeRevisionSchema>;

export const recipeRevisionResultSchema = z
  .object({ revision: recipeRevisionSchema })
  .meta({ id: 'RecipeRevisionResult' });

/** The path parameters of one revision of a recipe. */
export const recipeRevisionParamsSchema = z.object({
  id: z.string().min(1).max(100),
  number: z.coerce.number().int().positive(),
});

/** The message of a revision that restored revision `number`. */
export const restoredMessage = (number: number) => `Restored from revision #${String(number)}`;
