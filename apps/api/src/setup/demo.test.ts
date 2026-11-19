import { AUTH_BASE_PATH, passwordSchema } from '@myli/shared';
import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvent, invitation, job, user } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { DEMO_ACCOUNTS, demoPassword, seedDemoAccounts } from './demo.ts';
import { runSetup } from './setup.ts';

function setUp() {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ logger });
  const seed = () =>
    seedDemoAccounts({
      db: t.db,
      auth: t.auth,
      logger,
      publicUrl: t.publicUrl,
      ttlDays: t.env.INVITATION_TTL_DAYS,
    });
  /** Every log line, including Better Auth's, so tests can check no password appears. */
  const rawLogs = () => lines.join('');
  return { t, seed, rawLogs };
}

const users = (t: TestApp) =>
  t.db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .all();

function signIn(t: TestApp, email: string, password: string) {
  return t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
    method: 'POST',
    headers: { origin: t.publicUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('demoPassword', () => {
  it('follows the password rules, and is different every time', () => {
    const passwords = Array.from({ length: 500 }, demoPassword);

    for (const password of passwords) {
      expect(passwordSchema.safeParse(password).success, password).toBe(true);
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/);
    }
    expect(new Set(passwords).size).toBe(passwords.length);
  });
});

describe('seedDemoAccounts', () => {
  it('creates one account per role, each able to sign in with the password it returns', async () => {
    const { t, seed } = setUp();

    const result = await seed();

    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.accounts.map(({ role, name, email }) => ({ role, name, email }))).toEqual(
      DEMO_ACCOUNTS,
    );
    expect(users(t).map(({ role, name, email }) => ({ role, name, email }))).toEqual(
      expect.arrayContaining([...DEMO_ACCOUNTS]),
    );
    expect(users(t)).toHaveLength(3);
    for (const { email, password } of result.accounts) {
      expect((await signIn(t, email, password)).status, email).toBe(200);
    }
    expect(new Set(result.accounts.map(({ password }) => password)).size).toBe(3);
  });

  it('creates the admin through setup and invites the others, as the audit log shows', async () => {
    const { t, seed } = setUp();

    await seed();

    const ids = Object.fromEntries(users(t).map(({ role, id }) => [role, id]));
    const invitations = Object.fromEntries(
      t.db
        .select({ id: invitation.id, role: invitation.role, accepted: invitation.acceptedAt })
        .from(invitation)
        .all()
        .map(({ role, id, accepted }) => {
          expect(accepted, role).not.toBeNull();
          return [role, id];
        }),
    );
    const events = t.db
      .select({
        actorId: auditEvent.actorId,
        action: auditEvent.action,
        targetId: auditEvent.targetId,
        metadata: auditEvent.metadata,
        ip: auditEvent.ip,
      })
      .from(auditEvent)
      .orderBy(asc(auditEvent.id))
      .all();
    expect(events).toEqual([
      {
        actorId: ids.admin,
        action: 'setup.completed',
        targetId: ids.admin,
        metadata: { via: 'demo-seed' },
        ip: null,
      },
      ...(['editor', 'viewer'] as const).flatMap((role) => [
        {
          actorId: ids.admin,
          action: 'invitation.created',
          targetId: invitations[role],
          metadata: { email: `${role}@example.com`, role },
          ip: null,
        },
        {
          actorId: ids[role],
          action: 'invitation.accepted',
          targetId: invitations[role],
          metadata: { email: `${role}@example.com`, role },
          ip: null,
        },
      ]),
    ]);
  });

  it('queues no email and logs no password', async () => {
    const { t, seed, rawLogs } = setUp();

    const result = await seed();

    // It invites with email off, whatever the instance's setting: the addresses are example.com.
    expect(t.db.select().from(job).all()).toEqual([]);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    for (const { password } of result.accounts) expect(rawLogs()).not.toContain(password);
    expect(rawLogs()).toContain('demo accounts created');
  });

  it('refuses once any user exists, and changes nothing', async () => {
    const { t, seed } = setUp();
    await signedInAs(t, 'viewer');
    const before = users(t);

    expect(await seed()).toEqual({ ok: false, reason: 'users-exist' });
    expect(users(t)).toEqual(before);
    expect(t.db.select().from(invitation).all()).toEqual([]);
  });

  it('refuses while first-run setup is under way', async () => {
    const { t, seed } = setUp();
    // Setup holds its claim while Better Auth creates the admin.
    const setup = runSetup(
      { db: t.db, auth: t.auth },
      { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Correct horse battery 9' },
    );

    expect(await seed()).toEqual({ ok: false, reason: 'in-progress' });
    await setup;
    expect(users(t).map(({ email }) => email)).toEqual(['ada@example.com']);
  });
});
