import { createHash } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { invitation, job } from '../db/schema.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import { createMemoryMailer } from '../mail/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { invitationEmail } from './email.ts';

const HOUR_MS = 60 * 60 * 1000;
const LINK = /https:\/\/myli\.test\/accept-invitation#([\w-]{43})/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('invitationEmail', () => {
  it('is plain text with the inviter, the role, the link and the expiry in UTC', () => {
    const message = invitationEmail({
      to: 'grace@example.com',
      inviterName: 'Ada Lovelace',
      role: 'editor',
      link: 'https://myli.example/accept-invitation#the-token',
      expiresAt: new Date('2026-11-21T03:05:00Z'),
    });

    expect(message).toEqual({
      to: 'grace@example.com',
      subject: "You're invited to myli",
      text: [
        'Ada Lovelace invited you to myli, a recipe app, as an editor.',
        '',
        'Create your account here:',
        'https://myli.example/accept-invitation#the-token',
        '',
        'The link works once, until November 21, 2026 at 03:05 UTC.',
        "If you weren't expecting this invitation, you can ignore this email.",
        '',
      ].join('\n'),
    });
  });

  it.each([
    ['admin', 'as an admin.'],
    ['viewer', 'as a viewer.'],
  ] as const)('names the %s role with the right article', (role, phrase) => {
    const { text } = invitationEmail({
      to: 'grace@example.com',
      inviterName: 'Ada',
      role,
      link: 'https://myli.example/accept-invitation#t',
      expiresAt: new Date(),
    });
    expect(text.split('\n')[0]).toContain(phrase);
  });
});

/**
 * A test app with email on, a signed-in admin, a memory mailer, and a worker that runs the real
 * job list. The worker's clock can be moved forward, so retries run without waiting.
 */
