import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  API_BASE_PATH,
  changeVisibilityRequestSchema,
  createRecipeRequestSchema,
  ifMatchHeadersSchema,
  recipeIdParamsSchema,
  recipeListQuerySchema,
  recipeListSchema,
  updateRecipeRequestSchema,
  versionETag,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import {
  conditionalResponses,
  etag,
  ifMatchVersion,
  problem,
  recipeGuards,
  refusal,
  result,
} from './http.ts';
import { listRecipes } from './list.ts';
import {
  createRecipe,
  deleteRecipe,
  loadRecipe,
  setRecipeVisibility,
  updateRecipe,
} from './recipes.ts';

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
    201: result('The new recipe.', {
      Location: { schema: { type: 'string' }, description: 'Where it lives.' },
    }),
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
  summary: 'Publish a recipe',
  description:
    'Editors and admins, for shared recipes and their own private ones: editors can edit any ' +
    "shared recipe, whoever created it. Replaces all of the recipe's content, lines, steps and " +
    'tags included, and records it as the next revision, with the message if there is one. Its ' +
    'owner and visibility stay, and its draft is discarded. Send the version the edit started ' +
    'from in `If-Match`: if someone changed the recipe or its draft meanwhile, the save is ' +
    'refused with 412.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    headers: ifMatchHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: updateRecipeRequestSchema } },
    },
  },
  responses: {
    200: result('The recipe as saved.'),
    403: problem('The caller may see the recipe but not edit it.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...conditionalResponses,
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
    'shared one by everyone signed in. Setting the visibility it already has changes nothing. ' +
    'Send its version in `If-Match`.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    headers: ifMatchHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: changeVisibilityRequestSchema } },
    },
  },
  responses: {
    200: result('The recipe, with its visibility now.'),
    403: problem("The caller may see the recipe but isn't its owner."),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...conditionalResponses,
    ...errorResponses,
  },
});

const deleteRecipeRoute = createRoute({
  method: 'delete',
  path: '/recipes/{id}',
  tags: ['Recipes'],
  summary: 'Delete a recipe',
  description:
    'Its owner, or an admin for any recipe they can see. The recipe moves to the trash: it is ' +
    'hidden everywhere at once, but to whoever may restore it (`POST /trash/{id}/restore`), and ' +
    'the deletion is recorded in the audit log. Send its version in `If-Match`, and ' +
    '`Content-Type: application/json` even though there is no body.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, headers: ifMatchHeadersSchema },
  responses: {
    204: { description: 'Moved to the trash.' },
    403: problem('The caller may see the recipe but not delete it.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...conditionalResponses,
    ...errorResponses,
  },
});

export function registerRecipeRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn, found, written } = recipeGuards(deps.db);

  v1.openapi(postRecipe, (c) => {
    const saved = createRecipe(deps.db, c.var.user.id, c.req.valid('json'));
    if (!saved.ok) throw refusal(saved);
    const { id } = saved;
    const recipe = loadRecipe(deps.db, id);
    // Just written in the same process: only a bug could lose it.
    if (!recipe) throw new Error('a new recipe could not be read back');
    c.var.logger.info({ recipeId: id }, 'recipe created');
    return c.json({ recipe }, 201, {
      Location: `${API_BASE_PATH}/recipes/${id}`,
      ETag: versionETag(recipe.version),
    });
  });

  v1.openapi(getRecipes, (c) =>
    c.json(listRecipes(deps.db, c.var.user, c.req.valid('query').page), 200),
  );

  v1.openapi(getRecipe, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    const recipe = found(id);
    return c.json({ recipe }, 200, etag(recipe));
  });

  v1.openapi(putRecipe, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    const { message, ...content } = c.req.valid('json');
    written(
      id,
      updateRecipe(deps.db, id, content, c.var.user.id, version, {
        message: message === undefined || message === '' ? null : message,
      }),
    );
    c.var.logger.info({ recipeId: id }, 'recipe saved');
    const recipe = found(id);
    return c.json({ recipe }, 200, etag(recipe));
  });

  v1.openapi(putVisibility, (c) => {
    const { id } = c.req.valid('param');
    const { visibility } = c.req.valid('json');
    authorizeOn(c, 'recipe.setVisibility', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    written(id, setRecipeVisibility(deps.db, auditOrigin(c), id, visibility, version));
    c.var.logger.info({ recipeId: id, visibility }, 'recipe visibility set');
    const recipe = found(id);
    return c.json({ recipe }, 200, etag(recipe));
  });

  v1.openapi(deleteRecipeRoute, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.trash', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    written(id, deleteRecipe(deps.db, auditOrigin(c), id, version));
    c.var.logger.info({ recipeId: id }, 'recipe deleted');
    return c.body(null, 204);
  });
}
