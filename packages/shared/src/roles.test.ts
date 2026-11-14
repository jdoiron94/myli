import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE, ROLES, roleSchema } from './roles.ts';

describe('roles', () => {
  it('are admin, editor and viewer, and new users default to the least privileged', () => {
    expect(ROLES).toEqual(['admin', 'editor', 'viewer']);
    expect(DEFAULT_ROLE).toBe('viewer');
  });

  it.each(['user', 'Admin', 'admin,editor', ''])('rejects %j', (role) => {
    expect(roleSchema.safeParse(role).success).toBe(false);
  });
});
