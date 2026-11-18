import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  API_BASE_PATH,
  changeVisibilityRequestSchema,
  createRecipeRequestSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  type RecipeAction,
  recipeIdParamsSchema,
  recipeListQuerySchema,
  recipeListSchema,
  recipeResultSchema,
  updateRecipeRequestSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { authorize, notFound, requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, InvalidFields } from '../problems.ts';
import { listRecipes } from './list.ts';
import {
  createRecipe,
  deleteRecipe,
  findRecipeAccess,
  loadRecipe,
  type SaveResult,
  setRecipeVisibility,
  updateRecipe,
} from './recipes.ts';

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

const getRecipes = createRoute({
  method: 'get',
  path: '/recipes',
  tags: ['Recipes'],
  summary: 'List recipes',
  description:
    'The recipes the caller may see: shared ones, and their own private ones. Newest first, ' +
    'one page at a time. Unlike search, it reads the database, so it works while search is ' +
    'unavailable.',
  middleware: [requireSession] as const,
  request: { query: recipeListQuerySchema },
  responses: {
    200: {
      description: 'One page of them.',
      content: { 'application/json': { schema: recipeListSchema } },
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

const putRecipe = createRoute({
  method: 'put',
  path: '/recipes/{id}',
  tags: ['Recipes'],
  summary: 'Save a recipe',
  description:
    'Editors and admins, for shared recipes and their own private ones: editors can edit any ' +
    "shared recipe, whoever created it. Replaces all of the recipe's content, lines, steps and " +
    'tags included; its owner and visibility stay. Until drafts arrive, the last save wins.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: updateRecipeRequestSchema } },
    },
  },
  responses: {
    200: result('The recipe as saved.'),
    403: problem('The caller may see the recipe but not edit it.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const putVisibility = createRoute({
  method: 'put',
  path: '/recipes/{id}/visibility',
  tags: ['Recipes'],
  summary: "Change a recipe's visibility",
  description:
    "The recipe's owner only, admins included: a private recipe is seen by its owner alone, a " +
    'shared one by everyone signed in. Setting the visibility it already has changes nothing.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: changeVisibilityRequestSchema } },
    },
  },
  responses: {
    200: result('The recipe, with its visibility now.'),
    403: problem("The caller may see the recipe but isn't its owner."),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const deleteRecipeRoute = createRoute({
  method: 'delete',
  path: '/recipes/{id}',
  tags: ['Recipes'],
  summary: 'Delete a recipe',
  description:
    'Its owner, or an admin for any recipe they can see. The recipe is hidden everywhere at once, ' +
    'and the deletion is recorded in the audit log. (Restoring it from the trash comes with ' +
    'Phase 2.) Send `Content-Type: application/json` even though there is no body.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    204: { description: 'Deleted.' },
    403: problem('The caller may see the recipe but not delete it.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

/**
 * The saved recipe's ID, or the problem that stopped the save: 404 if the recipe is gone, or the
 * 422 naming the tags in `tagIds` that don't exist.
 */
function savedId(saved: SaveResult): string {
  if (saved.ok) return saved.id;
  if (saved.reason === 'not-found') throw notFound('Recipe');
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

  v1.openapi(getRecipes, (c) =>
    c.json(listRecipes(deps.db, c.var.user, c.req.valid('query').page), 200),
  );

  v1.openapi(getRecipe, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    return c.json({ recipe: found(id) }, 200);
  });

  v1.openapi(putRecipe, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    savedId(updateRecipe(deps.db, id, c.req.valid('json')));
    c.var.logger.info({ recipeId: id }, 'recipe saved');
    return c.json({ recipe: found(id) }, 200);
  });

  v1.openapi(putVisibility, (c) => {
    const { id } = c.req.valid('param');
    const { visibility } = c.req.valid('json');
    authorizeOn(c, 'recipe.setVisibility', id);
    if (!setRecipeVisibility(deps.db, id, visibility)) throw notFound('Recipe');
    c.var.logger.info({ recipeId: id, visibility }, 'recipe visibility set');
    return c.json({ recipe: found(id) }, 200);
  });

  v1.openapi(deleteRecipeRoute, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.trash', id);
    if (!deleteRecipe(deps.db, auditOrigin(c), id)) throw notFound('Recipe');
    c.var.logger.info({ recipeId: id }, 'recipe deleted');
    return c.body(null, 204);
  });

  /** Throws unless the caller may do `action` to the recipe: 401, 404 if hidden or gone, 403. */
  function authorizeOn(c: Parameters<typeof authorize>[0], action: RecipeAction, id: string) {
    const access = findRecipeAccess(deps.db, id);
    if (!access) throw notFound('Recipe');
    authorize(c, action, access);
  }

  /** The recipe, which the handler just authorized or wrote. */
  function found(id: string) {
    const recipe = loadRecipe(deps.db, id);
    if (!recipe) throw notFound('Recipe');
    return recipe;
  }
}
