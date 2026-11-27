import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { auditEvent, job, user, userToken } from '../db/schema.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import type { Mailer } from '../mail/mailer.ts';
import { createMemoryMailer } from '../mail/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { ACCOUNT_EMAIL_INTERVAL_MS } from './user-tokens.ts';

const LINK = /https:\/\/myli\.test\/verify-email#([\w-]{43})/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A test app with email on, a signed-in viewer, and a worker sending into a memory mailer. */
async function setUp({ mailer }: { mailer?: Mailer } = {}) {
  const t = createTestApp({ env: { SMTP_HOST: 'smtp.test' } });
  const viewer = await signedInAs(t, 'viewer');
  const memory = createMemoryMailer();
  const worker = createWorker({
    services: {
      db: t.db,
      mailer: mailer ?? memory.mailer,
      publicUrl: t.publicUrl,
      search: { client: undefined },
      blobs: createMemoryBlobStore(),
    },
    logger: t.logger,
    jobs: allJobs,
  });
  return { t, viewer, worker, sent: memory.sent };
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

const askForLink = (t: TestApp, cookie: string) =>
  send(t, 'POST', '/me/email-verification', cookie);

const confirm = (t: TestApp, token: string) =>
  send(t, 'POST', '/email-verification/confirm', undefined, { token });

async function status(t: TestApp, cookie: string) {
  return (await send(t, 'GET', '/me/email-verification', cookie)).json();
}

function tokenIn(text: string | undefined) {
  const token = LINK.exec(text ?? '')?.[1];
  if (token === undefined) throw new Error('no verification link in the email');
  return token;
}

/** Moves the user's token back in time, as if it had been asked for `ms` earlier. */
function backdate(t: TestApp, userId: string, ms: number) {
  const row = t.db.select().from(userToken).where(eq(userToken.userId, userId)).get();
  if (!row) throw new Error('no token to backdate');
  t.db
    .update(userToken)
    .set({
      createdAt: new Date(row.createdAt.getTime() - ms),
      expiresAt: new Date(row.expiresAt.getTime() - ms),
    })
    .where(eq(userToken.id, row.id))
    .run();
}

async function detail(res: Response) {
  return { status: res.status, detail: ((await res.json()) as { detail?: string }).detail };
}

describe('verifying an address', () => {
  it('emails a link that verifies the address once, storing only its hash, and records it', async () => {
    const { t, viewer, worker, sent } = await setUp();
    const { email } = viewer.user;
    expect(await status(t, viewer.cookie)).toEqual({ email, verified: false, emailEnabled: true });

    expect((await askForLink(t, viewer.cookie)).status).toBe(202);
    const jobs = t.db.select().from(job).orderBy(asc(job.id)).all();
    expect(jobs).toMatchObject([{ type: 'email_verification.email' }]);
    expect(Object.keys(jobs[0]?.payload ?? {})).toEqual(['tokenId']);

    await worker.runOnce();
    expect(sent).toMatchObject([{ to: email, subject: 'Verify your email address for myli' }]);
    const token = tokenIn(sent[0]?.text);
    expect(t.db.select().from(userToken).all()).toMatchObject([{ tokenHash: sha256(token) }]);
    expect(t.db.$client.serialize().includes(token)).toBe(false);

    // Opened twice at once, in two tabs: it verifies once.
    const answers = await Promise.all([confirm(t, token), confirm(t, token)]);
    expect(answers.map((res) => res.status).sort()).toEqual([200, 404]);
    expect(await answers.find((res) => res.ok)?.json()).toEqual({ email });
    expect(await status(t, viewer.cookie)).toEqual({ email, verified: true, emailEnabled: true });
    const events = t.db.select().from(auditEvent).where(eq(auditEvent.action, 'email.verified'));
    expect(events.all()).toMatchObject([
      {
        action: 'email.verified',
        actorId: viewer.user.id,
        targetType: 'user',
        targetId: viewer.user.id,
        metadata: { email },
      },
    ]);
  });

  it('answers every link that no longer works with the same 404', async () => {
    const { t, viewer, worker, sent } = await setUp();
    const linkFor = async () => {
      await askForLink(t, viewer.cookie);
      await worker.runOnce();
      return tokenIn(sent.at(-1)?.text);
    };
    const expired = await linkFor();
    backdate(t, viewer.user.id, 25 * 60 * 60 * 1000);
    const expiredAnswer = await detail(await confirm(t, expired));
    const replaced = await linkFor();
    backdate(t, viewer.user.id, ACCOUNT_EMAIL_INTERVAL_MS);
    const newest = await linkFor();
    const replacedAnswer = await detail(await confirm(t, replaced));
    expect((await confirm(t, newest)).status).toBe(200);

    const notFound = {
      status: 404,
      detail:
        'This verification link is invalid, expired or already used. Send a new one from your ' +
        'Account page.',
    };
    expect({
      unknown: await detail(await confirm(t, 'not-a-real-token')),
      expired: expiredAnswer,
      replaced: replacedAnswer,
      used: await detail(await confirm(t, newest)),
    }).toEqual({ unknown: notFound, expired: notFound, replaced: notFound, used: notFound });
  });

  it('sends one email every five minutes at most', async () => {
    const { t, viewer, worker, sent } = await setUp();
    expect((await askForLink(t, viewer.cookie)).status).toBe(202);

    expect(await detail(await askForLink(t, viewer.cookie))).toEqual({
      status: 429,
      detail:
        'A link was sent to you less than five minutes ago. Check your inbox, or try again in a ' +
        'few minutes.',
    });

    backdate(t, viewer.user.id, ACCOUNT_EMAIL_INTERVAL_MS);
    expect((await askForLink(t, viewer.cookie)).status).toBe(202);
    // The first job finds its token replaced, and sends nothing.
    await worker.runOnce();
    await worker.runOnce();
    expect(sent).toHaveLength(1);
  });

  it('refuses a verified address, and a server that sends no email', async () => {
    const { t, viewer } = await setUp();
    t.db.update(user).set({ emailVerified: true }).where(eq(user.id, viewer.user.id)).run();
    const off = createTestApp();
    const unverified = await signedInAs(off, 'viewer');

    expect({
      verified: await detail(await askForLink(t, viewer.cookie)),
      'email off': await detail(await askForLink(off, unverified.cookie)),
    }).toEqual({
      verified: { status: 409, detail: 'Your email address is verified already.' },
      'email off': {
        status: 409,
        detail: "This server doesn't send email, so it can't verify your address.",
      },
    });
    expect(await status(off, unverified.cookie)).toMatchObject({ emailEnabled: false });
    expect(off.db.select().from(job).all()).toEqual([]);
  });

  it('stores the new hash before sending, so the link already works as the email leaves', async () => {
    const hashesAtSend: boolean[] = [];
    const checking: Mailer = {
      send(message) {
        const stored = t.db.select().from(userToken).get();
        hashesAtSend.push(stored?.tokenHash === sha256(tokenIn(message.text)));
        return Promise.resolve({ messageId: '<checked@memory.test>' });
      },
      verify: () => Promise.resolve(),
    };
    const { t, viewer, worker } = await setUp({ mailer: checking });
    await askForLink(t, viewer.cookie);

    await worker.runOnce();

    expect(hashesAtSend).toEqual([true]);
  });
});
