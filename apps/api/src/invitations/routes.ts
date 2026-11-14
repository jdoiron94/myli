import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  acceptInvitationRequestSchema,
  acceptInvitationResultSchema,
  createInvitationRequestSchema,
  createInvitationResultSchema,
  invitationDetailsSchema,
  invitationLookupRequestSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
} from '@myli/shared';
import { requirePermission } from '../auth/authorize.ts';
import type { AppEnv } from '../context.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import {
  acceptInvitation,
  createInvitation,
  findUsableInvitation,
  type InvitationDeps,
  type InvitationRow,
} from './invitations.ts';

/** One answer for unknown, used, revoked and expired links, so none can be told apart. */
const UNUSABLE = 'This invitation link is invalid, expired or already used. Ask for a new one.';

const CONFLICTS = {
  'user-exists': 'A user with this email already exists.',
  'already-invited': 'This email already has an open invitation.',
} as const;

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const postInvitation = createRoute({
  method: 'post',
  path: '/invitations',
  tags: ['Invitations'],
  summary: 'Invite someone',
  description: 'Admins only. Creates an invitation with the role the invitee will get.',
  middleware: [requirePermission('user.invite')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createInvitationRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'The invitation was created.',
      content: { 'application/json': { schema: createInvitationResultSchema } },
    },
    409: problem('A user, or an open invitation, already has this email.'),
    ...errorResponses,
  },
});

const postLookup = createRoute({
  method: 'post',
  path: '/invitations/lookup',
  tags: ['Invitations'],
  summary: 'Check an invitation link',
  description:
    'Public. Returns what the invitation is for, if the link still works. The token is sent in ' +
    'the body, never the URL, so it stays out of logs.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: invitationLookupRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'The link works.',
      content: { 'application/json': { schema: invitationDetailsSchema } },
    },
    404: problem('The link is invalid, expired, revoked or already used.'),
    ...errorResponses,
  },
});

const postAccept = createRoute({
  method: 'post',
  path: '/invitations/accept',
  tags: ['Invitations'],
  summary: 'Accept an invitation',
  description:
    'Public. Creates the account, with the invited email and role. It does not sign in: the new ' +
    'user then signs in with the same email and password.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: acceptInvitationRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'The account was created.',
      content: { 'application/json': { schema: acceptInvitationResultSchema } },
    },
    404: problem('The link is invalid, expired, revoked or already used.'),
    409: problem('A user with this email already exists.'),
    ...errorResponses,
  },
});

function toInvitation(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerInvitationRoutes(v1: OpenAPIHono<AppEnv>, deps: InvitationDeps) {
  v1.openapi(postInvitation, (c) => {
    const result = createInvitation(deps, { ...c.req.valid('json'), invitedBy: c.var.user.id });
    if (!result.ok) throw new HttpProblem(409, CONFLICTS[result.reason]);
    // Never the email or the link: one is personal, the other is a secret.
    c.var.logger.info({ invitationId: result.invitation.id }, 'invitation created');
    return c.json({ invitation: toInvitation(result.invitation), link: result.link }, 201);
  });

  v1.openapi(postLookup, (c) => {
    const row = findUsableInvitation(deps, c.req.valid('json').token);
    if (!row) throw new HttpProblem(404, UNUSABLE);
    return c.json(
      { email: row.email, role: row.role, expiresAt: row.expiresAt.toISOString() },
      200,
    );
  });

  v1.openapi(postAccept, async (c) => {
    const result = await acceptInvitation(deps, c.req.valid('json'));
    if (!result.ok) {
      throw result.reason === 'unusable'
        ? new HttpProblem(404, UNUSABLE)
        : new HttpProblem(409, CONFLICTS['user-exists']);
    }
    c.var.logger.info(
      { invitationId: result.invitationId, userId: result.user.id },
      'invitation accepted',
    );
    return c.json({ user: result.user }, 201);
  });
}
