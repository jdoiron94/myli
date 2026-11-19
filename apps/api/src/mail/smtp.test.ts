import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../logger.ts';
import { freePort } from '../testing.ts';
import {
  checkSmtpServer,
  createSmtpMailer,
  DEFAULT_SMTP_PORTS,
  type SmtpConfig,
  type SmtpSecurity,
  smtpConfigFrom,
  smtpTransportOptions,
} from './smtp.ts';

const USER = 'myli-mailer';
const PASSWORD = 'smtp-hunter2-secret';
const FROM = 'myli <myli@example.com>';
const MESSAGE = {
  to: 'ada@example.com',
  subject: 'You are invited',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
};

/** A one-day self-signed certificate for 127.0.0.1, made per run so no private key is committed. */
function makeCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'myli-smtp-'));
  try {
    // biome-ignore format: the openssl arguments read best grouped by option
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
      '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    ], { stdio: 'ignore' });
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let certificate: { key: string; cert: string };
beforeAll(() => {
  certificate = makeCertificate();
});

const servers: SMTPServer[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(resolve);
        }),
    ),
  );
});

/** An in-process SMTP server that accepts USER/PASSWORD and records logins and messages. */
async function startServer(options: SMTPServerOptions) {
  const logins: { username?: string; password?: string | null; secure: boolean }[] = [];
  const messages: { raw: string; secure: boolean }[] = [];
  const server = new SMTPServer({
    logger: false,
    onAuth(auth, session, callback) {
      logins.push({ username: auth.username, password: auth.password, secure: session.secure });
      if (auth.username === USER && auth.password === PASSWORD) {
        callback(null, { user: USER });
      } else {
        callback(new Error('Invalid username or password'));
      }
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => (raw += chunk));
      stream.on('end', () => {
        messages.push({ raw, secure: session.secure });
        callback();
      });
    },
    ...options,
  });
  // A client that gives up mid-connection (an untrusted certificate, a refused login) makes the
  // server emit 'error'. Without a listener, that would crash the test run.
  server.on('error', () => undefined);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server.server, 'listening');
  const { port } = server.server.address() as AddressInfo;
  return { port, logins, messages };
}

function config(port: number, security: SmtpSecurity, overrides: Partial<SmtpConfig> = {}) {
  return {
    host: '127.0.0.1',
    port,
    security,
    from: FROM,
    auth: { user: USER, password: PASSWORD },
    ...overrides,
  } satisfies SmtpConfig;
}

describe('smtpConfigFrom', () => {
  const env = { SMTP_SECURITY: 'starttls', SMTP_FROM: FROM } as const;

  it('is null when SMTP_HOST is not set, so email is off', () => {
    expect(smtpConfigFrom(env)).toBeNull();
  });

  it('takes the port its security calls for unless SMTP_PORT is set, and the credentials', () => {
    expect(smtpConfigFrom({ ...env, SMTP_HOST: 'smtp.example.com' })).toEqual({
      host: 'smtp.example.com',
      port: DEFAULT_SMTP_PORTS.starttls,
      security: 'starttls',
      from: FROM,
      auth: null,
    });
    expect(
      smtpConfigFrom({
        ...env,
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 2525,
        SMTP_USER: USER,
        SMTP_PASSWORD: PASSWORD,
      }),
    ).toMatchObject({ port: 2525, auth: { user: USER, password: PASSWORD } });
  });
});

describe('smtpTransportOptions', () => {
  it('maps each kind of security to Nodemailer’s options', () => {
    const securities = ['starttls', 'tls', 'none'] as const;
    expect(
      Object.fromEntries(
        securities.map((security) => {
          const { secure, requireTLS, ignoreTLS } = smtpTransportOptions(config(587, security));
          return [security, { secure, requireTLS, ignoreTLS }];
        }),
      ),
    ).toEqual({
      starttls: { secure: false, requireTLS: true, ignoreTLS: false },
      tls: { secure: true, requireTLS: false, ignoreTLS: false },
      none: { secure: false, requireTLS: false, ignoreTLS: true },
    });
  });

  it('logs in only when there are credentials', () => {
    expect(smtpTransportOptions(config(587, 'starttls', { auth: null }))).not.toHaveProperty(
      'auth',
    );
  });
});

