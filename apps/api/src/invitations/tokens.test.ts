import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashInvitationToken, invitationLink, newInvitationToken } from './tokens.ts';

describe('invitation tokens', () => {
  it('are 32 random bytes as base64url, different every time, with their SHA-256 hash', () => {
    const tokens = Array.from({ length: 50 }, () => newInvitationToken());

    for (const { token, tokenHash } of tokens) {
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(token).toMatch(/^[\w-]{43}$/);
      expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(hashInvitationToken(token)).toBe(tokenHash);
    }
    expect(new Set(tokens.map(({ token }) => token)).size).toBe(tokens.length);
  });

  it('go in the fragment of the link, which browsers never send to a server', () => {
    const link = new URL(invitationLink('https://myli.example', 'the-token'));

    expect(link.origin).toBe('https://myli.example');
    expect(link.pathname).toBe('/accept-invitation');
    expect(link.search).toBe('');
    expect(link.hash).toBe('#the-token');
  });
});
