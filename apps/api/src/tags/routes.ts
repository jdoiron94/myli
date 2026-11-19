import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  createTagRequestSchema,
  mergeTagRequestSchema,
  type PolicyUser,
  renameTagRequestSchema,
  tagIdParamsSchema,
  tagListQuerySchema,
  tagListSchema,
  tagResultSchema,
  tagUsageSchema,
} from '@myli/shared';
import { type AuditRequest, auditOrigin } from '../audit/audit.ts';
import { requirePermission } from '../auth/authorize.ts';
import { requireSession } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem, InvalidFields } from '../problems.ts';
import {
  deleteTag,
  findOrCreateTag,
  listTags,
  mergeTag,
  renameTag,
  type TagAdmin,
  tagUsage,
} from './tags.ts';

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

const MANAGED =
  'Admins. Allergen tags are a fixed list and are refused with status 409. Every recipe with the ' +
  'tag is indexed again, and an audit event records the change.';

const getTagUsage = createRoute({
  method: 'get',
  path: '/tags/usage',
  tags: ['Tags'],
  summary: 'Count the recipes with each tag',
  description:
    'Admins. Counts only the recipes the caller may see, so recipes kept private by others ' +
    'are left out.',
  middleware: [requirePermission('tag.manage')] as const,
  responses: {
    200: {
      description: 'The count for each tag that some recipe the caller may see has.',
      content: { 'application/json': { schema: tagUsageSchema } },
    },
    ...errorResponses,
  },
});

const putTag = createRoute({
  method: 'put',
  path: '/tags/{id}',
  tags: ['Tags'],
  summary: 'Rename a tag',
  description: `${MANAGED} A name another tag of the same type has, ignoring case and spacing, is refused at \`name\`: merge the two instead.`,
  middleware: [requirePermission('tag.manage')] as const,
  request: {
    params: tagIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: renameTagRequestSchema } } },
  },
  responses: { 200: tagResult('The renamed tag.'), ...errorResponses },
});

const postTagMerge = createRoute({
  method: 'post',
  path: '/tags/{id}/merge',
  tags: ['Tags'],
  summary: 'Merge a tag into another',
  description: `${MANAGED} Every recipe with the tag gets the other one instead, and the tag is deleted. The other tag must be of the same type.`,
  middleware: [requirePermission('tag.manage')] as const,
  request: {
    params: tagIdParamsSchema,
    body: { required: true, content: { 'application/json': { schema: mergeTagRequestSchema } } },
  },
  responses: { 200: tagResult('The tag it was merged into.'), ...errorResponses },
});

const deleteTagRoute = createRoute({
  method: 'delete',
  path: '/tags/{id}',
  tags: ['Tags'],
  summary: 'Delete a tag',
  description: `${MANAGED} The tag comes off every recipe that had it.`,
  middleware: [requirePermission('tag.manage')] as const,
  request: { params: tagIdParamsSchema },
  responses: { 204: { description: 'The tag is deleted.' }, ...errorResponses },
});

const TAG_NOT_FOUND = 'Tag not found.';
const ALLERGEN = 'Allergen tags are a fixed list and can’t be changed.';

/** The refusals every change shares. */
function refused(reason: 'not-found' | 'allergen'): HttpProblem {
  return reason === 'not-found'
    ? new HttpProblem(404, TAG_NOT_FOUND)
    : new HttpProblem(409, ALLERGEN);
}

export function registerTagRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getTags, (c) => c.json({ tags: listTags(deps.db, c.req.valid('query').type) }, 200));

  v1.openapi(postTag, (c) => {
    const { type, name } = c.req.valid('json');
    const { tag, created } = findOrCreateTag(deps.db, type, name);
    if (!created) return c.json({ tag }, 200);
    c.var.logger.info({ tagId: tag.id, type }, 'tag created');
    return c.json({ tag }, 201);
  });

  v1.openapi(getTagUsage, (c) => c.json({ usage: tagUsage(deps.db, c.var.user) }, 200));

  const admin = (c: AuditRequest & { var: { user: PolicyUser } }): TagAdmin => ({
    origin: auditOrigin(c),
    user: c.var.user,
  });

  v1.openapi(putTag, (c) => {
    const { id } = c.req.valid('param');
    const result = renameTag(deps.db, admin(c), id, c.req.valid('json').name);
    if (!result.ok) {
      if (result.reason !== 'name-taken') throw refused(result.reason);
      throw new InvalidFields([
        {
          path: ['name'],
          detail: `Another tag of this type is already called “${result.existing.name}”. Merge into it instead.`,
        },
      ]);
    }
    c.var.logger.info({ tagId: id }, 'tag renamed');
    return c.json({ tag: result.tag }, 200);
  });

  v1.openapi(postTagMerge, (c) => {
    const { id } = c.req.valid('param');
    const result = mergeTag(deps.db, admin(c), id, c.req.valid('json').intoId);
    if (!result.ok) {
      if (result.reason === 'not-found' || result.reason === 'allergen')
        throw refused(result.reason);
      throw new InvalidFields([{ path: ['intoId'], detail: MERGE_REFUSALS[result.reason] }]);
    }
    c.var.logger.info({ tagId: id, intoId: result.tag.id }, 'tag merged');
    return c.json({ tag: result.tag }, 200);
  });

  v1.openapi(deleteTagRoute, (c) => {
    const { id } = c.req.valid('param');
    const result = deleteTag(deps.db, admin(c), id);
    if (!result.ok) throw refused(result.reason);
    c.var.logger.info({ tagId: id }, 'tag deleted');
    return c.body(null, 204);
  });
}

const MERGE_REFUSALS = {
  'same-tag': 'Choose another tag to merge it into.',
  'into-not-found': 'That tag no longer exists.',
  'other-type': 'Choose a tag of the same type.',
} as const;
