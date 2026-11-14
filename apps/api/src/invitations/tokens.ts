import { createHash, randomBytes } from 'node:crypto';
import { INVITATION_ACCEPT_PATH } from '@myli/shared';

/** SHA-256 as hex: what the `invitation` table stores and looks tokens up by. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new token (32 random bytes, base64url) and its hash. Store the hash; the token goes in the link. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

/** The link the invitee opens. The token is in the fragment, so it never reaches a server. */
export function invitationLink(publicUrl: string, token: string): string {
  return `${publicUrl}${INVITATION_ACCEPT_PATH}#${token}`;
}
