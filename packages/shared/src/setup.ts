import { z } from 'zod';
import { passwordSchema } from './password.ts';
import { emailSchema, userNameSchema, userSchema } from './user.ts';

/** First-run setup (spec §3.1): whether the instance still needs its first admin. */
export const setupStatusSchema = z
  .object({ needed: z.boolean().describe('True until the first admin exists.') })
  .meta({ id: 'SetupStatus' });

export const setupRequestSchema = z
  .object({ name: userNameSchema, email: emailSchema, password: passwordSchema })
  .meta({ id: 'SetupRequest' });

export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const setupResultSchema = z.object({ user: userSchema }).meta({ id: 'SetupResult' });
