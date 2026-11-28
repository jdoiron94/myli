import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  changeRoleRequestSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  userAccountListSchema,
  userAccountResultSchema,
  userIdParamsSchema,
} from '@myli/shared';
import { type AuditRequest, auditOrigin } from '../audit/audit.ts';
import { forbidden, requirePermission } from '../auth/authorize.ts';
import type { CurrentUser } from '../auth/session.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/database.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import {
  type AdminOrigin,
  changeRole,
  deactivateUser,
  listUserAccounts,
  type ManageResult,
  reactivateUser,
  type UserAccountRow,
} from './manage.ts';

const NOT_FOUND = 'No user has this ID.';

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const account = (description: string) => ({
  description,
  content: { 'application/json': { schema: userAccountResultSchema } },
});

const getUsers = createRoute({
  method: 'get',
  path: '/users',
  tags: ['Users'],
  summary: 'List users',
  description: 'Admins only. Every user, deactivated ones included, oldest first.',
  middleware: [requirePermission('user.manage')] as const,
  responses: {
    200: {
      description: 'Every user.',
      content: { 'application/json': { schema: userAccountListSchema } },
    },
    ...errorResponses,
  },
});

const putRole = createRoute({
  method: 'put',
  path: '/users/{id}/role',
  tags: ['Users'],
  summary: "Change a user's role",
  description:
    "Admins only. Applies from the user's next request. Admins can't change their own role, so " +
    'an active admin always remains. Setting the role the user already has changes nothing.',
  middleware: [requirePermission('user.manage')] as const,
  request: {
    params: userIdParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: changeRoleRequestSchema } },
    },
  },
  responses: {
    200: account('The user, with their role now.'),
    404: problem('No user has this ID.'),
    409: problem('The user is you.'),
    ...errorResponses,
  },
});

const postDeactivate = createRoute({
  method: 'post',
  path: '/users/{id}/deactivate',
  tags: ['Users'],
  summary: 'Deactivate a user',
  description:
    "Admins only. Ends the user's sessions and refuses their sign-ins until they're reactivated. " +
    "Their recipes stay as they are: private ones stay private. Admins can't deactivate " +
    'themselves, so an active admin always remains. Send `Content-Type: application/json` even ' +
    'though there is no body.',
  middleware: [requirePermission('user.manage')] as const,
  request: { params: userIdParamsSchema },
  responses: {
    200: account('The user, deactivated.'),
    404: problem('No user has this ID.'),
    409: problem('The user is you.'),
    ...errorResponses,
  },
});

const postReactivate = createRoute({
  method: 'post',
  path: '/users/{id}/reactivate',
  tags: ['Users'],
  summary: 'Reactivate a user',
  description:
    'Admins only. The user can sign in again. Send `Content-Type: application/json` even though ' +
    'there is no body.',
  middleware: [requirePermission('user.manage')] as const,
  request: { params: userIdParamsSchema },
  responses: {
    200: account('The user, active again.'),
    404: problem('No user has this ID.'),
    ...errorResponses,
  },
});

function toUserAccount(row: UserAccountRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar,
    deactivated: row.banned,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The account a change left, or the problem that stopped it. */
function outcome(result: ManageResult, self: string): UserAccountRow {
  if (result.ok) return result.user;
  // The admin was demoted or deactivated after the request passed its guard.
  if (result.reason === 'forbidden') throw forbidden();
  if (result.reason === 'not-found') throw new HttpProblem(404, NOT_FOUND);
  throw new HttpProblem(409, self);
}

function adminOrigin(c: AuditRequest & { var: { user: CurrentUser } }) {
  return { ...auditOrigin(c), actorId: c.var.user.id } satisfies AdminOrigin;
}

export function registerUserRoutes(v1: OpenAPIHono<AppEnv>, deps: { db: Db }) {
  v1.openapi(getUsers, (c) => c.json({ users: listUserAccounts(deps.db).map(toUserAccount) }, 200));

  v1.openapi(putRole, (c) => {
    const { id } = c.req.valid('param');
    const result = changeRole(deps.db, adminOrigin(c), id, c.req.valid('json').role);
    const row = outcome(result, "You can't change your own role. Another admin has to.");
    if (result.ok && result.changed) c.var.logger.info({ userId: id }, 'user role changed');
    return c.json({ user: toUserAccount(row) }, 200);
  });

  v1.openapi(postDeactivate, (c) => {
    const { id } = c.req.valid('param');
    const result = deactivateUser(deps.db, adminOrigin(c), id);
    const row = outcome(result, "You can't deactivate yourself. Another admin has to.");
    if (result.ok && result.changed) {
      c.var.logger.info({ userId: id, sessionsEnded: result.sessionsEnded }, 'user deactivated');
    }
    return c.json({ user: toUserAccount(row) }, 200);
  });

  v1.openapi(postReactivate, (c) => {
    const { id } = c.req.valid('param');
    const result = reactivateUser(deps.db, adminOrigin(c), id);
    if (!result.ok)
      throw result.reason === 'forbidden' ? forbidden() : new HttpProblem(404, NOT_FOUND);
    if (result.changed) c.var.logger.info({ userId: id }, 'user reactivated');
    return c.json({ user: toUserAccount(result.user) }, 200);
  });
}
