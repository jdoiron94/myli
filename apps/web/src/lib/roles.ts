import type { Role } from '@myli/shared';

/** Each role's name, as people read it. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};
