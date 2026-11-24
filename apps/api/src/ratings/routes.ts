import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  ratingRequestSchema,
  recipeIdParamsSchema,
  recipeRatingSchema,
} from '@myli/shared';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { recipeGuards } from '../recipes/http.ts';
import { recipeRating, removeRating, setRating } from './ratings.ts';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const ratingResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: recipeRatingSchema } },
});

const notFoundResponse = problem('No recipe has this ID, or the caller may not see it.');
const viewersCantRate = problem(
  'The caller may see the recipe but not rate it: viewers are read-only.',
);

const getRating = createRoute({
  method: 'get',
  path: '/recipes/{id}/rating',
  tags: ['Ratings'],
  summary: "Get a recipe's ratings",
  description:
    'Anyone who can see the recipe: how many ratings it has and their average, and the ' +
    "caller's own rating.",
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: ratingResult('Its ratings.'),
    404: notFoundResponse,
    ...errorResponses,
  },
});

const putRating = createRoute({
  method: 'put',
  path: '/recipes/{id}/rating',
  tags: ['Ratings'],
  summary: 'Rate a recipe',
  description:
    'Editors and admins, for any recipe they can see: one rating each, from 1 to 5 stars, which ' +
    'this sets or changes. Sorting search by rating takes it in once the recipe is indexed again.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: ratingRequestSchema } } },
  },
  responses: {
    200: ratingResult('Its ratings now.'),
    403: viewersCantRate,
    404: notFoundResponse,
    ...errorResponses,
  },
});

const deleteRating = createRoute({
  method: 'delete',
  path: '/recipes/{id}/rating',
  tags: ['Ratings'],
  summary: 'Take back your rating of a recipe',
  description: 'Editors and admins. With no rating of theirs, it changes nothing.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: ratingResult('Its ratings now.'),
    403: viewersCantRate,
    404: notFoundResponse,
    ...errorResponses,
  },
});

export function registerRatingRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn } = recipeGuards(deps.db);

  v1.openapi(getRating, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    return c.json(recipeRating(deps.db, id, c.var.user.id), 200);
  });

  v1.openapi(putRating, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    setRating(deps.db, c.var.user.id, id, c.req.valid('json').stars);
    return c.json(recipeRating(deps.db, id, c.var.user.id), 200);
  });

  v1.openapi(deleteRating, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.interact', id);
    removeRating(deps.db, c.var.user.id, id);
    return c.json(recipeRating(deps.db, id, c.var.user.id), 200);
  });
}
