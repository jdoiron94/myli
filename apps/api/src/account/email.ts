import { formatExpiry } from '../mail/expiry.ts';
import type { EmailMessage } from '../mail/mailer.ts';

/** The email that carries a verification link. Plain text, with nothing user-written in it. */
export function verificationEmail(details: {
  to: string;
  link: string;
  expiresAt: Date;
}): EmailMessage {
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
