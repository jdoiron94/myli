import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { recipeExportQuerySchema, recipeExportSchema, recipeIdParamsSchema } from '@myli/shared';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { problem, recipeGuards } from '../recipes/http.ts';
import { exportFileName, nativeExport, schemaOrgExport } from './recipe.ts';

const download = {
  'Content-Disposition': {
    schema: { type: 'string' as const },
    description: 'An attachment, named after the recipe.',
  },
};

const getRecipeExport = createRoute({
  method: 'get',
  path: '/recipes/{id}/export',
  tags: ['Recipes'],
  summary: 'Export a recipe',
  description:
    'Anyone who may see the recipe, as a file to download: as published, in myli’s own JSON or ' +
    'as schema.org/Recipe JSON-LD, without its photos, whose addresses only work signed in here.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, query: recipeExportQuerySchema },
  responses: {
    200: {
      description: 'The recipe in the format asked for.',
      content: {
        'application/json': { schema: recipeExportSchema },
        'application/ld+json': { schema: z.record(z.string(), z.unknown()) },
      },
      headers: download,
    },
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

export function registerExportRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn, found } = recipeGuards(deps.db);

  v1.openapi(getRecipeExport, (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    authorizeOn(c, 'recipe.read', id);
    const recipe = found(id);
    if (format === 'jsonld') {
      return c.json(schemaOrgExport(recipe), 200, {
        'Content-Type': 'application/ld+json',
        'Content-Disposition': attachment(exportFileName(recipe.title, 'jsonld')),
      });
    }
    return c.json(nativeExport(recipe), 200, {
      'Content-Disposition': attachment(exportFileName(recipe.title, 'json')),
    });
  });
}

/** Downloaded, under `name`, which is only letters, digits, dots and dashes. */
export const attachment = (name: string) => `attachment; filename="${name}"`;
