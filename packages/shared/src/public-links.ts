import { z } from 'zod';
import { imageFileParamsSchema } from './image.ts';
import { recipeRevisionContentSchema } from './revision.ts';

/**
 * Where a recipe's public link opens, on this instance: `PUBLIC_URL/p/<token>`. Anyone with it can
 * see the recipe as it's published, without signing in (spec §2).
 */
export const PUBLIC_RECIPE_PATH = '/p';

/** A public link's address, given the instance's origin. */
export const publicRecipeUrl = (origin: string, token: string) =>
  `${origin}${PUBLIC_RECIPE_PATH}/${encodeURIComponent(token)}`;

export const publicLinkSchema = z
  .object({
    token: z
      .string()
      .describe('Unguessable. The link is `PUBLIC_URL/p/<token>`, which anyone can open.'),
  })
  .meta({ id: 'PublicLink' });

export type PublicLink = z.infer<typeof publicLinkSchema>;

export const recipePublicLinkSchema = z
  .object({ publicLink: z.union([publicLinkSchema, z.null()]) })
  .meta({ id: 'RecipePublicLink' });

export const createdPublicLinkSchema = z
  .object({ publicLink: publicLinkSchema })
  .meta({ id: 'CreatedPublicLink' });

/**
 * A recipe as its public link shows it: what it says, as published, and nothing about who wrote it,
 * its ratings, comments or history.
 */
export const publicRecipeResultSchema = z
  .object({ recipe: recipeRevisionContentSchema })
  .meta({ id: 'PublicRecipeResult' });

const publicToken = z.string().min(1).max(100);

export const publicTokenParamsSchema = z.object({ token: publicToken });

export const publicImageParamsSchema = imageFileParamsSchema.extend({ token: publicToken });
