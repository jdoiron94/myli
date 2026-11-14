import type { SetupRequest, User } from '@myli/shared';
import { and, eq, lt } from 'drizzle-orm';
import type { Auth } from '../auth/auth.ts';
import { createUserWithPassword } from '../auth/users.ts';
import type { Db } from '../db/database.ts';
import { setupClaim, user } from '../db/schema.ts';

/**
 * A claim older than this was left by a process that crashed mid-setup, and may be taken over.
 * Creating the admin takes well under a second.
 */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

const CLAIM_ID = 1;

export interface SetupDeps {
  db: Db;
  auth: Auth;
  now?: () => Date;
}

export type SetupResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'complete' | 'in-progress' };

/** True until the first user exists. Users are never deleted, so it never becomes true again. */
export function isSetupNeeded(db: Db): boolean {
  return db.select({ id: user.id }).from(user).limit(1).get() === undefined;
}

/**
 * Creates the first admin, if no user exists yet and no other setup is running (ADR 0009).
 *
 * Better Auth creates the user asynchronously, so it can't share a SQLite transaction with the
 * "no users yet?" check. Instead, one transaction makes that check and takes the single-row
 * claim; a concurrent setup finds the claim and gets `in-progress`. The claim is released once the
 * user exists or creating them failed, and a setup only releases its own claim.
 */
export async function runSetup(
  { db, auth, now = () => new Date() }: SetupDeps,
  request: SetupRequest,
): Promise<SetupResult> {
  const claimedAt = now();
  const claim = takeClaim(db, claimedAt);
  if (claim !== 'claimed') return { ok: false, reason: claim };

  try {
    const admin = await createUserWithPassword(auth, { ...request, role: 'admin' });
    return { ok: true, user: admin };
  } finally {
    db.delete(setupClaim)
      .where(and(eq(setupClaim.id, CLAIM_ID), eq(setupClaim.claimedAt, claimedAt)))
      .run();
  }
}

function takeClaim(db: Db, claimedAt: Date): 'claimed' | 'complete' | 'in-progress' {
  return db.transaction(
    (tx) => {
      if (tx.select({ id: user.id }).from(user).limit(1).get()) return 'complete';

      tx.delete(setupClaim)
        .where(lt(setupClaim.claimedAt, new Date(claimedAt.getTime() - STALE_CLAIM_MS)))
        .run();
      // On a conflict (another setup holds the claim), nothing is inserted or returned.
      const taken = tx
        .insert(setupClaim)
        .values({ id: CLAIM_ID, claimedAt })
        .onConflictDoNothing()
        .returning({ id: setupClaim.id })
        .all();
      return taken.length > 0 ? 'claimed' : 'in-progress';
    },
    // Take the write lock up front, so two setups can't both pass the check before either inserts.
    { behavior: 'immediate' },
  );
}
