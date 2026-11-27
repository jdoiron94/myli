import { type Role, roleSchema, type User } from '@myli/shared';
import type { Auth } from './auth.ts';

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: Role;
  /**
   * Only when myli has proven the address reaches them, as an emailed invitation does (ADR 0019).
   * Unverified unless said.
   */
  emailVerified?: boolean;
}

/**
 * Creates a user who can sign in with a password. This is the call ADR 0005 left to Phase 0:
 * first-run setup and accepted invitations both create users through it, because public sign-up
 * is disabled.
 *
 * It goes through the admin plugin's server-side `createUser`, which hashes the password and needs
 * no session when called without request headers. A password that breaks the rules in
 * `@myli/shared` is rejected (see the hook in auth.ts). The user and their credential are two
 * separate writes (see `transaction: false` in auth.ts).
 */
export async function createUserWithPassword(
  auth: Auth,
  { emailVerified = false, ...newUser }: NewUser,
): Promise<User> {
  const { user } = await auth.api.createUser({ body: { ...newUser, data: { emailVerified } } });
  return { id: user.id, name: user.name, email: user.email, role: roleSchema.parse(user.role) };
}
