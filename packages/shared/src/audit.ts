import { z } from 'zod';
import { personSchema } from './user.ts';

/**
 * Every kind of audit event: the whole list in spec §3.1, including the ones later increments
 * record. The database's CHECK constraint uses this list, so adding one takes a migration.
 */
export const AUDIT_ACTIONS = [
  'setup.completed',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'user.role_changed',
  'user.deactivated',
  'user.reactivated',
  'sign_in.succeeded',
  'sign_in.failed',
  'sign_out.succeeded',
  'email.verified',
  'password.changed',
  'password.reset',
  'recipe.deleted',
  'recipe.restored',
  'recipe.purged',
  'revision.restored',
  'comment.deleted',
  'public_link.created',
  'public_link.revoked',
  'tag.renamed',
  'tag.merged',
  'tag.deleted',
  'instance.exported',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What an audit event can be about. A restored revision, a public link or a deleted comment targets
 * its recipe; a merged tag targets the tag that's gone, and names the one it went into.
 */
export const AUDIT_TARGET_TYPES = ['invitation', 'user', 'recipe', 'tag'] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export const AUDIT_PAGE_SIZE_MAX = 100;

export const auditEventSchema = z
  .object({
    id: z.int().positive(),
    action: z.enum(AUDIT_ACTIONS),
    actor: personSchema
      .nullable()
      .describe('Who did it. `null` when nobody was signed in, as for a failed sign-in.'),
    target: z
      .object({ type: z.enum(AUDIT_TARGET_TYPES), id: z.string() })
      .nullable()
      .describe('What it was done to, if anything.'),
    metadata: z
      .record(z.string(), z.unknown())
      .describe('Details that depend on the action, such as the email a failed sign-in tried.'),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AuditEvent' });

export const auditEventListQuerySchema = z.object({
  before: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Only events older than this ID: the `nextBefore` of the previous page.'),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(50),
  action: z.enum(AUDIT_ACTIONS).optional().describe('Only events of this kind.'),
});

export const auditEventListSchema = z
  .object({
    events: z.array(auditEventSchema).describe('Newest first.'),
    nextBefore: z
      .int()
      .positive()
      .nullable()
      .describe('Pass as `before` to get the next page. `null` on the last page.'),
  })
  .meta({ id: 'AuditEventList' });
