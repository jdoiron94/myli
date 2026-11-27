import { createHash } from 'node:crypto';
import { AUTH_BASE_PATH } from '@myli/shared';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { auditEvent, job, user, userToken } from '../db/schema.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createMemoryMailer } from '../mail/testing.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { ACCOUNT_EMAIL_INTERVAL_MS } from './user-tokens.ts';

const LINK = /https:\/\/myli\.test\/reset-password#([\w-]{43})/;
/** The password `signedInAs` gives everyone (testing.ts). */
const OLD_PASSWORD = 'A test password, long enough 1';
const NEW_PASSWORD = 'A brand new passphrase 2';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A test app with email on, a worker sending into a memory mailer, and a verified viewer. */
async function setUp() {
  const t = createTestApp({ env: { SMTP_HOST: 'smtp.test' } });
  const memory = createMemoryMailer();
  const worker = createWorker({
    services: {
      db: t.db,
      mailer: memory.mailer,
      publicUrl: t.publicUrl,
      search: { client: undefined },
      blobs: createMemoryBlobStore(),
    },
    logger: t.logger,
    jobs: allJobs,
  });
  const viewer = await signedInAs(t, 'viewer');
  setUser(t, viewer.user.id, { emailVerified: true });
  return { t, viewer, worker, sent: memory.sent };
}

function setUser(t: TestApp, id: string, values: { emailVerified?: boolean; banned?: boolean }) {
  t.db.update(user).set(values).where(eq(user.id, id)).run();
}

