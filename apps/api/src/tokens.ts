import { createHash, randomBytes } from 'node:crypto';

/**
 * The secrets in the links myli emails: invitations, and verification and reset links (spec §3.1,
 * ADR 0019). Each is 32 random bytes; only its SHA-256 hash is stored, and looked up by.
 */

/** SHA-256 as hex: what the tables store and look tokens up by. */
export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new token (32 random bytes, base64url) and its hash. Store the hash; the token goes in the link. */
export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashLinkToken(token) };
}

/**
 * The link to the web app's page at `path`. The token is in the fragment, so it never reaches a
 * server: the page sends it in a request body.
 */
export function tokenLink(publicUrl: string, path: string, token: string): string {
  return `${publicUrl}${path}#${token}`;
}
