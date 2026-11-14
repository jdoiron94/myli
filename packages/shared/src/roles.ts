import { z } from 'zod';

/**
 * The instance-wide roles (spec §2). Every user has exactly one. What each role may do is decided
 * by the permission policy, never by comparing role names inline.
 */
export const ROLES = ['admin', 'editor', 'viewer'] as const;

export const roleSchema = z.enum(ROLES).meta({ id: 'Role' });

export type Role = z.infer<typeof roleSchema>;

/** The role a user gets when none is given. The least privileged one. */
export const DEFAULT_ROLE: Role = 'viewer';