async function setUp(options: { mailerOff?: boolean } = {}) {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ logger, env: { SMTP_HOST: 'smtp.test' } });
  const admin = await signedInAs(t, 'admin');
  const memory = createMemoryMailer();
  let offsetMs = 0;
  const worker = createWorker({
    services: {
      db: t.db,
      mailer: options.mailerOff ? null : memory.mailer,
      publicUrl: t.publicUrl,
      search: { client: undefined },
    },
    logger,
    jobs: allJobs,
    now: () => new Date(Date.now() + offsetMs),
  });
  return {
    t,
    admin,
    worker,
    ...memory,
    later: (ms: number) => {
      offsetMs += ms;
    },
    rawLogs: () => lines.join(''),
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function send(t: TestApp, method: string, path: string, cookie?: string, body?: unknown) {
  return t.app.request(`/api/v1${path}`, {
    method,
    headers: {
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function invite(t: TestApp, cookie: string) {
  const res = await send(t, 'POST', '/invitations', cookie, {
    email: 'grace@example.com',
    role: 'editor',
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { invitation: { id: string }; link?: string };
}

async function lookup(t: TestApp, token: string) {
  return (await send(t, 'POST', '/invitations/lookup', undefined, { token })).status;
}

function tokenIn(text: string) {
  const token = LINK.exec(text)?.[1];
  if (token === undefined) throw new Error('no invitation link in the email');
  return token;
}

const jobs = (t: TestApp) => t.db.select().from(job).orderBy(asc(job.id)).all();
const invitations = (t: TestApp) => t.db.select().from(invitation).all();

describe('invitations with email on', () => {
  it('emails the link instead of returning it; the link works and its token is stored nowhere', async () => {
    const { t, admin, worker, sent } = await setUp();

    const created = await invite(t, admin.cookie);

    expect(created).not.toHaveProperty('link');
    expect(jobs(t)).toMatchObject([
      { type: 'invitation.email', payload: { invitationId: created.invitation.id } },
    ]);
    expect(Object.keys(jobs(t)[0]?.payload ?? {})).toEqual(['invitationId']);
    expect(sent).toEqual([]);

    expect(await worker.runOnce()).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'grace@example.com', subject: "You're invited to myli" });
    const text = sent[0]?.text ?? '';
    expect(text).toContain('Test admin invited you to myli, a recipe app, as an editor.');
    const token = tokenIn(text);
    expect(await lookup(t, token)).toBe(200);
    expect(invitations(t)).toMatchObject([{ tokenHash: sha256(token) }]);
    expect(t.db.$client.serialize().includes(token)).toBe(false);
    expect(jobs(t)).toMatchObject([{ status: 'succeeded' }]);
  });

  it('stores the new hash before sending, so the link already works as the email leaves', async () => {
    const { t, admin } = await setUp();
    await invite(t, admin.cookie);
    const statusAtSend: number[] = [];
    const checkingMailer: Mailer = {
      async send(message) {
        statusAtSend.push(await lookup(t, tokenIn(message.text)));
        return { messageId: '<checked@memory.test>' };
      },
      verify: () => Promise.resolve(),
    };
    const worker = createWorker({
      services: {
        db: t.db,
        mailer: checkingMailer,
        publicUrl: t.publicUrl,
        search: { client: undefined },
      },
      logger: t.logger,
      jobs: allJobs,
    });

    await worker.runOnce();

    expect(statusAtSend).toEqual([200]);
  });

  it('on resend, stops the old link at once and emails a new one', async () => {
    const { t, admin, worker, sent } = await setUp();
    const created = await invite(t, admin.cookie);
    await worker.runOnce();
    const first = tokenIn(sent[0]?.text ?? '');

    const res = await send(t, 'POST', `/invitations/${created.invitation.id}/resend`, admin.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('link');
    expect(await lookup(t, first)).toBe(404);

    await worker.runOnce();
    expect(sent).toHaveLength(2);
    const second = tokenIn(sent[1]?.text ?? '');
    expect(await lookup(t, second)).toBe(200);
    expect(await lookup(t, first)).toBe(404);
  });

  it('when sending fails, retries with another link, and only the one that was sent works', async () => {
    const { t, admin, worker, sent, failNext, later } = await setUp();
    await invite(t, admin.cookie);
    failNext();

    await worker.runOnce();
    expect(sent).toEqual([]);
    expect(jobs(t)).toMatchObject([{ status: 'pending', attempts: 1 }]);
    const hashAfterFailure = invitations(t)[0]?.tokenHash;

    later(HOUR_MS);
    expect(await worker.runOnce()).toBe(true);

    expect(sent).toHaveLength(1);
    const token = tokenIn(sent[0]?.text ?? '');
    expect(await lookup(t, token)).toBe(200);
    expect(invitations(t)[0]?.tokenHash).not.toBe(hashAfterFailure);
    expect(jobs(t)).toMatchObject([{ status: 'succeeded', attempts: 2 }]);
  });

  it.each(['revoked', 'expired'] as const)(
    'sends nothing for an invitation %s before its job ran',
    async (state) => {
      const { t, admin, worker, sent, logs } = await setUp();
      const created = await invite(t, admin.cookie);
      if (state === 'revoked') {
        const res = await send(
          t,
          'POST',
          `/invitations/${created.invitation.id}/revoke`,
          admin.cookie,
        );
        expect(res.status).toBe(204);
      } else {
        t.db
          .update(invitation)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .run();
      }
      const before = invitations(t);

      await worker.runOnce();

      expect(sent).toEqual([]);
      expect(invitations(t)).toEqual(before);
      expect(jobs(t)).toMatchObject([{ status: 'succeeded' }]);
      expect(logs()).toContainEqual(
        expect.objectContaining({
          msg: 'invitation was accepted, revoked or expired; no email sent',
          invitationId: created.invitation.id,
        }),
      );
    },
  );

  it('sends nothing more when a job runs again after its link was used', async () => {
    const { t, admin, worker, sent } = await setUp();
    await invite(t, admin.cookie);
    await worker.runOnce();
    const token = tokenIn(sent[0]?.text ?? '');
    const accepted = await send(t, 'POST', '/invitations/accept', undefined, {
      token,
      name: 'Grace Hopper',
      password: 'An invitee password 1',
    });
    expect(accepted.status).toBe(201);

    // As if the process had stopped after sending, before the job was marked as done.
    t.db.update(job).set({ status: 'running' }).run();
    expect(worker.recoverInterrupted()).toBe(1);
    expect(await worker.runOnce()).toBe(true);

    expect(sent).toHaveLength(1);
    expect(invitations(t)).toMatchObject([{ tokenHash: sha256(token) }]);
  });

  it('warns and sends nothing when SMTP was turned off after the job was queued', async () => {
    const { t, admin, worker, logs } = await setUp({ mailerOff: true });
    const created = await invite(t, admin.cookie);
    const before = invitations(t);

    await worker.runOnce();

    expect(jobs(t)).toMatchObject([{ status: 'succeeded' }]);
    expect(invitations(t)).toEqual(before);
    expect(logs()).toContainEqual(
      expect.objectContaining({
        level: 40,
        invitationId: created.invitation.id,
        msg: 'email is off, so the invitation email was not sent; resend the invitation to get a link',
      }),
    );
  });

  it('logs the message ID, never the recipient, the subject or the link', async () => {
    const { t, admin, worker, sent, logs, rawLogs } = await setUp();
    const created = await invite(t, admin.cookie);

    await worker.runOnce();

    expect(logs()).toContainEqual(
      expect.objectContaining({
        msg: 'invitation email sent',
        invitationId: created.invitation.id,
        messageId: '<1@memory.test>',
      }),
    );
    expect(rawLogs()).not.toContain('grace@example.com');
    expect(rawLogs()).not.toContain("You're invited");
    expect(rawLogs()).not.toContain(tokenIn(sent[0]?.text ?? ''));
  });
});

describe('invitations with email off', () => {
  it('returns the link on create and resend, and queues no email', async () => {
    const t = createTestApp();
    const admin = await signedInAs(t, 'admin');

    const created = await invite(t, admin.cookie);
    const res = await send(t, 'POST', `/invitations/${created.invitation.id}/resend`, admin.cookie);
    const resent = (await res.json()) as { link?: string };

    expect(created.link).toMatch(LINK);
    expect(resent.link).toMatch(LINK);
    expect(jobs(t)).toEqual([]);
  });
});
