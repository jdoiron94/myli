import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ifMatchHeadersSchema,
  recipeIdParamsSchema,
  recipeRevisionListSchema,
  recipeRevisionParamsSchema,
  recipeRevisionResultSchema,
} from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { notFound } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import {
  conditionalResponses,
  etag,
  ifMatchVersion,
  problem,
  recipeGuards,
  result,
} from '../recipes/http.ts';
import { listRevisions, loadRevision, restoreRevision } from './revisions.ts';

const READERS =
  "Anyone who may see the recipe: any signed-in user, for shared recipes and their own private ones. Someone else's private recipe answers 404.";

const getRevisions = createRoute({
  method: 'get',
  path: '/recipes/{id}/revisions',
  tags: ['Recipes'],
  summary: "List a recipe's revisions",
  description: `${READERS} Every revision, newest first, without its content.`,
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: {
      description: 'Its history.',
      content: { 'application/json': { schema: recipeRevisionListSchema } },
    },
    404: problem('No recipe has this ID, or the caller may not see it.'),
    ...errorResponses,
  },
});

const getRevision = createRoute({
  method: 'get',
  path: '/recipes/{id}/revisions/{number}',
  tags: ['Recipes'],
  summary: 'Get a revision of a recipe',
  description: `${READERS} The recipe as that revision recorded it, its tags with the names they had then.`,
  middleware: [requireSession] as const,
  request: { params: recipeRevisionParamsSchema },
  responses: {
    200: {
      description: 'The revision.',
      content: { 'application/json': { schema: recipeRevisionResultSchema } },
    },
    404: problem('No recipe has this ID, the caller may not see it, or it has no such revision.'),
    ...errorResponses,
  },
});

const postRestore = createRoute({
  method: 'post',
  path: '/recipes/{id}/revisions/{number}/restore',
  tags: ['Recipes'],
  summary: 'Restore a revision of a recipe',
  description:
    'Whoever may edit the recipe: editors and admins, for shared recipes and their own private ' +
    'ones. Publishes the revision’s content as the next revision, with the message “Restored ' +
    'from revision #n”, and records it in the audit log. History is never rewritten, and the ' +
    'draft stays. Tags deleted since are left out. Send the version it’s based on in ' +
    '`If-Match`, and `Content-Type: application/json` even though there is no body.',
  middleware: [requireSession] as const,
  request: { params: recipeRevisionParamsSchema, headers: ifMatchHeadersSchema },
  responses: {
    200: result('The recipe as restored.'),
    403: problem('The caller may see the recipe but not edit it.'),
    404: problem('No recipe has this ID, the caller may not see it, or it has no such revision.'),
    409: problem('The revision can no longer be restored.'),
    ...conditionalResponses,
    ...errorResponses,
  },
});

export function registerRevisionRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn, found, written } = recipeGuards(deps.db);

  v1.openapi(getRevisions, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    return c.json({ revisions: listRevisions(deps.db, id) }, 200);
  });

  v1.openapi(getRevision, (c) => {
    const { id, number } = c.req.valid('param');
    authorizeOn(c, 'recipe.read', id);
    const revision = loadRevision(deps.db, id, number);
    if (!revision) throw notFound('Revision');
    return c.json({ revision }, 200);
  });

  v1.openapi(postRestore, (c) => {
    const { id, number } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    const restored = restoreRevision(deps.db, auditOrigin(c), id, number, c.var.user.id, version);
    if (!restored.ok) {
      if (restored.reason === 'no-revision') throw notFound('Revision');
      if (restored.reason === 'unrestorable') {
        throw new HttpProblem(
          409,
          'This revision can’t be restored as it is. Edit the recipe to bring back what you need.',
        );
      }
      written(id, restored);
    }
    c.var.logger.info({ recipeId: id, revision: number }, 'recipe revision restored');
    const recipe = found(id);
    return c.json({ recipe }, 200, etag(recipe));
  });
}
