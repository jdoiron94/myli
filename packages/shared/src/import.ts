import { z } from 'zod';
import { imageSchema } from './image.ts';
import { importedRecipeSchema, RECIPE_LIMITS } from './recipe.ts';

/** URL import (spec §3.7): the address of a recipe's page on another site. */
export const importRecipeRequestSchema = z
  .object({
    url: z
      .url({ protocol: /^https?$/, error: 'Enter a web address starting with http or https.' })
      .max(RECIPE_LIMITS.sourceUrl, `Keep it to ${String(RECIPE_LIMITS.sourceUrl)} characters.`),
  })
  .meta({ id: 'ImportRecipeRequest' });

export const importRecipeResultSchema = z
  .object({
    recipe: importedRecipeSchema,
    images: z
      .array(imageSchema)
      .describe(
        'The photos `recipe` names, at their sizes: uploads of the caller’s, deleted after a day ' +
          'unless a recipe is saved with them.',
      ),
  })
  .meta({ id: 'ImportRecipeResult' });

export type ImportRecipeResult = z.output<typeof importRecipeResultSchema>;
