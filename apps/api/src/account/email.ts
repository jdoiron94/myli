import { formatExpiry } from '../mail/expiry.ts';
import type { EmailMessage } from '../mail/mailer.ts';
import type { LinkEmailDetails } from './link-email.ts';

/** The email that carries a verification link. Plain text, with nothing user-written in it. */
export function verificationEmail(details: LinkEmailDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Verify your email address for myli',
    text: [
      'Open this link to verify that this is your address for your myli account:',
      details.link,
      '',
      `The link works once, until ${formatExpiry(details.expiresAt)}.`,
      "If you didn't ask for it, you can ignore this email.",
      '',
    ].join('\n'),
  };
}

/** The email that carries a reset link. Plain text, with nothing user-written in it. */
export function passwordResetEmail(details: LinkEmailDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Reset your myli password',
    text: [
      'Someone asked to reset the password of your myli account. Open this link to choose a new one:',
      details.link,
      '',
      `The link works once, until ${formatExpiry(details.expiresAt)}. Choosing a new password signs you out everywhere.`,
      "If you didn't ask for it, you can ignore this email: your password stays as it is.",
      '',
    ].join('\n'),
  };
}
