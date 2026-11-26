import { z } from 'zod';
import { recipeSchema } from './recipe.ts';
import { tagTypeSchema } from './tags.ts';

/** A recipe's export (spec §3.7): myli's own JSON, or schema.org/Recipe JSON-LD. */
export const EXPORT_FORMATS = ['json', 'jsonld'] as const;

export const recipeExportQuerySchema = z.object({
  format: z
    .enum(EXPORT_FORMATS)
    .default('json')
    .describe('`json`, myli’s own format, or `jsonld`, schema.org/Recipe as JSON-LD.'),
});

/**
 * A recipe as myli exports it, as published: its content, its tags by name, and no photos, whose
 * addresses only work signed in to the instance they came from.
 */
export const exportedRecipeSchema = recipeSchema
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
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    steps: z.array(z.object({ body: z.string().describe('Markdown.') })),
    tags: z.array(z.object({ type: tagTypeSchema, name: z.string() })),
  });

export const recipeExportSchema = z
  .object({
    format: z.literal('myli.recipe'),
    formatVersion: z.literal(1).describe('Goes up when the format changes.'),
    exportedAt: z.iso.datetime(),
    recipe: exportedRecipeSchema,
  })
  .meta({ id: 'RecipeExport' });

export type RecipeExport = z.output<typeof recipeExportSchema>;
