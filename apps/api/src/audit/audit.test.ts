import { AUTH_BASE_PATH } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserWithPassword } from '../auth/users.ts';
import { auditEvent, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { seedFirstAdmin } from '../setup/seed.ts';
import { createTestApp, signedInAs, type TestApp, type TestAppOptions } from '../testing.ts';
import { recordAuditEvent, USER_AGENT_MAX_LENGTH } from './audit.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const PASSWORD = 'A member password, long 1';
const NOBODY = { actorId: null, ip: null, userAgent: null };

/** A test app that keeps every log line. */
function appWithLogs(options: TestAppOptions = {}) {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  return {
    t: createTestApp({ ...options, logger }),
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** A test app with a signed-in admin, and every log line kept. */
async function setUp(options: TestAppOptions = {}) {
  const { t, logs } = appWithLogs(options);
  const admin = await signedInAs(t, 'admin');
  return { t, admin, logs };
}

/** What a failed write of an `action` event logs. */
const notRecorded = (action: string) =>
  expect.objectContaining({ level: 50, action, msg: 'could not record an audit event' });

interface RequestOptions {
  cookie?: string;
  body?: unknown;
  /** The TCP peer's address, as @hono/node-server reports it. */
  remoteAddress?: string;
  userAgent?: string;
  origin?: string;
}

function send(t: TestApp, method: string, path: string, options: RequestOptions = {}) {
  return t.app.request(
    path,
    {
      method,
      headers: {
        ...(method !== 'GET' && { 'content-type': 'application/json' }),
        ...(options.cookie !== undefined && { cookie: options.cookie }),
        ...(options.userAgent !== undefined && { 'user-agent': options.userAgent }),
        ...(options.origin !== undefined && { origin: options.origin }),
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    },
    options.remoteAddress === undefined
      ? undefined
      : { incoming: { socket: { remoteAddress: options.remoteAddress } } },
  );
}

function signIn(t: TestApp, email: string, password: string, options: RequestOptions = {}) {
  return send(t, 'POST', `${AUTH_BASE_PATH}/sign-in/email`, {
    origin: t.publicUrl,
    ...options,
    body: { email, password },
  });
}

function createMember(t: TestApp, email = 'grace@example.com') {
  return createUserWithPassword(t.auth, {
    name: 'Grace Hopper',
    email,
    password: PASSWORD,
    role: 'editor',
  });
}

/** Every event of these kinds, oldest first. */
function events(t: TestApp, ...actions: (typeof auditEvent.$inferSelect)['action'][]) {
  return t.db
    .select()
    .from(auditEvent)
    .all()
    .filter((event) => actions.includes(event.action));
}

interface ListedEvent {
  id: number;
  action: string;
  actor: { id: string; name: string } | null;
  target: { type: string; id: string } | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

async function list(t: TestApp, cookie: string, query = '') {
  const res = await send(t, 'GET', `/api/v1/audit-events${query}`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as { events: ListedEvent[]; nextBefore: number | null };
}

describe('audit_event table', () => {
  it('has the triggers that make it append-only', () => {
    const db = createTestDatabase();
    const triggers = db.$client
      .prepare("select name from sqlite_master where type = 'trigger' and tbl_name = 'audit_event'")
      .pluck()
      .all();
    expect(triggers.toSorted()).toEqual(['audit_event_no_delete', 'audit_event_no_update']);
  });

  it('refuses to change or delete a recorded event, whatever code tries', () => {
    const db = createTestDatabase();
    recordAuditEvent(db, NOBODY, { action: 'instance.exported' });

    expect(() => db.update(auditEvent).set({ ip: '192.0.2.1' }).run()).toThrow(
      'audit_event is append-only',
    );
    expect(() => db.delete(auditEvent).run()).toThrow('audit_event is append-only');
    expect(() => db.$client.exec('delete from audit_event')).toThrow('audit_event is append-only');
    expect(db.select().from(auditEvent).all()).toMatchObject([
      { action: 'instance.exported', ip: null },
    ]);
  });

  it('refuses an unknown action or target type, or half a target, at the database level', () => {
    const db = createTestDatabase();
    const failures = Object.fromEntries(
      [
        "('bogus', null, null)",
        "('instance.exported', 'comment', 'x')",
        "('instance.exported', 'user', null)",
        "('instance.exported', null, 'x')",
      ].map((values) => {
        const insert = db.$client.prepare(
          `insert into audit_event (action, target_type, target_id, created_at) values ${values.replace(')', ', 0)')}`,
        );
        try {
          insert.run();
          return [values, 'inserted'];
        } catch (error) {
          return [values, error instanceof Error ? error.message : String(error)];
        }
      }),
    );

    expect(failures).toEqual({
      "('bogus', null, null)": 'CHECK constraint failed: audit_event_action_check',
      "('instance.exported', 'comment', 'x')":
        'CHECK constraint failed: audit_event_target_type_check',
      "('instance.exported', 'user', null)": 'CHECK constraint failed: audit_event_target_check',
      "('instance.exported', null, 'x')": 'CHECK constraint failed: audit_event_target_check',
    });
  });
});

describe('where an event came from', () => {
  it('records the TCP peer as the IP, unmapping IPv4 clients of a dual-stack socket', async () => {
    const { t, admin } = await setUp();

    for (const remoteAddress of ['::ffff:203.0.113.7', '2001:db8::1', '198.51.100.2']) {
      const res = await send(t, 'POST', '/api/v1/invitations', {
        cookie: admin.cookie,
        remoteAddress,
        body: { email: `${remoteAddress.replaceAll(/[:.]/g, '-')}@example.com`, role: 'viewer' },
      });
      expect(res.status).toBe(201);
    }

    expect(events(t, 'invitation.created').map(({ ip }) => ip)).toEqual([
      '203.0.113.7',
      '2001:db8::1',
      '198.51.100.2',
    ]);
  });

  it('keeps the user agent, cut to its maximum length', async () => {
    const { t, admin } = await setUp();
    const long = `Mozilla/5.0 ${'x'.repeat(USER_AGENT_MAX_LENGTH)}`;

    await send(t, 'POST', '/api/v1/invitations', {
      cookie: admin.cookie,
      userAgent: long,
      body: { email: 'grace@example.com', role: 'viewer' },
    });

    expect(events(t, 'invitation.created')).toMatchObject([
      { userAgent: long.slice(0, USER_AGENT_MAX_LENGTH) },
    ]);
  });
});

describe('GET /api/v1/audit-events', () => {
  it('lists events newest first, with the actor, target, details and origin', async () => {
    const { t, admin } = await setUp();
    const res = await send(t, 'POST', '/api/v1/invitations', {
      cookie: admin.cookie,
      remoteAddress: '203.0.113.7',
      userAgent: 'Firefox',
      body: { email: 'grace@example.com', role: 'editor' },
    });
    const { invitation } = (await res.json()) as { invitation: { id: string } };
    await signIn(t, 'nobody@example.com', PASSWORD);

    const { events: listed, nextBefore } = await list(t, admin.cookie);

    expect(listed.map(({ action }) => action)).toEqual([
      'sign_in.failed',
      'invitation.created',
      'sign_in.succeeded',
    ]);
    expect(listed[1]).toEqual({
      id: expect.any(Number) as unknown,
      action: 'invitation.created',
      actor: { id: admin.user.id, name: admin.user.name },
      target: { type: 'invitation', id: invitation.id },
      metadata: { email: 'grace@example.com', role: 'editor' },
      ip: '203.0.113.7',
      userAgent: 'Firefox',
      createdAt: expect.any(String) as unknown,
    });
    expect(listed[0]).toMatchObject({ actor: null, target: null });
    expect(nextBefore).toBeNull();
  });

  it('pages with `before` and `limit`, and filters by action', async () => {
    const { t, admin } = await setUp();
    for (let n = 1; n <= 5; n++) {
      recordAuditEvent(t.db, NOBODY, { action: 'instance.exported', metadata: { n } });
    }
    const numbers = (page: { events: ListedEvent[] }) => page.events.map((e) => e.metadata.n);

    const first = await list(t, admin.cookie, '?action=instance.exported&limit=2');
    const second = await list(
      t,
      admin.cookie,
      `?action=instance.exported&limit=2&before=${String(first.nextBefore)}`,
    );
    const third = await list(
      t,
      admin.cookie,
      `?action=instance.exported&limit=2&before=${String(second.nextBefore)}`,
    );

    expect([numbers(first), numbers(second), numbers(third)]).toEqual([[5, 4], [3, 2], [1]]);
    expect(third.nextBefore).toBeNull();
    // Exactly a page full is still the last page.
    expect(
      (await list(t, admin.cookie, '?action=instance.exported&limit=5')).nextBefore,
    ).toBeNull();
  });
});

describe('invitation events', () => {
  async function invite(t: TestApp, cookie: string) {
    const res = await send(t, 'POST', '/api/v1/invitations', {
      cookie,
      body: { email: 'grace@example.com', role: 'editor' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitation: { id: string }; link: string };
    return { id: body.invitation.id, token: new URL(body.link).hash.slice(1) };
  }

  it('records creating, resending and revoking, by the admin', async () => {
    const { t, admin } = await setUp();
    const { id } = await invite(t, admin.cookie);
    await send(t, 'POST', `/api/v1/invitations/${id}/resend`, { cookie: admin.cookie });
    await send(t, 'POST', `/api/v1/invitations/${id}/revoke`, { cookie: admin.cookie });

    const target = { targetType: 'invitation', targetId: id };
    expect(
      events(t, 'invitation.created', 'invitation.resent', 'invitation.revoked'),
    ).toMatchObject([
      {
        action: 'invitation.created',
        actorId: admin.user.id,
        ...target,
        metadata: { email: 'grace@example.com', role: 'editor' },
      },
      {
        action: 'invitation.resent',
        actorId: admin.user.id,
        ...target,
        metadata: { email: 'grace@example.com' },
      },
      {
        action: 'invitation.revoked',
        actorId: admin.user.id,
        ...target,
        metadata: { email: 'grace@example.com' },
      },
    ]);
  });

  it('records nothing when the change is refused', async () => {
    const { t, admin } = await setUp();
    const { id } = await invite(t, admin.cookie);
    await send(t, 'POST', `/api/v1/invitations/${id}/revoke`, { cookie: admin.cookie });
    const before = events(t, 'invitation.created', 'invitation.resent', 'invitation.revoked');

    const refused = [
      await send(t, 'POST', '/api/v1/invitations', {
        cookie: admin.cookie,
        body: { email: admin.user.email, role: 'viewer' },
      }),
      await send(t, 'POST', `/api/v1/invitations/${id}/resend`, { cookie: admin.cookie }),
      await send(t, 'POST', `/api/v1/invitations/${id}/revoke`, { cookie: admin.cookie }),
    ];

    expect(refused.map((res) => res.status)).toEqual([409, 404, 404]);
    expect(events(t, 'invitation.created', 'invitation.resent', 'invitation.revoked')).toEqual(
      before,
    );
  });

  it('records accepting, by the new user', async () => {
    const { t, admin } = await setUp();
    const { id, token } = await invite(t, admin.cookie);

    const res = await send(t, 'POST', '/api/v1/invitations/accept', {
      remoteAddress: '203.0.113.9',
      body: { token, name: 'Grace Hopper', password: PASSWORD },
    });
    const { user: accepted } = (await res.json()) as { user: { id: string } };

    expect(events(t, 'invitation.accepted')).toMatchObject([
      {
        actorId: accepted.id,
        targetType: 'invitation',
        targetId: id,
        metadata: { email: 'grace@example.com', role: 'editor' },
        ip: '203.0.113.9',
      },
    ]);
  });

  it('records no acceptance when creating the user fails', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    vi.spyOn(t.auth.api, 'createUser').mockRejectedValueOnce(new Error('disk full'));

    const res = await send(t, 'POST', '/api/v1/invitations/accept', {
      body: { token, name: 'Grace Hopper', password: PASSWORD },
    });

    expect(res.status).toBe(500);
    expect(events(t, 'invitation.accepted')).toEqual([]);
  });

  it('still answers 201 when the acceptance cannot be recorded, and logs why', async () => {
    const { t, admin, logs } = await setUp();
    const { token } = await invite(t, admin.cookie);
    t.db.$client.exec('drop table audit_event');

    const res = await send(t, 'POST', '/api/v1/invitations/accept', {
      body: { token, name: 'Grace Hopper', password: PASSWORD },
    });

    expect(res.status).toBe(201);
    expect(logs()).toContainEqual(notRecorded('invitation.accepted'));
  });
});

describe('sign-in events', () => {
  it('records a successful sign-in, and leaves the response as Better Auth sent it', async () => {
    const { t } = await setUp();
    const member = await createMember(t);

    const res = await signIn(t, 'grace@example.com', PASSWORD, {
      remoteAddress: '203.0.113.7',
      userAgent: 'Safari',
    });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).not.toEqual([]);
    expect(await res.json()).toMatchObject({ user: { id: member.id } });
    expect(events(t, 'sign_in.succeeded').at(-1)).toMatchObject({
      actorId: member.id,
      targetType: 'user',
      targetId: member.id,
      ip: '203.0.113.7',
      userAgent: 'Safari',
    });
  });

  it('records a wrong password against the account, with the email tried', async () => {
    const { t } = await setUp();
    const member = await createMember(t);

    const res = await signIn(t, 'Grace@Example.com', 'Not the password at all 1', {
      remoteAddress: '203.0.113.7',
    });

    expect(res.status).toBe(401);
    expect(events(t, 'sign_in.failed')).toMatchObject([
      {
        actorId: null,
        targetType: 'user',
        targetId: member.id,
        metadata: { email: 'grace@example.com', reason: 'invalid-credentials' },
        ip: '203.0.113.7',
      },
    ]);
  });

  it('records an unknown email with no target', async () => {
    const { t } = await setUp();

    await signIn(t, 'nobody@example.com', PASSWORD);

    expect(events(t, 'sign_in.failed')).toMatchObject([
      {
        targetType: null,
        targetId: null,
        metadata: { email: 'nobody@example.com', reason: 'invalid-credentials' },
      },
    ]);
  });

  it('records a deactivated account refused with the right password', async () => {
    const { t } = await setUp();
    const member = await createMember(t);
    t.db.update(user).set({ banned: true }).where(eq(user.id, member.id)).run();

    const res = await signIn(t, 'grace@example.com', PASSWORD);

    expect(res.status).toBe(403);
    expect(events(t, 'sign_in.failed')).toMatchObject([
      { targetId: member.id, metadata: { email: 'grace@example.com', reason: 'deactivated' } },
    ]);
  });

  it('records nothing when Better Auth never checked the credentials', async () => {
    const { t } = await setUp();
    await createMember(t);
    const before = events(t, 'sign_in.succeeded', 'sign_in.failed');

    const statuses = [
      (await signIn(t, 'grace@example.com', PASSWORD, { origin: 'https://evil.example' })).status,
      (
        await send(t, 'POST', `${AUTH_BASE_PATH}/sign-in/email`, {
          origin: t.publicUrl,
          body: { email: 'grace@example.com' },
        })
      ).status,
    ];

    expect(statuses).toEqual([403, 400]);
    expect(events(t, 'sign_in.succeeded', 'sign_in.failed')).toEqual(before);
  });

  it('records nothing for sign-ins the rate limiter refused', async () => {
    // Better Auth rate limits only in production.
    const { t } = await setUp({ env: { NODE_ENV: 'production' } });
    await createMember(t);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await signIn(t, 'grace@example.com', 'Not the password at all 1')).status);
    }

    expect(statuses).toContain(429);
    expect(events(t, 'sign_in.failed')).toHaveLength(statuses.filter((s) => s === 401).length);
  });

  it('still signs the user in when the event cannot be recorded, and logs why', async () => {
    const { t, logs } = await setUp();
    await createMember(t);
    t.db.$client.exec('drop table audit_event');

    const res = await signIn(t, 'grace@example.com', PASSWORD);

    expect(res.status).toBe(200);
    expect(logs()).toContainEqual(notRecorded('sign_in.succeeded'));
  });
});

describe('sign-out events', () => {
  function signOut(t: TestApp, options: RequestOptions = {}) {
    return send(t, 'POST', `${AUTH_BASE_PATH}/sign-out`, { origin: t.publicUrl, ...options });
  }

  it('records a sign-out that ended a session, by its user', async () => {
    const { t } = await setUp();
    const member = await signedInAs(t, 'editor');

    const res = await signOut(t, {
      cookie: member.cookie,
      remoteAddress: '203.0.113.7',
      userAgent: 'Safari',
    });

    expect(res.status).toBe(200);
    expect(events(t, 'sign_out.succeeded')).toMatchObject([
      {
        actorId: member.user.id,
        targetType: 'user',
        targetId: member.user.id,
        ip: '203.0.113.7',
        userAgent: 'Safari',
      },
    ]);
  });

  it('records nothing, and logs no error, when no session ended', async () => {
    const { t, logs } = await setUp();
    const member = await signedInAs(t, 'editor');

    const statuses = [
      (await signOut(t, { cookie: member.cookie, origin: 'https://evil.example' })).status,
      (await signOut(t)).status,
      (await signOut(t, { cookie: member.cookie })).status,
      // The same cookie again: its session is already gone.
      (await signOut(t, { cookie: member.cookie })).status,
    ];

    expect(statuses).toEqual([403, 200, 200, 200]);
    expect(events(t, 'sign_out.succeeded')).toHaveLength(1);
    // Not even a failed write: an event without a session's user would be refused by the database.
    expect(logs()).not.toContainEqual(notRecorded('sign_out.succeeded'));
  });

  it('still signs out when the event cannot be recorded, and logs why', async () => {
    const { t, logs } = await setUp();
    const member = await signedInAs(t, 'editor');
    t.db.$client.exec('drop table audit_event');

    const res = await signOut(t, { cookie: member.cookie });

    expect(res.status).toBe(200);
    expect(logs()).toContainEqual(notRecorded('sign_out.succeeded'));
  });
});

describe('setup events', () => {
  const FIRST_ADMIN = { name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD };
  const ADMIN_ENV = {
    ADMIN_NAME: FIRST_ADMIN.name,
    ADMIN_EMAIL: FIRST_ADMIN.email,
    ADMIN_PASSWORD: FIRST_ADMIN.password,
  };

  it('records setup through the API, by the new admin', async () => {
    const t = createTestApp();

    const res = await send(t, 'POST', '/api/v1/setup', {
      body: FIRST_ADMIN,
      remoteAddress: '203.0.113.7',
      userAgent: 'Firefox',
    });
    const { user: admin } = (await res.json()) as { user: { id: string } };

    expect(res.status).toBe(201);
    expect(events(t, 'setup.completed')).toMatchObject([
      {
        actorId: admin.id,
        targetType: 'user',
        targetId: admin.id,
        metadata: { via: 'api' },
        ip: '203.0.113.7',
        userAgent: 'Firefox',
      },
    ]);
  });

  it('records setup from the environment at startup, with no IP or user agent', async () => {
    const t = createTestApp();

    const outcome = await seedFirstAdmin({ db: t.db, auth: t.auth, logger: t.logger }, ADMIN_ENV);

    expect(outcome).toBe('created');
    const [admin] = t.db.select().from(user).all();
    expect(events(t, 'setup.completed')).toMatchObject([
      {
        actorId: admin?.id,
        targetId: admin?.id,
        metadata: { via: 'environment' },
        ip: null,
        userAgent: null,
      },
    ]);
  });

  it('records nothing when users already exist', async () => {
    const { t } = await setUp();

    const res = await send(t, 'POST', '/api/v1/setup', { body: FIRST_ADMIN });
    const outcome = await seedFirstAdmin({ db: t.db, auth: t.auth, logger: t.logger }, ADMIN_ENV);

    expect([res.status, outcome]).toEqual([409, 'users-exist']);
    expect(events(t, 'setup.completed')).toEqual([]);
  });

  it('still answers 201 when setup cannot be recorded, and logs why', async () => {
    const { t, logs } = appWithLogs();
    t.db.$client.exec('drop table audit_event');

    const res = await send(t, 'POST', '/api/v1/setup', { body: FIRST_ADMIN });

    expect(res.status).toBe(201);
    expect(logs()).toContainEqual(notRecorded('setup.completed'));
  });
});