describe('createSmtpMailer', () => {
  it('sends with each kind of security: logs in, then delivers text and HTML from SMTP_FROM', async () => {
    const cases = [
      // Each server offers STARTTLS (it has a certificate) unless it's an implicit-TLS server.
      ['starttls', {}, true],
      ['tls', { secure: true }, true],
      // `none` ignores the STARTTLS offer. Logging in unencrypted needs the server's consent.
      ['none', { allowInsecureAuth: true }, false],
    ] as const;
    for (const [security, serverOptions, encrypted] of cases) {
      const server = await startServer({ ...certificate, ...serverOptions });
      const mailer = createSmtpMailer(config(server.port, security), { ca: certificate.cert });

      const { messageId } = await mailer.send(MESSAGE);

      expect(messageId, security).toMatch(/^<.+@.+>$/);
      expect(server.logins, security).toEqual([
        { username: USER, password: PASSWORD, secure: encrypted },
      ]);
      expect(server.messages, security).toHaveLength(1);
      const [message] = server.messages;
      expect(message?.secure, security).toBe(encrypted);
      expect(message?.raw).toMatch(/^From: myli <myli@example\.com>$/m);
      expect(message?.raw).toMatch(/^To: ada@example\.com$/m);
      expect(message?.raw).toMatch(/^Subject: You are invited$/m);
      expect(message?.raw).toContain('Plain text body');
      expect(message?.raw).toContain('<p>HTML body</p>');
      expect(message?.raw).toContain(`Message-ID: ${messageId}`);
    }
  });

  it('with starttls, refuses a server that does not support it, before sending the password', async () => {
    // Disabled, not just hidden: Nodemailer tries STARTTLS even when the server doesn't offer it.
    const server = await startServer({ disabledCommands: ['STARTTLS'], allowInsecureAuth: true });
    const mailer = createSmtpMailer(config(server.port, 'starttls'));

    await expect(mailer.send(MESSAGE)).rejects.toThrow();
    expect(server.logins).toEqual([]);
    expect(server.messages).toEqual([]);
  });

  it('refuses a certificate it does not trust, with starttls or tls', async () => {
    for (const security of ['starttls', 'tls'] as const) {
      const server = await startServer({ ...certificate, secure: security === 'tls' });
      const mailer = createSmtpMailer(config(server.port, security)); // no `ca`

      await expect(mailer.send(MESSAGE), security).rejects.toThrow(/self-signed certificate/);
      expect(server.logins, security).toEqual([]);
      expect(server.messages, security).toEqual([]);
    }
  });

  it('verifies the connection and login without sending anything', async () => {
    const server = await startServer(certificate);
    const ca = { ca: certificate.cert };

    await expect(createSmtpMailer(config(server.port, 'starttls'), ca).verify()).resolves.toBe(
      undefined,
    );
    const wrongPassword = config(server.port, 'starttls', {
      auth: { user: USER, password: 'not-the-password' },
    });
    await expect(createSmtpMailer(wrongPassword, ca).verify()).rejects.toThrow();
    expect(server.messages).toEqual([]);
  });
});

describe('checkSmtpServer', () => {
  function capture() {
    const lines: string[] = [];
    const logger = createLogger('info', {
      write(line: string) {
        lines.push(line);
      },
    });
    return {
      logger,
      raw: () => lines.join(''),
      logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('logs that the server accepted the connection', async () => {
    const server = await startServer(certificate);
    const smtp = config(server.port, 'starttls');
    const { logger, logs } = capture();

    const ok = await checkSmtpServer(
      createSmtpMailer(smtp, { ca: certificate.cert }),
      smtp,
      logger,
    );

    expect(ok).toBe(true);
    expect(logs()).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'SMTP server accepted the connection',
        host: '127.0.0.1',
        port: server.port,
        security: 'starttls',
      }),
    ]);
  });

  it('warns when the login fails, without logging the password in any form', async () => {
    const server = await startServer(certificate);
    const wrong = 'wrong-hunter3-password';
    const smtp = config(server.port, 'starttls', { auth: { user: USER, password: wrong } });
    const { logger, logs, raw } = capture();

    const ok = await checkSmtpServer(
      createSmtpMailer(smtp, { ca: certificate.cert }),
      smtp,
      logger,
    );

    expect(ok).toBe(false);
    expect(logs()).toEqual([
      expect.objectContaining({
        level: 40,
        msg: expect.stringContaining('could not connect or log in to the SMTP server') as unknown,
        host: '127.0.0.1',
      }),
    ]);
    // AUTH PLAIN sends base64("\0user\0password"); AUTH LOGIN sends base64(password).
    for (const secret of [
      wrong,
      Buffer.from(wrong).toString('base64'),
      Buffer.from(`\0${USER}\0${wrong}`).toString('base64'),
    ]) {
      expect(raw()).not.toContain(secret);
    }
  });

  it('warns when nothing is listening, and never throws', async () => {
    const smtp = config(await freePort(), 'none', { auth: null });
    const { logger, logs } = capture();

    expect(await checkSmtpServer(createSmtpMailer(smtp), smtp, logger)).toBe(false);
    expect(logs()).toEqual([expect.objectContaining({ level: 40 })]);
  });
});
