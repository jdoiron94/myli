import {
  type AcceptInvitationRequest,
  INVITATION_ACCEPT_PATH,
  type InvitationStatus,
  type Role,
  type User,
} from '@myli/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type AuditOrigin, recordAuditEvent, recordAuditEventAfterwards } from '../audit/audit.ts';
import type { Auth } from '../auth/auth.ts';
import { createUserWithPassword } from '../auth/users.ts';
import type { Db, Tx } from '../db/database.ts';
import { invitation, user } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob } from '../jobs/queue.ts';
import type { Logger } from '../logger.ts';
import { hashLinkToken, newLinkToken, tokenLink } from '../tokens.ts';
import { invitationEmail } from './email.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InvitationDeps {
  db: Db;
  auth: Auth;
  publicUrl: string;
  ttlDays: number;
  /** True when SMTP is configured: links are then emailed, never returned to the admin. */
  emailEnabled: boolean;
  now?: () => Date;
}

/**
 * Emails an invitation its link. The payload is only the ID: the token is never stored, not even
 * here (spec §3.1). So the handler makes a fresh token, stores its hash, and only then sends the
 * link. An email therefore never carries a link the database doesn't know. When a send fails, the
 * retry does the same with another token; nobody has the one before it.
 */
export const invitationEmailJob = defineJob({
  type: 'invitation.email',
  payload: z.object({ invitationId: z.string() }),
  async handle({ invitationId }, { services: { db, mailer, publicUrl }, logger }) {
    if (!mailer) {
      // Only when SMTP was turned off after the job was queued.
      logger.warn(
        { invitationId },
        'email is off, so the invitation email was not sent; resend the invitation to get a link',
      );
      return;
    }
    const { token, tokenHash } = newLinkToken();
    const issued = db.transaction(
      (tx) => {
        const [row] = tx
          .update(invitation)
          .set({ tokenHash, linkEmailed: true })
          .where(and(eq(invitation.id, invitationId), isUsable(new Date())))
          .returning()
          .all();
        if (!row) return undefined;
        const inviter = tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, row.invitedBy))
          .get();
        return { row, inviterName: inviter?.name ?? 'An admin' };
      },
      { behavior: 'immediate' },
    );
    if (!issued) {
      logger.info({ invitationId }, 'invitation was accepted, revoked or expired; no email sent');
      return;
    }
    const { row, inviterName } = issued;
    const { messageId } = await mailer.send(
      invitationEmail({
        to: row.email,
        inviterName,
        role: row.role,
        link: tokenLink(publicUrl, INVITATION_ACCEPT_PATH, token),
        expiresAt: row.expiresAt,
      }),
    );
    logger.info({ invitationId, messageId }, 'invitation email sent');
  },
});

export type InvitationRow = typeof invitation.$inferSelect;

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRow; link: string | undefined }
  | { ok: false; reason: 'user-exists' | 'already-invited' };

/**
 * Creates an invitation. With email on, it queues the email in the same transaction and returns
 * no link. Otherwise it returns the link, for the admin to share. Either way the table keeps only
 * a hash, so the link can't be shown again later.
 */
export function createInvitation(
  { db, publicUrl, ttlDays, emailEnabled, now = () => new Date() }: InvitationDeps,
  request: { email: string; role: Role; invitedBy: string },
  audit: AuditOrigin,
): CreateInvitationResult {
  // With email on, nobody ever sees this token: the email job replaces it before it sends.
  const { token, tokenHash } = newLinkToken();
  const createdAt = now();
  const result = db.transaction(
    (tx): CreateInvitationResult | InvitationRow => {
      if (emailTaken(tx, request.email)) return { ok: false, reason: 'user-exists' };
      const open = tx
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(invitation.email, request.email), isOpen()))
        .get();
      if (open) return { ok: false, reason: 'already-invited' };
      const row = tx
        .insert(invitation)
        .values({
          ...request,
          tokenHash,
          expiresAt: expiryFrom(createdAt, ttlDays),
          createdAt,
        })
        .returning()
        .get();
      if (emailEnabled) enqueueJob(tx, invitationEmailJob, { invitationId: row.id });
      recordAuditEvent(tx, audit, {
        action: 'invitation.created',
        target: { type: 'invitation', id: row.id },
        metadata: { email: row.email, role: row.role },
      });
      return row;
    },
    // Take the write lock first, so two requests can't both pass the checks before either inserts.
    // The unique index on open invitations backs this up.
    { behavior: 'immediate' },
  );
  if ('ok' in result) return result;
  return {
    ok: true,
    invitation: result,
    link: emailEnabled ? undefined : tokenLink(publicUrl, INVITATION_ACCEPT_PATH, token),
  };
}

function expiryFrom(start: Date, ttlDays: number) {
  return new Date(start.getTime() + ttlDays * DAY_MS);
}

function emailTaken(tx: Tx, email: string) {
  return tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get() !== undefined;
}

/**
 * Neither accepted nor revoked. Expired invitations are still open: an admin resends or revokes.
 * An invitation being accepted right now is already marked accepted, so it isn't open either.
 */
function isOpen() {
  return and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt));
}

/** Open and not expired: the link still works. */
function isUsable(at: Date) {
  return and(isOpen(), gt(invitation.expiresAt, at));
}

/** Whether an open invitation's link still works at `at`. */
export function invitationStatus(row: InvitationRow, at: Date): InvitationStatus {
  return row.expiresAt > at ? 'pending' : 'expired';
}

/** Every open invitation, expired or not, newest first. */
export function listOpenInvitations({ db }: Pick<InvitationDeps, 'db'>): InvitationRow[] {
  return db
    .select()
    .from(invitation)
    .where(isOpen())
    .orderBy(desc(invitation.createdAt), desc(invitation.id))
    .all();
}

