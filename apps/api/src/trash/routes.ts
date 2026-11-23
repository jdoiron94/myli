import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { ifMatchHeadersSchema, recipeIdParamsSchema, trashListSchema } from '@myli/shared';
import { auditOrigin } from '../audit/audit.ts';
import { authorizeTrashed, notFound, requirePermission } from '../auth/authorize.ts';
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
  result,
  staleRecipeProblem,
} from '../recipes/http.ts';
import { findTrashedAccess, loadRecipe } from '../recipes/recipes.ts';
import { listTrash, restoreRecipe } from './trash.ts';

const getTrash = createRoute({
  method: 'get',
  path: '/trash',
  tags: ['Recipes'],
  summary: 'List the trash',
  description:
    'Editors and admins. The deleted recipes the caller may restore, most recently deleted first: ' +
    'their own, and for admins, shared ones too. Each is deleted for good once it has been in the ' +
    'trash for `retentionDays`.',
  middleware: [requirePermission('trash.read')] as const,
  responses: {
    200: {
      description: 'The trash.',
      content: { 'application/json': { schema: trashListSchema } },
    },
    ...errorResponses,
  },
});

const postRestore = createRoute({
  method: 'post',
  path: '/trash/{id}/restore',
  tags: ['Recipes'],
  summary: 'Restore a recipe from the trash',
  description:
    'Its owner, or an admin while it’s shared. The recipe comes back as it was, for everyone who ' +
    'saw it before, and the restore is recorded in the audit log. Anyone else gets 404, as for a ' +
    'recipe that isn’t in the trash. Send the version it’s based on in `If-Match`, and ' +
    '`Content-Type: application/json` even though there is no body.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, headers: ifMatchHeadersSchema },
  responses: {
    200: result('The recipe as restored.'),
    404: problem('No recipe in the trash has this ID, or the caller may not restore it.'),
    ...conditionalResponses,
    ...errorResponses,
  },
});

export function registerTrashRoutes(
  v1: OpenAPIHono<AppEnv>,
  deps: { db: Db; retentionDays: number },
) {
  const { found } = recipeGuards(deps.db);

  v1.openapi(getTrash, (c) =>
    c.json(
      {
        recipes: listTrash(deps.db, c.var.user, deps.retentionDays),
        retentionDays: deps.retentionDays,
      },
      200,
    ),
  );

  v1.openapi(postRestore, (c) => {
    const { id } = c.req.valid('param');
    const access = findTrashedAccess(deps.db, id);
    if (!access) throw notFound('Recipe');
    authorizeTrashed(c, access);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    const restored = restoreRecipe(deps.db, auditOrigin(c), id, version);
    if (!restored.ok) {
      // Still in the trash, at another version: deleted again since it was last restored.
      const current =
        restored.reason === 'stale' && loadRecipe(deps.db, id, { includeDeleted: true });
      throw current ? staleRecipeProblem(current) : notFound('Recipe');
    }
    c.var.logger.info({ recipeId: id }, 'recipe restored from the trash');
    const recipe = found(id);
    return c.json({ recipe }, 200, etag(recipe));
  });
}
