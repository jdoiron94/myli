import { z } from 'zod';

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

/** The secret part of a link to verify an address. Checked by looking it up, never by format. */
const linkTokenSchema = z.string().min(1).max(200);

export const confirmEmailVerificationRequestSchema = z
  .object({ token: linkTokenSchema })
  .meta({ id: 'ConfirmEmailVerificationRequest' });

export const emailVerifiedSchema = z
  .object({ email: z.email().describe('The address that is now verified.') })
  .meta({ id: 'EmailVerified' });
