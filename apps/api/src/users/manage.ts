import { can, type Role } from '@myli/shared';
import { asc, eq } from 'drizzle-orm';
import { avatarColumn } from '../account/avatar.ts';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import { session, user } from '../db/schema.ts';

/**
 * Role changes and deactivation (ADR 0010). They write Better Auth's `role` and `banned` columns
 * and its `session` rows directly, instead of calling `auth.api.setRole` and `banUser`, so that the
 * check on the acting admin, the change and its audit event share one transaction.
 */

const ACCOUNT_COLUMNS = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: user.banned,
  createdAt: user.createdAt,
  avatar: avatarColumn(user.id),
};

export type UserAccountRow = Pick<
  typeof user.$inferSelect,
  'id' | 'name' | 'email' | 'role' | 'banned' | 'createdAt'
> & { avatar: string | null };

/** The admin making the change, and where the request came from. */
export type AdminOrigin = AuditOrigin & { actorId: string };

export type ManageResult =
  | { ok: true; user: UserAccountRow; changed: boolean }
  | { ok: false; reason: 'forbidden' | 'self' | 'not-found' };

export type ReactivateResult =
  | { ok: true; user: UserAccountRow; changed: boolean }
  | { ok: false; reason: 'forbidden' | 'not-found' };

export type DeactivateResult =
  | { ok: true; user: UserAccountRow; changed: boolean; sessionsEnded: number }
  | { ok: false; reason: 'forbidden' | 'self' | 'not-found' };

export function listUserAccounts(db: Db): UserAccountRow[] {
  return db.select(ACCOUNT_COLUMNS).from(user).orderBy(asc(user.createdAt), asc(user.id)).all();
}

function findAccount(tx: Tx, id: string) {
  return tx.select(ACCOUNT_COLUMNS).from(user).where(eq(user.id, id)).get();
}

/**
 * Whether the acting admin may still manage users. The request's guard saw the role the request
 * started with; another admin may have demoted or deactivated them since.
 *
 * Checked inside the change's transaction, this is also what keeps an active admin on the instance
 * (setup is closed for good once users exist, so without one nobody could manage it). The actor is
 * an active admin and can't change their own account, so they're still one after the change. When
 * two admins demote or deactivate each other at the same moment, the transactions run one after
 * the other, and the second is refused here.
 */
function actorMayManage(tx: Tx, actorId: string): boolean {
  const actor = findAccount(tx, actorId);
  return actor !== undefined && !actor.banned && can(actor, 'user.manage');
}

/** Gives a user another role. It applies from their next request: every request reads it. */
export function changeRole(db: Db, origin: AdminOrigin, userId: string, role: Role): ManageResult {
  return db.transaction(
    (tx): ManageResult => {
      if (!actorMayManage(tx, origin.actorId)) return { ok: false, reason: 'forbidden' };
      if (userId === origin.actorId) return { ok: false, reason: 'self' };
      const row = findAccount(tx, userId);
      if (!row) return { ok: false, reason: 'not-found' };
      if (row.role === role) return { ok: true, user: row, changed: false };

      const updated = tx
        .update(user)
        .set({ role })
        .where(eq(user.id, userId))
        .returning(ACCOUNT_COLUMNS)
        .get();
      recordAuditEvent(tx, origin, {
        action: 'user.role_changed',
        target: { type: 'user', id: userId },
        metadata: { from: row.role, to: role },
      });
      return { ok: true, user: updated, changed: true };
    },
    // Take the write lock first, so the check on the actor still holds when the update runs.
    { behavior: 'immediate' },
  );
}

/**
 * Deactivates a user: a permanent ban, as Better Auth's admin plugin stores it, so it refuses their
 * sign-ins. Deleting their sessions signs them out everywhere on their next request. Their recipes
 * are left exactly as they are: private ones stay private (spec §3.1).
 */
export function deactivateUser(db: Db, origin: AdminOrigin, userId: string): DeactivateResult {
  return db.transaction(
    (tx): DeactivateResult => {
      if (!actorMayManage(tx, origin.actorId)) return { ok: false, reason: 'forbidden' };
      if (userId === origin.actorId) return { ok: false, reason: 'self' };
      const row = findAccount(tx, userId);
      if (!row) return { ok: false, reason: 'not-found' };
      if (row.banned) return { ok: true, user: row, changed: false, sessionsEnded: 0 };

      const updated = tx
        .update(user)
        .set({ banned: true, banReason: null, banExpires: null })
        .where(eq(user.id, userId))
        .returning(ACCOUNT_COLUMNS)
        .get();
      const sessionsEnded = tx
        .delete(session)
        .where(eq(session.userId, userId))
        .returning({ id: session.id })
        .all().length;
      recordAuditEvent(tx, origin, {
        action: 'user.deactivated',
        target: { type: 'user', id: userId },
        metadata: { sessionsEnded },
      });
      return { ok: true, user: updated, changed: true, sessionsEnded };
    },
    { behavior: 'immediate' },
  );
}

/** Lets a deactivated user sign in again. */
export function reactivateUser(db: Db, origin: AdminOrigin, userId: string): ReactivateResult {
  return db.transaction(
    (tx): ReactivateResult => {
      if (!actorMayManage(tx, origin.actorId)) return { ok: false, reason: 'forbidden' };
      const row = findAccount(tx, userId);
      if (!row) return { ok: false, reason: 'not-found' };
      if (!row.banned) return { ok: true, user: row, changed: false };

      const updated = tx
        .update(user)
        .set({ banned: false, banReason: null, banExpires: null })
        .where(eq(user.id, userId))
        .returning(ACCOUNT_COLUMNS)
        .get();
      recordAuditEvent(tx, origin, {
        action: 'user.reactivated',
        target: { type: 'user', id: userId },
      });
      return { ok: true, user: updated, changed: true };
    },
    { behavior: 'immediate' },
  );
}
