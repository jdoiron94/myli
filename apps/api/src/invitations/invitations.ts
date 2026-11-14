import type { AcceptInvitationRequest, InvitationStatus, Role, User } from '@myli/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Auth } from '../auth/auth.ts';
import { createUserWithPassword } from '../auth/users.ts';
import type { Db, Tx } from '../db/database.ts';
import { invitation, user } from '../db/schema.ts';
import { hashInvitationToken, invitationLink, newInvitationToken } from './tokens.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InvitationDeps {
  db: Db;
  auth: Auth;
  publicUrl: string;
  ttlDays: number;
  now?: () => Date;
}

export type InvitationRow = typeof invitation.$inferSelect;

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRow; link: string }
  | { ok: false; reason: 'user-exists' | 'already-invited' };

/**
 * Creates an invitation and returns the link for it. The token is in the link only: the table
 * keeps its hash, so the link can't be shown again later.
 */
export function createInvitation(
  { db, publicUrl, ttlDays, now = () => new Date() }: InvitationDeps,
  request: { email: string; role: Role; invitedBy: string },
): CreateInvitationResult {
  const { token, tokenHash } = newInvitationToken();
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
      return tx
        .insert(invitation)
        .values({
          ...request,
          tokenHash,
          expiresAt: expiryFrom(createdAt, ttlDays),
          createdAt,
        })
        .returning()
        .get();
    },
    // Take the write lock first, so two requests can't both pass the checks before either inserts.
    // The unique index on open invitations backs this up.
    { behavior: 'immediate' },
  );
  if ('ok' in result) return result;
  return { ok: true, invitation: result, link: invitationLink(publicUrl, token) };
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
  | { ok: true; invitation: InvitationRow; link: string }
  | { ok: false; reason: 'not-open' | 'user-exists' };

/**
 * Gives an open invitation a new token and a full TTL from now, and returns the new link. The old
 * link stops working, because its hash is no longer stored.
 */
export function resendInvitation(
  { db, publicUrl, ttlDays, now = () => new Date() }: InvitationDeps,
  id: string,
): ResendInvitationResult {
  const { token, tokenHash } = newInvitationToken();
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
      return tx
        .update(invitation)
        .set({ tokenHash, expiresAt: expiryFrom(sentAt, ttlDays) })
        .where(eq(invitation.id, id))
        .returning()
        .get();
    },
    // Take the write lock first, so an acceptance can't claim the invitation between the checks
    // and the update, which therefore always finds the row.
    { behavior: 'immediate' },
  );
  if ('ok' in result) return result;
  return { ok: true, invitation: result, link: invitationLink(publicUrl, token) };
}

/** Revokes an open invitation, so its link stops working. False if none is open with this ID. */
export function revokeInvitation(
  { db, now = () => new Date() }: Pick<InvitationDeps, 'db' | 'now'>,
  id: string,
): boolean {
  const revoked = db
    .update(invitation)
    .set({ revokedAt: now() })
    .where(and(eq(invitation.id, id), isOpen()))
    .returning({ id: invitation.id })
    .all();
  return revoked.length > 0;
}

/** The invitation a token belongs to, if its link still works. */
export function findUsableInvitation(
  { db, now = () => new Date() }: Pick<InvitationDeps, 'db' | 'now'>,
  token: string,
): InvitationRow | undefined {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.tokenHash, hashInvitationToken(token)), isUsable(now())))
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
        .where(and(eq(invitation.tokenHash, hashInvitationToken(token)), isUsable(claimedAt)))
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
    });
    return { ok: true, user: created, invitationId: claim.id };
  } catch (error) {
    // Nothing else writes to a claimed invitation: resending and revoking skip it, because it's no
    // longer open. So this claim is still ours.
    db.update(invitation).set({ acceptedAt: null }).where(eq(invitation.id, claim.id)).run();
    throw error;
  }
}
