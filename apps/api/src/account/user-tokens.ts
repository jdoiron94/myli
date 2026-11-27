import { and, eq, gt } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { type UserTokenPurpose, userToken } from '../db/schema.ts';
import { hashLinkToken, newLinkToken } from '../tokens.ts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long each kind of link works (spec §3.1). */
export const USER_TOKEN_LIFETIMES_MS: Record<UserTokenPurpose, number> = {
  verify_email: 24 * HOUR_MS,
  reset_password: HOUR_MS,
};

/** The least time between two emails of one kind to one account. */
export const ACCOUNT_EMAIL_INTERVAL_MS = 5 * MINUTE_MS;

export type UserTokenRow = typeof userToken.$inferSelect;

/**
 * Whether the user was sent a link of this kind less than `ACCOUNT_EMAIL_INTERVAL_MS` before
 * `at`. Their newest token says when, used or not: a used one is gone, and spaces nothing out.
 */
export function emailedRecently(
  tx: Db | Tx,
  userId: string,
  purpose: UserTokenPurpose,
  at: Date,
): boolean {
  const since = new Date(at.getTime() - ACCOUNT_EMAIL_INTERVAL_MS);
  const recent = tx
    .select({ id: userToken.id })
    .from(userToken)
    .where(
      and(
        eq(userToken.userId, userId),
        eq(userToken.purpose, purpose),
        gt(userToken.createdAt, since),
      ),
    )
    .get();
  return recent !== undefined;
}

/**
 * Makes the user's token of this kind, for `email`, replacing any they had, so only the newest
 * link works. Returns its row's ID, the token, for a link, and when it expires. A caller whose
 * email job will send the link throws the token away: the job gives the row a new one before it
 * sends.
 */
export function issueUserToken(
  tx: Db | Tx,
  {
    userId,
    email,
    purpose,
    at,
  }: { userId: string; email: string; purpose: UserTokenPurpose; at: Date },
): { id: string; token: string; expiresAt: Date } {
  const { token, tokenHash } = newLinkToken();
  tx.delete(userToken)
    .where(and(eq(userToken.userId, userId), eq(userToken.purpose, purpose)))
    .run();
  const { id, expiresAt } = tx
    .insert(userToken)
    .values({
      userId,
      purpose,
      tokenHash,
      email,
      expiresAt: new Date(at.getTime() + USER_TOKEN_LIFETIMES_MS[purpose]),
      createdAt: at,
    })
    .returning({ id: userToken.id, expiresAt: userToken.expiresAt })
    .get();
  return { id, token, expiresAt };
}

/**
 * For an email job: gives the token row `id` a new secret, stored before the job sends it, so the
 * link works as the email leaves. Nothing, if the row was used or replaced since, or has expired.
 */
export function reissueUserToken(
  db: Db,
  id: string,
  at: Date,
): { row: UserTokenRow; token: string } | undefined {
  const { token, tokenHash } = newLinkToken();
  // `all()`, not `get()`: Drizzle types `get()` as always finding a row.
  const [row] = db.transaction(
    (tx) =>
      tx
        .update(userToken)
        .set({ tokenHash })
        .where(and(eq(userToken.id, id), gt(userToken.expiresAt, at)))
        .returning()
        .all(),
    // A script beside the API can issue tokens too (the operator's reset link).
    { behavior: 'immediate' },
  );
  return row && { row, token };
}

/**
 * Uses a link's token up: deletes its row and returns it, if the token is of this kind and hasn't
 * expired. Call it in the transaction that acts on the link. Of two uses at once, only one finds
 * the row.
 */
export function useUserToken(
  tx: Tx,
  token: string,
  purpose: UserTokenPurpose,
  at: Date,
): UserTokenRow | undefined {
  const [row] = tx
    .delete(userToken)
    .where(
      and(
        eq(userToken.tokenHash, hashLinkToken(token)),
        eq(userToken.purpose, purpose),
        gt(userToken.expiresAt, at),
      ),
    )
    .returning()
    .all();
  return row;
}
