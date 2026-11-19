import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ifMatchHeadersSchema,
  recipeContentSchema,
  recipeDraftResultSchema,
  recipeIdParamsSchema,
  savedDraftResultSchema,
  versionETag,
} from '@myli/shared';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { conditionalResponses, ifMatchVersion, problem, recipeGuards } from '../recipes/http.ts';
import { discardDraft, loadDraft, saveDraft } from './drafts.ts';

const WHO =
  'Whoever may edit the recipe: editors and admins, for shared recipes and their own private ones.';

const refusals = {
  403: problem('The caller may see the recipe but not edit it.'),
  404: problem('No recipe has this ID, or the caller may not see it.'),
};

const getDraft = createRoute({
  method: 'get',
  path: '/recipes/{id}/draft',
  tags: ['Recipes'],
  summary: "Get a recipe's draft",
  description: `${WHO} The draft, or \`null\` when the recipe has none.`,
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema },
  responses: {
    200: {
      description: 'The draft, or `null`.',
      content: { 'application/json': { schema: recipeDraftResultSchema } },
    },
    ...refusals,
    ...errorResponses,
  },
});

const putDraft = createRoute({
  method: 'put',
  path: '/recipes/{id}/draft',
  tags: ['Recipes'],
  summary: "Save a recipe's draft",
  description:
    `${WHO} Saves the content as the recipe's one draft, replacing any it had, while the ` +
    'published recipe stays as it is. Its photos and tags are checked as publishing them would ' +
    'be. It moves the recipe on to its next version: send the one it was based on in `If-Match`.',
  middleware: [requireSession] as const,
  request: {
    params: recipeIdParamsSchema,
    headers: ifMatchHeadersSchema,
    body: { required: true, content: { 'application/json': { schema: recipeContentSchema } } },
  },
  responses: {
    200: {
      description: 'The draft as saved, with the version the recipe is at now.',
      content: { 'application/json': { schema: savedDraftResultSchema } },
    },
    ...refusals,
    ...conditionalResponses,
    ...errorResponses,
  },
});

const deleteDraft = createRoute({
  method: 'delete',
  path: '/recipes/{id}/draft',
  tags: ['Recipes'],
  summary: "Discard a recipe's draft",
  description:
    `${WHO} The published recipe stays as it is. Discarding a draft moves the recipe on to its ` +
    'next version: send the one it was based on in `If-Match`, and `Content-Type: ' +
    'application/json` even though there is no body. Without a draft, nothing changes.',
  middleware: [requireSession] as const,
  request: { params: recipeIdParamsSchema, headers: ifMatchHeadersSchema },
  responses: {
    204: {
      description: 'Discarded, or there was none.',
      headers: {
        ETag: { schema: { type: 'string' }, description: "The recipe's version now." },
      },
    },
    ...refusals,
    ...conditionalResponses,
    ...errorResponses,
  },
});

export function registerDraftRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  const { authorizeOn, found, written } = recipeGuards(deps.db);

  v1.openapi(getDraft, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    return c.json({ draft: loadDraft(deps.db, id) }, 200);
  });

  v1.openapi(putDraft, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    written(id, saveDraft(deps.db, id, c.req.valid('json'), c.var.user.id, version));
    c.var.logger.info({ recipeId: id }, 'recipe draft saved');
    const draft = loadDraft(deps.db, id);
    // Saved just now, in this same synchronous request.
    if (!draft) throw new Error('The draft just saved is missing');
    return c.json({ draft }, 200);
  });

  v1.openapi(deleteDraft, (c) => {
    const { id } = c.req.valid('param');
    authorizeOn(c, 'recipe.edit', id);
    const version = ifMatchVersion(c.req.valid('header')['if-match']);
    written(id, discardDraft(deps.db, id, version));
    c.var.logger.info({ recipeId: id }, 'recipe draft discarded');
    return c.body(null, 204, { ETag: versionETag(found(id).version) });
  });
}
