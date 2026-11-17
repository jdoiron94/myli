import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  createTagRequestSchema,
  tagListQuerySchema,
  tagListSchema,
  tagResultSchema,
} from '@myli/shared';
import { requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses } from '../problems.ts';
import { findOrCreateTag, listTags } from './tags.ts';

const tagResult = (description: string) => ({
  description,
  content: { 'application/json': { schema: tagResultSchema } },
});

const getTags = createRoute({
  method: 'get',
  path: '/tags',
  tags: ['Tags'],
  summary: 'List tags',
  description: 'Any signed-in user. Every tag, the allergens included, or every tag of one type.',
  middleware: [requireSession] as const,
  request: { query: tagListQuerySchema },
  responses: {
    200: {
      description: 'The tags.',
      content: { 'application/json': { schema: tagListSchema } },
    },
    ...errorResponses,
  },
});

const postTag = createRoute({
  method: 'post',
  path: '/tags',
  tags: ['Tags'],
  summary: 'Create a tag',
  description:
    'Editors and admins. If the type already has a tag with this name, ignoring case and ' +
    'spacing, that tag is returned instead of a new one, with status 200.',
  middleware: [requirePermission('tag.create')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: createTagRequestSchema } } },
  },
  responses: {
    200: tagResult('The tag that already had this name.'),
    201: tagResult('The new tag.'),
    ...errorResponses,
  },
});

export function registerTagRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getTags, (c) => c.json({ tags: listTags(deps.db, c.req.valid('query').type) }, 200));

  v1.openapi(postTag, (c) => {
    const { type, name } = c.req.valid('json');
    const { tag, created } = findOrCreateTag(deps.db, type, name);
    if (!created) return c.json({ tag }, 200);
    c.var.logger.info({ tagId: tag.id, type }, 'tag created');
    return c.json({ tag }, 201);
  });
}
