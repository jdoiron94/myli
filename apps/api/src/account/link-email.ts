import type { JobContext } from '../jobs/define.ts';
import type { EmailMessage } from '../mail/mailer.ts';
import { tokenLink } from '../tokens.ts';
import { reissueUserToken } from './user-tokens.ts';

/** What an email carrying an account link says it holds. */
export interface LinkEmailDetails {
  to: string;
  link: string;
  expiresAt: Date;
}

/**
 * What every account email job does (ADR 0019). Its payload is only the token row's ID: this gives
 * the row a fresh token, stores its hash, and only then sends the link to the web app's `path`, as
 * invitations do. A row that was used, replaced or has expired since gets no email.
 */
export async function emailUserTokenLink(
  tokenId: string,
  { services: { db, mailer, publicUrl }, logger }: JobContext,
  email: { kind: string; path: string; message: (details: LinkEmailDetails) => EmailMessage },
): Promise<void> {
  if (!mailer) {
    // Only when SMTP was turned off after the job was queued.
    logger.warn({ tokenId }, `email is off, so the ${email.kind} email was not sent`);
    return;
  }
  const issued = reissueUserToken(db, tokenId, new Date());
  if (!issued) {
    logger.info({ tokenId }, `${email.kind} link was used, replaced or expired; no email sent`);
    return;
  }
  const { messageId } = await mailer.send(
    email.message({
      to: issued.row.email,
      link: tokenLink(publicUrl, email.path, issued.token),
      expiresAt: issued.row.expiresAt,
    }),
  );
  logger.info({ tokenId, messageId }, `${email.kind} email sent`);
}
