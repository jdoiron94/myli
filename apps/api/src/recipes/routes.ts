import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  API_BASE_PATH,
  createRecipeRequestSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  recipeIdParamsSchema,
  recipeResultSchema,
} from '@myli/shared';
import { authorize, notFound, requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, InvalidFields } from '../problems.ts';
import { createRecipe, findRecipeAccess, loadRecipe, type SaveResult } from './recipes.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const result = (description: string) => ({
  description,
  content: { 'application/json': { schema: recipeResultSchema } },
});

const postRecipe = createRoute({
  method: 'post',
  path: '/recipes',
  tags: ['Recipes'],
  summary: 'Create a recipe',
  description:
    'Editors and admins. The caller owns the new recipe. Ingredient lines are stored as sent: ' +
    'parse them with `parseIngredient` from `@myli/shared` and let the user confirm. A tag that ' +
    'no longer exists fails validation like any other field.',
  middleware: [requirePermission('recipe.create')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createRecipeRequestSchema } },
    },
  },
  responses: {
    201: {
      ...result('The new recipe.'),
      headers: { Location: { schema: { type: 'string' }, description: 'Where it lives.' } },
    },
    ...errorResponses,
  },
});

const getRecipe = createRoute({
  method: 'get',
  path: '/recipes/{id}',
  tags: ['Recipes'],
  summary: 'Get a recipe',
  description:
    "Any signed-in user, for shared recipes and their own private ones. Someone else's private " +
    'recipe answers 404, exactly as one that never existed or was deleted.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: result('The recipe.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

/** The saved recipe's ID, or the 422 naming the tags in `tagIds` that don't exist. */
function savedId(saved: SaveResult): string {
  if (saved.ok) return saved.id;
  throw new InvalidFields(
    saved.missingTags.map((index) => ({
      path: ['tagIds', index],
      detail: 'This tag no longer exists. Choose another.',
    })),
  );
}

export function registerRecipeRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(postRecipe, (c) => {
    const id = savedId(createRecipe(deps.db, c.var.user.id, c.req.valid('json')));
    const recipe = loadRecipe(deps.db, id);
    // Just written in the same process: only a bug could lose it.
    if (!recipe) throw new Error('a new recipe could not be read back');
    c.var.logger.info({ recipeId: id }, 'recipe created');
    return c.json({ recipe }, 201, { Location: `${API_BASE_PATH}/recipes/${id}` });
  });

  v1.openapi(getRecipe, (c) => {
    const { id } = c.req.valid('param');
    const access = findRecipeAccess(deps.db, id);
    if (!access) throw notFound('Recipe');
    authorize(c, 'recipe.read', access);
    const recipe = loadRecipe(deps.db, id);
    if (!recipe) throw notFound('Recipe');
    return c.json({ recipe }, 200);
  });
}
