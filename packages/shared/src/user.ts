import { z } from 'zod';
import { roleSchema } from './roles.ts';

/** A user as the API shows them. */
export const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    role: roleSchema,
  })
  .meta({ id: 'User' });

export type User = z.infer<typeof userSchema>;

/** A person's display name. */
export const userNameSchema = z.string().trim().min(1, 'Enter a name.').max(100);

/** Compared and stored in lower case, as Better Auth does. */
export const emailSchema = z.email('Enter a valid email address.').max(254).toLowerCase();
