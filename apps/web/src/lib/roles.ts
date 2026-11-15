import type { Role } from '@myli/shared';

/** Each role's name, as people read it. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** What each role can do, in a line, from spec §2. */
export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  viewer: "Browses, searches and cooks from shared recipes, but can't change anything.",
  editor:
    'Also adds and edits recipes, comments and rates, and keeps favorites and shopping lists.',
  admin: 'Can do everything, including inviting people and managing users.',
};
