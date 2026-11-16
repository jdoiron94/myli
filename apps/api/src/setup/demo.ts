import { randomInt } from 'node:crypto';
import { passwordSchema, type Role } from '@myli/shared';
import {
  acceptInvitation,
  createInvitation,
  type InvitationDeps,
  recordInvitationAccepted,
} from '../invitations/invitations.ts';
import type { Logger } from '../logger.ts';
import { recordSetupCompleted, runSetup } from './setup.ts';

/** The demo instance's accounts, one per role, in the order they're created. */
export const DEMO_ACCOUNTS = [
  { role: 'admin', name: 'Demo Admin', email: 'admin@example.com' },
  { role: 'editor', name: 'Demo Editor', email: 'editor@example.com' },
  { role: 'viewer', name: 'Demo Viewer', email: 'viewer@example.com' },
] as const satisfies readonly { role: Role; name: string; email: string }[];

export interface DemoAccount {
  role: Role;
  name: string;
  email: string;
  password: string;
}

export type DemoSeedResult =
  | { ok: true; accounts: DemoAccount[] }
  | { ok: false; reason: 'users-exist' | 'in-progress' };

/** Letters and digits that can't be mistaken for one another when typed from a screen. */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A random password that follows the password rules: four groups of five characters, joined by
 * hyphens, like `k7Rmq-Xb2nT-pWz4e-H9dLs` (about 116 bits).
 */
export function demoPassword(): string {
  for (;;) {
    const groups = Array.from({ length: 4 }, () =>
      Array.from({ length: 5 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join(
        '',
      ),
    );
    const password = groups.join('-');
    // A few draws lack a digit or a letter case; draw again.
    if (passwordSchema.safeParse(password).success) return password;
  }
}

/**
 * Creates the demo accounts on a new instance, the way people would: the admin through first-run
 * setup, then the others by invitation from the admin, so the audit log shows how each came to be.
 * Returns their passwords, which aren't stored anywhere else. Refuses once any user exists.
 *
 * Invitations are never emailed, even when email is on: the accounts' addresses are example.com.
 */
export async function seedDemoAccounts(
  deps: Omit<InvitationDeps, 'emailEnabled'> & { logger: Logger },
): Promise<DemoSeedResult> {
  const { db, logger } = deps;
  // No request: the script runs on the server.
  const origin = { ip: null, userAgent: null };
  const [admin, ...invited] = DEMO_ACCOUNTS;

  const adminPassword = demoPassword();
  const setup = await runSetup(deps, {
    name: admin.name,
    email: admin.email,
    password: adminPassword,
  });
  if (!setup.ok) {
    return { ok: false, reason: setup.reason === 'complete' ? 'users-exist' : 'in-progress' };
  }
  recordSetupCompleted(db, logger, origin, setup.user.id, 'demo-seed');
  const accounts: DemoAccount[] = [{ ...admin, password: adminPassword }];

  for (const account of invited) {
    const invitation = createInvitation(
      { ...deps, emailEnabled: false },
      { email: account.email, role: account.role, invitedBy: setup.user.id },
      { ...origin, actorId: setup.user.id },
    );
    // The instance had no users a moment ago, so nobody else can hold this address.
    if (!invitation.ok || invitation.link === undefined) {
      throw new Error(`could not invite the demo ${account.role}`);
    }
    const password = demoPassword();
    const accepted = await acceptInvitation(
      { ...deps, emailEnabled: false },
      // The token is the link's fragment.
      { token: new URL(invitation.link).hash.slice(1), name: account.name, password },
    );
    if (!accepted.ok) throw new Error(`could not accept the demo ${account.role}'s invitation`);
    recordInvitationAccepted(db, logger, origin, accepted);
    accounts.push({ ...account, password });
  }

  logger.info({ accounts: accounts.map(({ role }) => role) }, 'demo accounts created');
  return { ok: true, accounts };
}