export type ResendInvitationResult =
  | { ok: true; invitation: InvitationRow; link: string | undefined }
  | { ok: false; reason: 'not-open' | 'user-exists' };

/**
 * Gives an open invitation a new token and a full TTL from now. The old link stops working at
 * once, because its hash is no longer stored. Then, like `createInvitation`, it queues the email
 * or returns the new link.
 */
export function resendInvitation(
  { db, publicUrl, ttlDays, emailEnabled, now = () => new Date() }: InvitationDeps,
  id: string,
  audit: AuditOrigin,
): ResendInvitationResult {
  const { token, tokenHash } = newLinkToken();
  const sentAt = now();
  const result = db.transaction(
    (tx): ResendInvitationResult | InvitationRow => {
      const row = tx
        .select()
        .from(invitation)
        .where(and(eq(invitation.id, id), isOpen()))
        .get();
      if (!row) return { ok: false, reason: 'not-open' };
      if (emailTaken(tx, row.email)) return { ok: false, reason: 'user-exists' };
      const updated = tx
        .update(invitation)
        .set({ tokenHash, linkEmailed: false, expiresAt: expiryFrom(sentAt, ttlDays) })
        .where(eq(invitation.id, id))
        .returning()
        .get();
      if (emailEnabled) enqueueJob(tx, invitationEmailJob, { invitationId: id });
      recordAuditEvent(tx, audit, {
        action: 'invitation.resent',
        target: { type: 'invitation', id },
        metadata: { email: row.email },
      });
      return updated;
    },
    // Take the write lock first, so an acceptance can't claim the invitation between the checks
    // and the update, which therefore always finds the row.
    { behavior: 'immediate' },
  );
  if ('ok' in result) return result;
  return {
    ok: true,
    invitation: result,
    link: emailEnabled ? undefined : tokenLink(publicUrl, INVITATION_ACCEPT_PATH, token),
  };
}

/** Revokes an open invitation, so its link stops working. False if none is open with this ID. */
export function revokeInvitation(
  { db, now = () => new Date() }: Pick<InvitationDeps, 'db' | 'now'>,
  id: string,
  audit: AuditOrigin,
): boolean {
  return db.transaction((tx) => {
    const [revoked] = tx
      .update(invitation)
      .set({ revokedAt: now() })
      .where(and(eq(invitation.id, id), isOpen()))
      .returning({ email: invitation.email })
      .all();
    if (!revoked) return false;
    recordAuditEvent(tx, audit, {
      action: 'invitation.revoked',
      target: { type: 'invitation', id },
      metadata: { email: revoked.email },
    });
    return true;
  });
}

/** The invitation a token belongs to, if its link still works. */
export function findUsableInvitation(
  { db, now = () => new Date() }: Pick<InvitationDeps, 'db' | 'now'>,
  token: string,
): InvitationRow | undefined {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.tokenHash, hashLinkToken(token)), isUsable(now())))
    .get();
}

export type AcceptInvitationResult =
  | { ok: true; user: User; invitationId: string }
  | { ok: false; reason: 'unusable' | 'user-exists' };

/**
 * Creates the invited user (ADR 0005). One conditional update claims the invitation, so exactly
 * one of several simultaneous acceptances wins. Better Auth creates the user asynchronously, so it
 * can't share that transaction; if creating them fails, the claim is released and the link works
 * again.
 */
export async function acceptInvitation(
  { db, auth, now = () => new Date() }: InvitationDeps,
  { token, name, password }: AcceptInvitationRequest,
): Promise<AcceptInvitationResult> {
  const claimedAt = now();
  const claim = db.transaction(
    (tx): { ok: false; reason: 'unusable' | 'user-exists' } | InvitationRow => {
      const row = tx
        .select()
        .from(invitation)
        .where(and(eq(invitation.tokenHash, hashLinkToken(token)), isUsable(claimedAt)))
        .get();
      if (!row) return { ok: false, reason: 'unusable' };
      if (emailTaken(tx, row.email)) return { ok: false, reason: 'user-exists' };
      tx.update(invitation)
        .set({ acceptedAt: claimedAt })
        .where(and(eq(invitation.id, row.id), isUsable(claimedAt)))
        .run();
      return row;
    },
    // Take the write lock first: of several acceptances, only the first finds the row usable.
    { behavior: 'immediate' },
  );
  if ('ok' in claim) return claim;

  try {
    const created = await createUserWithPassword(auth, {
      name,
      email: claim.email,
      password,
      role: claim.role,
      emailVerified: claim.linkEmailed,
    });
    return { ok: true, user: created, invitationId: claim.id };
  } catch (error) {
    // Nothing else writes to a claimed invitation: resending and revoking skip it, because it's no
    // longer open. So this claim is still ours.
    db.update(invitation).set({ acceptedAt: null }).where(eq(invitation.id, claim.id)).run();
    throw error;
  }
}

/**
 * Records that someone accepted an invitation and now has an account. Better Auth created them
 * outside the claim's transaction, so this comes afterwards.
 */
export function recordInvitationAccepted(
  db: Db,
  logger: Logger,
  origin: Omit<AuditOrigin, 'actorId'>,
  { user: created, invitationId }: { user: User; invitationId: string },
): void {
  recordAuditEventAfterwards(logger, 'invitation.accepted', () => {
    recordAuditEvent(
      db,
      { ...origin, actorId: created.id },
      {
        action: 'invitation.accepted',
        target: { type: 'invitation', id: invitationId },
        metadata: { email: created.email, role: created.role },
      },
    );
  });
}
