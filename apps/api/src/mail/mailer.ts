export interface EmailMessage {
  to: string;
  subject: string;
  /** Always sent. Some people read mail as plain text, and spam filters distrust HTML-only mail. */
  text: string;
  /** An alternative to `text` for mail clients that show HTML. Escape anything user-written. */
  html?: string;
}

/**
 * Sends email. Only job handlers use it, through `context.services.mailer`, which is `null` when
 * SMTP isn't configured.
 */
export interface Mailer {
  /**
   * Resolves once the SMTP server has accepted the message, with the ID it was given. Log that ID,
   * never the recipient or the content. Throws if the server can't be reached or refuses it.
   */
  send(message: EmailMessage): Promise<{ messageId: string }>;
  /** Connects and logs in without sending anything. Throws if either fails. */
  verify(): Promise<void>;
}
