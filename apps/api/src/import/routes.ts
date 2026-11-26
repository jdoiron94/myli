import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { importRecipeRequestSchema, importRecipeResultSchema } from '@myli/shared';
import { requirePermission } from '../auth/authorize.ts';
import type { BlobStore } from '../blobs/store.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import type { Outbound } from '../outbound/fetch.ts';
import { errorResponses } from '../problems.ts';
import { importRecipe } from './import.ts';

const postImport = createRoute({
  method: 'post',
  path: '/recipes/import',
  tags: ['Recipes'],
  summary: 'Read a recipe from another site',
  description:
    'Editors and admins. Fetches the page at `url` and reads the schema.org/Recipe data it holds ' +
    'as JSON-LD, to fill in a new recipe, which saves nothing. Its first photo is uploaded as the ' +
    'caller’s, as if they had added it; if it can’t be, the import goes on without it. Tags it ' +
    'names are added only if they exist. Only pages on the public internet are fetched. A page ' +
    'that can’t be imported is a 422 at `url`, saying why.',
  middleware: [requirePermission('recipe.create')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: importRecipeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'The recipe as the page gives it. `servings` is `null` when it doesn’t say.',
      content: { 'application/json': { schema: importRecipeResultSchema } },
    },
    ...errorResponses,
  },
});

export function registerImportRoutes(
  v1: OpenAPIHono<AppEnv>,
  deps: { db: Db; blobs: BlobStore; outbound: Outbound },
) {
  v1.openapi(postImport, async (c) => {
    const { url } = c.req.valid('json');
    const result = await importRecipe({ ...deps, logger: c.var.logger }, c.var.user.id, url);
    return c.json(result, 200);
  });
}
