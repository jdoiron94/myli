import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  acceptInvitationRequestSchema,
  acceptInvitationResultSchema,
  createInvitationRequestSchema,
  invitationDetailsSchema,
  invitationIdParamsSchema,
  invitationListSchema,
  invitationLookupRequestSchema,
  invitationWithLinkSchema,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
} from '@myli/shared';
import { auditOrigin, recordAuditEvent, recordAuditEventAfterwards } from '../audit/audit.ts';
import { requirePermission } from '../auth/authorize.ts';
import type { AppEnv } from '../context.ts';
import { errorResponses, HttpProblem } from '../problems.ts';
import {
  acceptInvitation,
  createInvitation,
  findUsableInvitation,
  type InvitationDeps,
  type InvitationRow,
  invitationStatus,
  listOpenInvitations,
  resendInvitation,
  revokeInvitation,
} from './invitations.ts';

/** One answer for unknown, used, revoked and expired links, so none can be told apart. */
const UNUSABLE = 'This invitation link is invalid, expired or already used. Ask for a new one.';

/** For admins, who may know the invitation exists: accepted, revoked and unknown IDs alike. */
const NOT_OPEN = 'No open invitation has this ID. It may have been accepted or revoked.';

const CONFLICTS = {
  'user-exists': 'A user with this email already exists.',
  'already-invited': 'This email already has an open invitation.',
} as const;

const problem = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
});

const getInvitations = createRoute({
  method: 'get',
  path: '/invitations',
  tags: ['Invitations'],
  summary: 'List open invitations',
  description:
    'Admins only. Every invitation that is neither accepted nor revoked, newest first, including ' +
    'expired ones, which an admin resends or revokes.',
  middleware: [requirePermission('user.invite')] as const,
  responses: {
    200: {
      description: 'The open invitations.',
      content: { 'application/json': { schema: invitationListSchema } },
    },
    ...errorResponses,
  },
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
      content: { 'application/json': { schema: invitationWithLinkSchema } },
    },
    409: problem('A user, or an open invitation, already has this email.'),
    ...errorResponses,
  },
});

const postResend = createRoute({
  method: 'post',
  path: '/invitations/{id}/resend',
  tags: ['Invitations'],
  summary: 'Resend an invitation',
  description:
    'Admins only. Issues a new link that works for the full invitation lifetime again, and stops ' +
    'the old link working. Works on expired invitations too. Send `Content-Type: ' +
    'application/json` even though there is no body.',
  middleware: [requirePermission('user.invite')] as const,
  request: { params: invitationIdParamsSchema },
  responses: {
    200: {
      description: 'The invitation has a new link.',
      content: { 'application/json': { schema: invitationWithLinkSchema } },
    },
    404: problem('No open invitation has this ID.'),
    409: problem('A user with this email exists now.'),
    ...errorResponses,
  },
});

const postRevoke = createRoute({
  method: 'post',
  path: '/invitations/{id}/revoke',
  tags: ['Invitations'],
  summary: 'Revoke an invitation',
  description:
    'Admins only. The link stops working, and the email can be invited again. Send ' +
    '`Content-Type: application/json` even though there is no body.',
  middleware: [requirePermission('user.invite')] as const,
  request: { params: invitationIdParamsSchema },
  responses: {
    204: { description: 'The invitation was revoked.' },
    404: problem('No open invitation has this ID.'),
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

function toInvitation(row: InvitationRow, at: Date) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: invitationStatus(row, at),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The link is there only when myli doesn't email it. */
function withLink(invitation: ReturnType<typeof toInvitation>, link: string | undefined) {
  return { invitation, ...(link !== undefined && { link }) };
}

export function registerInvitationRoutes(v1: OpenAPIHono<AppEnv>, deps: InvitationDeps) {
  const now = deps.now ?? (() => new Date());

  v1.openapi(getInvitations, (c) => {
    const at = now();
    return c.json(
      { invitations: listOpenInvitations(deps).map((row) => toInvitation(row, at)) },
      200,
    );
  });

  v1.openapi(postInvitation, (c) => {
    const result = createInvitation(
      deps,
      { ...c.req.valid('json'), invitedBy: c.var.user.id },
      auditOrigin(c),
    );
    if (!result.ok) throw new HttpProblem(409, CONFLICTS[result.reason]);
    // Never the email or the link: one is personal, the other is a secret.
    c.var.logger.info({ invitationId: result.invitation.id }, 'invitation created');
    return c.json(withLink(toInvitation(result.invitation, now()), result.link), 201);
  });

  v1.openapi(postResend, (c) => {
    const result = resendInvitation(deps, c.req.valid('param').id, auditOrigin(c));
    if (!result.ok) {
      throw result.reason === 'not-open'
        ? new HttpProblem(404, NOT_OPEN)
        : new HttpProblem(409, CONFLICTS['user-exists']);
    }
    c.var.logger.info({ invitationId: result.invitation.id }, 'invitation resent');
    return c.json(withLink(toInvitation(result.invitation, now()), result.link), 200);
  });

  v1.openapi(postRevoke, (c) => {
    const { id } = c.req.valid('param');
    if (!revokeInvitation(deps, id, auditOrigin(c))) throw new HttpProblem(404, NOT_OPEN);
    c.var.logger.info({ invitationId: id }, 'invitation revoked');
    return c.body(null, 204);
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
    // Better Auth created the user outside the claim's transaction, so this comes afterwards.
    recordAuditEventAfterwards(c.var.logger, 'invitation.accepted', () => {
      recordAuditEvent(
        deps.db,
        { ...auditOrigin(c), actorId: result.user.id },
        {
          action: 'invitation.accepted',
          target: { type: 'invitation', id: result.invitationId },
          metadata: { email: result.user.email, role: result.user.role },
        },
      );
    });
    return c.json({ user: result.user }, 201);
  });
}
