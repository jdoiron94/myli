import { EMAIL_VERIFICATION_PATH } from '@myli/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db } from '../db/database.ts';
import { user } from '../db/schema.ts';
import { defineJob } from '../jobs/define.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { verificationEmail } from './email.ts';
import { emailUserTokenLink } from './link-email.ts';
import { emailedRecently, issueUserToken, useUserToken } from './user-tokens.ts';

/** Emails a verification link (ADR 0019), made as `emailUserTokenLink()` makes every account link. */
export const emailVerificationJob = defineJob({
  type: 'email_verification.email',
  payload: z.object({ tokenId: z.string() }),
  handle: ({ tokenId }, context) =>
    emailUserTokenLink(tokenId, context, {
      kind: 'verification',
      path: EMAIL_VERIFICATION_PATH,
      message: verificationEmail,
    }),
});

/** Whether the user's address is verified. */
export function isEmailVerified(db: Db, userId: string): boolean {
  const row = db
    .select({ verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  return row?.verified ?? false;
}

export type RequestVerificationResult = 'queued' | 'verified' | 'email-off' | 'too-soon';

/**
 * Queues a verification email to the user's address, with its token row, in one transaction.
 * Nothing when it's verified already, when email is off, or when a link went less than five
 * minutes ago.
 */
export function requestEmailVerification(
  db: Db,
  { userId, emailEnabled, at }: { userId: string; emailEnabled: boolean; at: Date },
): RequestVerificationResult {
  return db.transaction((tx) => {
    const row = tx
      .select({ email: user.email, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    // A signed-in user always exists: users are never deleted.
    if (!row) throw new Error(`no user ${userId}`);
    if (row.verified) return 'verified';
    if (!emailEnabled) return 'email-off';
    if (emailedRecently(tx, userId, 'verify_email', at)) return 'too-soon';
    const { id } = issueUserToken(tx, { userId, email: row.email, purpose: 'verify_email', at });
    enqueueJob(tx, emailVerificationJob, { tokenId: id });
    return 'queued';
  });
}

/**
 * Uses a verification link: verifies the address it was made for, if the user still has it, and
 * records that, all in one transaction. The link's owner is the actor, whoever is signed in where
 * it was opened. `undefined` for a link that doesn't work.
 */
export function confirmEmailVerification(
  db: Db,
  { token, origin, at }: { token: string; origin: Omit<AuditOrigin, 'actorId'>; at: Date },
): { email: string } | undefined {
  return db.transaction((tx) => {
    const used = useUserToken(tx, token, 'verify_email', at);
    if (!used) return undefined;
    const [verified] = tx
      .update(user)
      .set({ emailVerified: true })
      .where(and(eq(user.id, used.userId), eq(user.email, used.email)))
      .returning({ email: user.email })
      .all();
    if (!verified) return undefined;
    recordAuditEvent(
      tx,
      { ...origin, actorId: used.userId },
      {
        action: 'email.verified',
        target: { type: 'user', id: used.userId },
        metadata: { email: verified.email },
      },
    );
    return verified;
  });
}
