import { z } from 'zod';
import { passwordSchema } from './password.ts';
import { avatarSchema, emailSchema } from './user.ts';

/**
 * The web app's page that a verification link opens. Like an invitation's, the link is
 * `PUBLIC_URL` + this path + `#` + the token, which never reaches a server log (spec §3.1).
 */
export const EMAIL_VERIFICATION_PATH = '/verify-email';

/** Whether the reader's address is verified, and whether they can verify it now. */
export const emailVerificationStatusSchema = z
  .object({
    email: z.email(),
    verified: z
      .boolean()
      .describe('Whether myli has proven the address reaches its owner (spec §3.1).'),
    emailEnabled: z
      .boolean()
      .describe('Whether this server sends email, which verifying an address needs.'),
  })
  .meta({ id: 'EmailVerificationStatus' });

/** The secret part of a link. Checked by looking it up, never by format. */
const linkTokenSchema = z.string().min(1).max(200);

export const confirmEmailVerificationRequestSchema = z
  .object({ token: linkTokenSchema })
  .meta({ id: 'ConfirmEmailVerificationRequest' });

export const emailVerifiedSchema = z
  .object({ email: z.email().describe('The address that is now verified.') })
  .meta({ id: 'EmailVerified' });

/** The web app's page that a reset link opens, as `EMAIL_VERIFICATION_PATH` is a verification link's. */
export const PASSWORD_RESET_PATH = '/reset-password';

/** What someone who forgot their password can do on this server. */
export const passwordResetAvailabilitySchema = z
  .object({
    emailEnabled: z
      .boolean()
      .describe(
        'Whether this server emails reset links. Without email, whoever runs it makes one (spec §3.1).',
      ),
  })
  .meta({ id: 'PasswordResetAvailability' });

export const passwordResetRequestSchema = z
  .object({ email: emailSchema })
  .meta({ id: 'PasswordResetRequest' });

export const confirmPasswordResetRequestSchema = z
  .object({ token: linkTokenSchema, newPassword: passwordSchema })
  .meta({ id: 'ConfirmPasswordResetRequest' });

export const passwordResetSchema = z
  .object({ email: z.email().describe('The address of the account whose password was reset.') })
  .meta({ id: 'PasswordReset' });

/** The reader's profile photo. */
export const avatarResultSchema = z
  .object({
    avatar: avatarSchema
      .nullable()
      .describe('`null` when there is none: people see your initials instead.'),
  })
  .meta({ id: 'AvatarResult' });

export const setAvatarRequestSchema = z
  .object({
    imageId: z
      .string()
      .min(1)
      .max(100)
      .describe('A photo the reader uploaded with `POST /images` that is in no recipe.'),
  })
  .meta({ id: 'SetAvatarRequest' });
