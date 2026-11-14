import type { Role } from '@myli/shared';
import type { EmailMessage } from '../mail/mailer.ts';

export interface InvitationEmailDetails {
  to: string;
  inviterName: string;
  role: Role;
  link: string;
  expiresAt: Date;
}

const ROLE_PHRASES: Record<Role, string> = {
  admin: 'an admin',
  editor: 'an editor',
  viewer: 'a viewer',
};

// The instance has no time zone setting, so the expiry is given in UTC, and says so. A 24-hour
// clock reads the same everywhere: "November 21, 2026 at 23:12 UTC".
const EXPIRY_FORMAT = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/**
 * The email that carries an invitation link. Plain text only, so the inviter's name needs no
 * escaping. The subject is fixed: nothing user-written goes into a header.
 */
export function invitationEmail(details: InvitationEmailDetails): EmailMessage {
  return {
    to: details.to,
    subject: "You're invited to myli",
    text: [
      `${details.inviterName} invited you to myli, a recipe app, as ${ROLE_PHRASES[details.role]}.`,
      '',
      'Create your account here:',
      details.link,
      '',
      `The link works once, until ${EXPIRY_FORMAT.format(details.expiresAt)}.`,
      "If you weren't expecting this invitation, you can ignore this email.",
      '',
    ].join('\n'),
  };
}
