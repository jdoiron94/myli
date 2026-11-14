import nodemailer from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport/index.js';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from './mailer.ts';

export type SmtpSecurity = Env['SMTP_SECURITY'];

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  from: string;
  auth: { user: string; password: string } | null;
}

/** The usual port for each mode, used when SMTP_PORT isn't set. */
export const DEFAULT_SMTP_PORTS = {
  starttls: 587,
  tls: 465,
  none: 25,
} as const satisfies Record<SmtpSecurity, number>;

/** The SMTP settings from the environment, or `null` when email is off (no SMTP_HOST). */
export function smtpConfigFrom(
  env: Pick<
    Env,
    'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURITY' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'SMTP_FROM'
  >,
): SmtpConfig | null {
  const { SMTP_HOST: host, SMTP_SECURITY: security, SMTP_FROM: from } = env;
  if (host === undefined) return null;
  // The env schema guarantees both, but TypeScript can't see that.
  if (from === undefined) throw new Error('SMTP_FROM is required when SMTP_HOST is set');
  const { SMTP_USER: user, SMTP_PASSWORD: password } = env;
  return {
    host,
    port: env.SMTP_PORT ?? DEFAULT_SMTP_PORTS[security],
    security,
    from,
    auth: user !== undefined && password !== undefined ? { user, password } : null,
  };
}

/** Nodemailer's options for a config. Exported so tests can check the mapping. */
export function smtpTransportOptions(config: SmtpConfig): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    // `tls`: TLS from the first byte. `starttls`: refuse to continue, and never send credentials,
    // unless the server upgrades the connection. `none`: never upgrade, even when offered.
    secure: config.security === 'tls',
    requireTLS: config.security === 'starttls',
    ignoreTLS: config.security === 'none',
    ...(config.auth && { auth: { user: config.auth.user, pass: config.auth.password } }),
    // Nodemailer waits up to 10 minutes on a silent server by default, holding up the job worker.
    dnsTimeout: 10_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

/**
 * A mailer that sends through an SMTP server. Certificates are always verified; `ca` adds an
 * authority to trust, for tests against a server with a throwaway certificate.
 */
export function createSmtpMailer(config: SmtpConfig, options: { ca?: string } = {}): Mailer {
  const transport = nodemailer.createTransport({
    ...smtpTransportOptions(config),
    ...(options.ca !== undefined && { tls: { ca: options.ca } }),
  });
  return {
    async send({ to, subject, text, html }) {
      const info = await transport.sendMail({
        from: config.from,
        to,
        subject,
        text,
        ...(html !== undefined && { html }),
      });
      return { messageId: info.messageId };
    },
    async verify() {
      await transport.verify();
    },
  };
}

/**
 * Logs whether the SMTP server accepts a connection and login. Called at startup without waiting,
 * so a slow or missing server never delays it. Never throws.
 */
export async function checkSmtpServer(
  mailer: Mailer,
  config: SmtpConfig,
  logger: Logger,
): Promise<boolean> {
  const server = { host: config.host, port: config.port, security: config.security };
  try {
    await mailer.verify();
    logger.info(server, 'SMTP server accepted the connection');
    return true;
  } catch (error) {
    logger.warn(
      { ...server, err: error },
      'could not connect or log in to the SMTP server; sending email will fail until this is fixed',
    );
    return false;
  }
}
