import { PASSWORD_RESET_PATH } from '@myli/shared';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Auth } from '../auth/auth.ts';
import type { Db } from '../db/database.ts';
import { account, session, user, userToken } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { hashLinkToken, tokenLink } from '../tokens.ts';
import { passwordResetEmail } from './email.ts';
import { emailUserTokenLink } from './link-email.ts';
import { emailedRecently, issueUserToken, useUserToken } from './user-tokens.ts';

/** Emails a reset link (ADR 0019), made as `emailUserTokenLink()` makes every account link. */
export const passwordResetEmailJob = defineJob({
  type: 'password_reset.email',
  payload: z.object({ tokenId: z.string() }),
  handle: ({ tokenId }, context) =>
    emailUserTokenLink(tokenId, context, {
      kind: 'password reset',
      path: PASSWORD_RESET_PATH,
      message: passwordResetEmail,
    }),
});

/** What became of a request for a reset email. Only the log is told: the answer is always the same. */
export type ResetRequestOutcome =
  | 'queued'
  | 'no-account'
  | 'deactivated'
  | 'unverified'
  | 'too-soon';

/**
 * Queues a reset email, with its token row, in one transaction: only to the verified address of an
 * active account, and only if none went to it in the last five minutes (spec §3.1).
 */
export function requestPasswordReset(
  db: Db,
  { email, at }: { email: string; at: Date },
): ResetRequestOutcome {
  return db.transaction((tx) => {
    const row = tx
      .select({ id: user.id, verified: user.emailVerified, banned: user.banned })
      .from(user)
      .where(eq(user.email, email))
      .get();
    if (!row) return 'no-account';
    if (row.banned) return 'deactivated';
    if (!row.verified) return 'unverified';
    if (emailedRecently(tx, row.id, 'reset_password', at)) return 'too-soon';
    const { id } = issueUserToken(tx, { userId: row.id, email, purpose: 'reset_password', at });
    enqueueJob(tx, passwordResetEmailJob, { tokenId: id });
    return 'queued';
  });
}

export type OperatorResetLink =
  | { ok: true; link: string; expiresAt: Date }
  | { ok: false; reason: 'no-account' | 'deactivated' };

/**
 * A reset link for whoever runs the server to pass on, for any active account, verified or not
 * (ADR 0019): `reset-password.ts` prints it. It works as an emailed one does, and replaces any sent
 * before. Run beside the API, so its transaction takes the write lock as it begins.
 */
export function operatorResetLink(
  db: Db,
  { email, publicUrl, at }: { email: string; publicUrl: string; at: Date },
): OperatorResetLink {
  return db.transaction(
    (tx): OperatorResetLink => {
      const row = tx
        .select({ id: user.id, banned: user.banned })
        .from(user)
        .where(eq(user.email, email))
        .get();
      if (!row) return { ok: false, reason: 'no-account' };
      if (row.banned) return { ok: false, reason: 'deactivated' };
      const { token, expiresAt } = issueUserToken(tx, {
        userId: row.id,
        email,
        purpose: 'reset_password',
        at,
      });
      return { ok: true, link: tokenLink(publicUrl, PASSWORD_RESET_PATH, token), expiresAt };
    },
    { behavior: 'immediate' },
  );
}

/** Whether `token` is a reset link that works now, without using it up. */
function isUsableResetLink(db: Db, token: string, at: Date): boolean {
  const row = db
    .select({ id: userToken.id })
    .from(userToken)
    .where(
      and(
        eq(userToken.tokenHash, hashLinkToken(token)),
        eq(userToken.purpose, 'reset_password'),
        gt(userToken.expiresAt, at),
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * Uses a reset link: sets the account's new password and ends every one of its sessions, with its
 * audit event, in one transaction (ADR 0019). The link's owner is the actor. `undefined` for a link
 * that doesn't work, or whose account was deactivated, which uses it up all the same.
 *
 * Better Auth hashes the password, with the hasher it signs in with; myli writes the hash to the
 * account's credential.
 */
export async function resetPassword(
  db: Db,
  auth: Auth,
  {
    token,
    newPassword,
    origin,
    at,
  }: { token: string; newPassword: string; origin: Omit<AuditOrigin, 'actorId'>; at: Date },
): Promise<{ email: string } | undefined> {
  // Hashing is slow on purpose, and anyone may send this: only for a link that works.
  if (!isUsableResetLink(db, token, at)) return undefined;
  const passwordHash = await (await auth.$context).password.hash(newPassword);

  return db.transaction((tx) => {
    // A request with the same link may have used it while this one was hashing.
    const used = useUserToken(tx, token, 'reset_password', at);
    if (!used) return undefined;
    const owner = tx
      .select({ email: user.email, banned: user.banned })
      .from(user)
      .where(eq(user.id, used.userId))
      .get();
    if (!owner || owner.banned || owner.email !== used.email) return undefined;

    const [credential] = tx
      .update(account)
      .set({ password: passwordHash, updatedAt: at })
      .where(and(eq(account.userId, used.userId), eq(account.providerId, 'credential')))
      .returning({ id: account.id })
      .all();
    // Every account is created with a password (`createUserWithPassword()`).
    if (!credential) throw new Error(`user ${used.userId} has no password to reset`);
    const sessionsEnded = tx
      .delete(session)
      .where(eq(session.userId, used.userId))
      .returning({ id: session.id })
      .all().length;
    recordAuditEvent(
      tx,
      { ...origin, actorId: used.userId },
      {
        action: 'password.reset',
        target: { type: 'user', id: used.userId },
        metadata: { sessionsEnded },
      },
    );
    return { email: owner.email };
  });
}
