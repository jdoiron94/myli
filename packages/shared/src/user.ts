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

/** A profile photo, which shows small: its image, and the one size of it to ask for. */
export const avatarSchema = z
  .object({
    id: z.string(),
    width: z
      .int()
      .positive()
      .describe('Its narrowest size, at `/images/{id}/{width}`: at most 640 pixels wide.'),
  })
  .meta({ id: 'Avatar' });

export type Avatar = z.infer<typeof avatarSchema>;

/** Someone the API names, with what shows beside their name: their profile photo, or initials. */
export const personSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: avatarSchema
      .nullable()
      .describe(
        'Their profile photo, or `null` for their initials. Only signed-in users ever see it.',
      ),
  })
  .meta({ id: 'Person' });

export type Person = z.infer<typeof personSchema>;

/** A person's display name. */
export const userNameSchema = z.string().trim().min(1, 'Enter a name.').max(100);

/** Compared and stored in lower case, as Better Auth does. */
export const emailSchema = z.email('Enter a valid email address.').max(254).toLowerCase();

/** A user as admins manage them. */
export const userAccountSchema = userSchema
  .extend({
    avatar: personSchema.shape.avatar,
    deactivated: z
      .boolean()
      .describe("Deactivated users can't sign in. Deactivating them ended their sessions."),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'UserAccount' });

export const userAccountListSchema = z
  .object({ users: z.array(userAccountSchema).describe('Every user, oldest first.') })
  .meta({ id: 'UserAccountList' });

export const userAccountResultSchema = z
  .object({ user: userAccountSchema })
  .meta({ id: 'UserAccountResult' });

export const changeRoleRequestSchema = z
  .object({ role: roleSchema })
  .meta({ id: 'ChangeRoleRequest' });

/** The path parameter of one user. Unknown IDs get 404, so the format isn't checked. */
export const userIdParamsSchema = z.object({ id: z.string().min(1).max(100) });
