import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  favoriteSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  recipeIdParamsSchema,
  recipeListQuerySchema,
  recipeListSchema,
} from '@myli/shared';
import { authorize, notFound, requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { findRecipeAccess } from '../recipes/recipes.ts';
import { isFavorite, listFavorites, setFavorite } from './favorites.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const favoriteResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: favoriteSchema } },
});

const getFavorite = createRoute({
  method: 'get',
  path: '/recipes/{id}/favorite',
  tags: ['Favorites'],
  summary: 'Get whether a recipe is a favorite',
  description: "Editors and admins, for any recipe they can see. Whether it's one of theirs.",
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: favoriteResult('Whether it is.'),
    403: problem('The caller may see the recipe but keeps no favorites: viewers are read-only.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const putFavorite = createRoute({
  method: 'put',
  path: '/recipes/{id}/favorite',
  tags: ['Favorites'],
  summary: 'Make a recipe a favorite, or not',
  description:
    'Editors and admins, for any recipe they can see. Favorites are personal: no one else sees ' +
    'them. Setting what it already is changes nothing.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: favoriteSchema } } },
  },
  responses: {
    200: favoriteResult('Whether it is now.'),
    403: problem('The caller may see the recipe but keeps no favorites: viewers are read-only.'),
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const getMyFavorites = createRoute({
  method: 'get',
  path: '/me/favorites',
  tags: ['Favorites'],
  summary: 'List your favorites',
  description:
    'Editors and admins. Their favorite recipes, most recently chosen first, one page at a time. ' +
    'One they may no longer see, because it was deleted or made private, is left out until it ' +
    'comes back.',
  middleware: [requirePermission('personal.write')] as const,
  request: { query: recipeListQuerySchema },
  responses: {
    200: {
      description: 'One page of them.',
      content: { 'application/json': { schema: recipeListSchema } },
    },
    ...errorResponses,
  },
});

export function registerFavoriteRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getFavorite, (c) => {
    const { id } = c.req.valid('param');
    authorizeInteraction(c, id);
    return c.json({ favorite: isFavorite(deps.db, c.var.user.id, id) }, 200);
  });

  v1.openapi(putFavorite, (c) => {
    const { id } = c.req.valid('param');
    const { favorite } = c.req.valid('json');
    authorizeInteraction(c, id);
    setFavorite(deps.db, c.var.user.id, id, favorite);
    return c.json({ favorite }, 200);
  });

  v1.openapi(getMyFavorites, (c) =>
    c.json(listFavorites(deps.db, c.var.user, c.req.valid('query').page), 200),
  );

  /** Throws unless the caller may keep the recipe as a favorite: 401, 404 if hidden or gone, 403. */
  function authorizeInteraction(c: Parameters<typeof authorize>[0], id: string) {
    const access = findRecipeAccess(deps.db, id);
    if (!access) throw notFound('Recipe');
    authorize(c, 'recipe.interact', access);
  }
}
