import { z } from 'zod';
import { DIFFICULTIES } from './recipe.ts';
import { ALLERGENS } from './tags.ts';
import { VISIBILITIES } from './visibility.ts';

/** Recipes on one page of a list or of search results. Divides into rows of two, three and four. */
export const RECIPES_PER_PAGE = 24;

/** A recipe as a list or search results show it: enough for its card. */
export const recipeSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    difficulty: z.enum(DIFFICULTIES).nullable(),
    totalMinutes: z.number().int().nullable(),
    cuisine: z.array(z.string()),
    mealType: z.array(z.string()),
    diet: z.array(z.string()),
    tags: z.array(z.string()).describe('Its other tags.'),
    allergens: z.array(z.enum(ALLERGENS)),
    visibility: z.enum(VISIBILITIES),
  })
  .meta({ id: 'RecipeSummary' });

export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

export const recipeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export const recipeListSchema = z
  .object({
    recipes: z.array(recipeSummarySchema),
    total: z.number().int().describe('How many recipes the caller may see, across every page.'),
    page: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'RecipeList' });

export type RecipeList = z.infer<typeof recipeListSchema>;
