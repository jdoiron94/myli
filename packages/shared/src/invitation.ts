import { z } from 'zod';
import { passwordSchema } from './password.ts';
import { roleSchema } from './roles.ts';
import { emailSchema, userNameSchema, userSchema } from './user.ts';

/**
 * The web app's page for accepting an invitation. Links are `PUBLIC_URL` + this path + `#` + the
 * token: in the fragment, the token never reaches a server log or a Referer header.
 */
export const INVITATION_ACCEPT_PATH = '/accept-invitation';

/** An invitation as admins see it. */
export const invitationSchema = z
  .object({
    id: z.string(),
    email: z.email(),
    role: roleSchema.describe('The role the invitee gets on accepting.'),
    expiresAt: z.iso.datetime().describe('When the link stops working.'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Invitation' });

export const createInvitationRequestSchema = z
  .object({ email: emailSchema, role: roleSchema })
  .meta({ id: 'CreateInvitationRequest' });

export const createInvitationResultSchema = z
  .object({
    invitation: invitationSchema,
    link: z
      .url()
      .optional()
      .describe(
        'The link to share with the invitee. Present when myli does not email it itself. It is ' +
          'shown only once: myli stores only a hash of the token in it.',
      ),
  })
  .meta({ id: 'CreateInvitationResult' });

/** The secret part of an invitation link. Validated by looking it up, never by its format. */
const invitationTokenSchema = z.string().min(1).max(200);

export const invitationLookupRequestSchema = z
  .object({ token: invitationTokenSchema })
  .meta({ id: 'InvitationLookupRequest' });

/** What the accept page shows the invitee before they choose a name and password. */
export const invitationDetailsSchema = z
  .object({
    email: z.email().describe('The new account gets this email address.'),
    role: roleSchema,
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'InvitationDetails' });

export const acceptInvitationRequestSchema = z
  .object({ token: invitationTokenSchema, name: userNameSchema, password: passwordSchema })
  .meta({ id: 'AcceptInvitationRequest' });

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const acceptInvitationResultSchema = z
  .object({ user: userSchema })
  .meta({ id: 'AcceptInvitationResult' });
