import type { Role } from '@myli/shared';
import type { Auth } from './auth.ts';

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/**
 * Creates a user who can sign in with a password, with the email already marked verified. This is
 * the call ADR 0005 left to Phase 0: first-run setup and accepted invitations both create users
 * through it, because public sign-up is disabled.
 *
 * It goes through the admin plugin's server-side `createUser`, which hashes the password and needs
 * no session when called without request headers. It does **not** enforce the minimum password
 * length, so callers validate the password first. The user and their credential are two separate
 * writes (see `transaction: false` in auth.ts).
 */
export async function createUserWithPassword(auth: Auth, newUser: NewUser) {
  const { user } = await auth.api.createUser({
    body: { ...newUser, data: { emailVerified: true } },
  });
  return user;
}