function send(t: TestApp, method: string, path: string, body?: unknown, cookie?: string) {
  return t.app.request(path, {
    method,
    headers: {
      origin: t.publicUrl,
      ...(method !== 'GET' && { 'content-type': 'application/json' }),
      ...(cookie !== undefined && { cookie }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const askForReset = (t: TestApp, email: string) =>
  send(t, 'POST', '/api/v1/password-reset', { email });

const reset = (t: TestApp, token: string, newPassword = NEW_PASSWORD) =>
  send(t, 'POST', '/api/v1/password-reset/confirm', { token, newPassword });

const signIn = async (t: TestApp, email: string, password: string) =>
  (await send(t, 'POST', `${AUTH_BASE_PATH}/sign-in/email`, { email, password })).status;

function tokenIn(text: string | undefined) {
  const token = LINK.exec(text ?? '')?.[1];
  if (token === undefined) throw new Error('no reset link in the email');
  return token;
}

/** Moves the user's reset token back in time, as if it had been asked for `ms` earlier. */
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

describe('resetting a password', () => {
  it('emails a link that sets a new password once, signs out everywhere, and records it', async () => {
    const { t, viewer, worker, sent } = await setUp();
    const { email } = viewer.user;

    expect((await askForReset(t, email.toUpperCase())).status).toBe(202);
    const jobs = t.db.select().from(job).orderBy(asc(job.id)).all();
    expect(jobs).toMatchObject([{ type: 'password_reset.email' }]);
    expect(Object.keys(jobs[0]?.payload ?? {})).toEqual(['tokenId']);
    await worker.runOnce();
    expect(sent).toMatchObject([{ to: email, subject: 'Reset your myli password' }]);
    const token = tokenIn(sent[0]?.text);
    expect(t.db.select().from(userToken).all()).toMatchObject([{ tokenHash: sha256(token) }]);
    expect(t.db.$client.serialize().includes(token)).toBe(false);

    // A password that breaks the rules is refused at its field, and leaves the link working.
    const weak = await reset(t, token, 'no uppercase letter in it 2');
    expect(weak.status).toBe(422);
    expect(await weak.json()).toMatchObject({ errors: [{ in: 'body', pointer: '#/newPassword' }] });

    // Sent twice at once, from two tabs: it resets once.
    const answers = await Promise.all([reset(t, token), reset(t, token)]);
    expect(answers.map((res) => res.status).sort()).toEqual([200, 404]);
    expect(await answers.find((res) => res.ok)?.json()).toEqual({ email });

    expect({
      'old session': (
        await send(t, 'GET', '/api/v1/me/email-verification', undefined, viewer.cookie)
      ).status,
      'old password': await signIn(t, email, OLD_PASSWORD),
      'new password': await signIn(t, email, NEW_PASSWORD),
    }).toEqual({ 'old session': 401, 'old password': 401, 'new password': 200 });
    const events = t.db.select().from(auditEvent).where(eq(auditEvent.action, 'password.reset'));
    expect(events.all()).toMatchObject([
      {
        actorId: viewer.user.id,
        targetType: 'user',
        targetId: viewer.user.id,
        metadata: { sessionsEnded: 1 },
      },
    ]);
  });

  it('emails only the verified address of an active account, every five minutes at most, and answers alike', async () => {
    const { t, viewer, worker, sent } = await setUp();
    const unverified = await signedInAs(t, 'editor');
    setUser(t, unverified.user.id, { emailVerified: false });
    const deactivated = await signedInAs(t, 'editor');
    setUser(t, deactivated.user.id, { emailVerified: true, banned: true });

    const statuses = {
      verified: (await askForReset(t, viewer.user.email)).status,
      'verified, again': (await askForReset(t, viewer.user.email)).status,
      unverified: (await askForReset(t, unverified.user.email)).status,
      deactivated: (await askForReset(t, deactivated.user.email)).status,
      unknown: (await askForReset(t, 'nobody@example.com')).status,
    };
    await worker.runOnce();
    await worker.runOnce();

    expect(statuses).toEqual({
      verified: 202,
      'verified, again': 202,
      unverified: 202,
      deactivated: 202,
      unknown: 202,
    });
    expect(sent.map((message) => message.to)).toEqual([viewer.user.email]);

    backdate(t, viewer.user.id, ACCOUNT_EMAIL_INTERVAL_MS);
    await askForReset(t, viewer.user.email);
    await worker.runOnce();
    expect(sent).toHaveLength(2);
  });

  it('answers every link that no longer works with the same 404, and changes nothing', async () => {
    const { t, viewer, worker, sent } = await setUp();
    // A used link is gone, so only an unused one spaces out the next.
    const linkFor = async ({ afterUnused = true } = {}) => {
      if (afterUnused) backdate(t, viewer.user.id, ACCOUNT_EMAIL_INTERVAL_MS);
      await askForReset(t, viewer.user.email);
      await worker.runOnce();
      return tokenIn(sent.at(-1)?.text);
    };
    await askForReset(t, viewer.user.email);
    await worker.runOnce();
    const expired = tokenIn(sent.at(-1)?.text);
    backdate(t, viewer.user.id, 61 * 60 * 1000);
    const expiredAnswer = await detail(await reset(t, expired));
    const replaced = await linkFor();
    const newest = await linkFor();
    const replacedAnswer = await detail(await reset(t, replaced));
    expect((await reset(t, newest)).status).toBe(200);
    const usedAnswer = await detail(await reset(t, newest));
    // An account deactivated after its link was sent.
    const deactivated = await linkFor({ afterUnused: false });
    setUser(t, viewer.user.id, { banned: true });
    const deactivatedAnswer = await detail(await reset(t, deactivated, 'Yet another passphrase 3'));

    const notFound = {
      status: 404,
      detail:
        'This reset link is invalid, expired or already used. Ask for a new one from the sign-in ' +
        'page.',
    };
    expect({
      unknown: await detail(await reset(t, 'not-a-real-token')),
      expired: expiredAnswer,
      replaced: replacedAnswer,
      used: usedAnswer,
      deactivated: deactivatedAnswer,
    }).toEqual({
      unknown: notFound,
      expired: notFound,
      replaced: notFound,
      used: notFound,
      deactivated: notFound,
    });
    setUser(t, viewer.user.id, { banned: false });
    expect(await signIn(t, viewer.user.email, NEW_PASSWORD)).toBe(200);
    expect(
      t.db.select().from(auditEvent).where(eq(auditEvent.action, 'password.reset')).all(),
    ).toHaveLength(1);
  });

  it('says whether this server emails links, and refuses to when it doesn’t', async () => {
    const on = createTestApp({ env: { SMTP_HOST: 'smtp.test' } });
    const off = createTestApp();

    expect({
      on: await (await send(on, 'GET', '/api/v1/password-reset')).json(),
      off: await (await send(off, 'GET', '/api/v1/password-reset')).json(),
      'asked, off': await detail(await askForReset(off, 'anyone@example.com')),
    }).toEqual({
      on: { emailEnabled: true },
      off: { emailEnabled: false },
      'asked, off': {
        status: 409,
        detail: "This server doesn't send email. Ask whoever runs it to make you a reset link.",
      },
    });
    expect(off.db.select().from(job).all()).toEqual([]);
  });
});
