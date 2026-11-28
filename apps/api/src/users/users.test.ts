import { AUTH_BASE_PATH, validationProblemSchema } from '@myli/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditEvent, session, user } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, signedInAs, type TestApp } from '../testing.ts';
import { changeRole, deactivateUser, reactivateUser } from './manage.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const NOBODY_ELSE = { ip: null, userAgent: null };

/** A test app with a signed-in admin, and every log line kept. */
async function setUp() {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ logger });
  const admin = await signedInAs(t, 'admin');
  return { t, admin, rawLogs: () => lines.join('') };
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

const setRole = (t: TestApp, cookie: string, id: string, role: string) =>
  send(t, 'PUT', `/users/${id}/role`, cookie, { role });
const deactivate = (t: TestApp, cookie: string, id: string) =>
  send(t, 'POST', `/users/${id}/deactivate`, cookie);
const reactivate = (t: TestApp, cookie: string, id: string) =>
  send(t, 'POST', `/users/${id}/reactivate`, cookie);

/** Whether `cookie` still has a session, and what its role allows: 200 admin, 403 not, 401 none. */
async function accessWith(t: TestApp, cookie: string) {
  return (await send(t, 'GET', '/users', cookie)).status;
}

function signIn(t: TestApp, email: string) {
  return t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
    method: 'POST',
    headers: { origin: t.publicUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'A test password, long enough 1' }),
  });
}

async function detail(res: Response) {
  return ((await res.json()) as { detail?: string }).detail;
}

/**
 * Holds each session lookup until both requests have made theirs, so both get past the admin guard
 * before either change runs: the interleaving only the check inside the transaction can catch.
 */
function holdBothAtTheGuard(t: TestApp) {
  const lookUp = t.auth.api.getSession.bind(t.auth.api);
  const bothLookedUp = Promise.withResolvers<undefined>();
  let lookedUp = 0;
  vi.spyOn(t.auth.api, 'getSession').mockImplementation(
    async (...args: Parameters<typeof lookUp>) => {
      const found = await lookUp(...args);
      lookedUp += 1;
      if (lookedUp === 2) bothLookedUp.resolve(undefined);
      await bothLookedUp.promise;
      return found;
    },
  );
}

/** One change went through, and the other was refused because its admin had just lost the role. */
async function expectSecondRefused(responses: Response[]) {
  expect(responses.map((res) => res.status).toSorted()).toEqual([200, 403]);
  const refused = responses.find((res) => res.status === 403);
  expect(refused && (await detail(refused))).toBe("You don't have permission to do this.");
}

const userRow = (t: TestApp, id: string) => t.db.select().from(user).where(eq(user.id, id)).get();
const auditEvents = (t: TestApp) => t.db.select().from(auditEvent).all();
const userEvents = (t: TestApp) =>
  auditEvents(t).filter((event) => event.action.startsWith('user.'));

describe('GET /api/v1/users', () => {
  it('lists every user, oldest first, with their role and whether they are deactivated', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');
    t.db.update(user).set({ banned: true }).where(eq(user.id, member.user.id)).run();

    const res = await send(t, 'GET', '/users', admin.cookie);

    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: unknown[] };
    expect(users).toEqual([
      {
        ...admin.user,
        avatar: null,
        deactivated: false,
        createdAt: userRow(t, admin.user.id)?.createdAt.toISOString(),
      },
      {
        ...member.user,
        avatar: null,
        deactivated: true,
        createdAt: userRow(t, member.user.id)?.createdAt.toISOString(),
      },
    ]);
  });
});

describe('PUT /api/v1/users/{id}/role', () => {
  it("changes the role from the user's very next request, and records it", async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');
    expect(await accessWith(t, member.cookie)).toBe(403);

    const res = await setRole(t, admin.cookie, member.user.id, 'admin');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: member.user.id, role: 'admin' } });
    expect(await accessWith(t, member.cookie)).toBe(200);
    expect(userEvents(t)).toMatchObject([
      {
        action: 'user.role_changed',
        actorId: admin.user.id,
        targetType: 'user',
        targetId: member.user.id,
        metadata: { from: 'editor', to: 'admin' },
      },
    ]);

    await setRole(t, admin.cookie, member.user.id, 'viewer');
    expect(await accessWith(t, member.cookie)).toBe(403);
  });

  it('changes nothing, and records nothing, when the user already has the role', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');

    const res = await setRole(t, admin.cookie, member.user.id, 'editor');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { role: 'editor' } });
    expect(userEvents(t)).toEqual([]);
  });

  it("refuses an admin's own role, even with another admin around", async () => {
    const { t, admin } = await setUp();
    await signedInAs(t, 'admin');

    const res = await setRole(t, admin.cookie, admin.user.id, 'viewer');

    expect(res.status).toBe(409);
    expect(await detail(res)).toBe("You can't change your own role. Another admin has to.");
    expect(userRow(t, admin.user.id)?.role).toBe('admin');
    expect(userEvents(t)).toEqual([]);
  });

  it('answers 404 for an unknown user, and 422 for an unknown role', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');

    const missing = await setRole(t, admin.cookie, 'no-such-user', 'viewer');
    const invalid = await setRole(t, admin.cookie, member.user.id, 'owner');

    expect(missing.status).toBe(404);
    expect(await detail(missing)).toBe('No user has this ID.');
    expect(invalid.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await invalid.json());
    expect(errors.map((error) => error.pointer)).toEqual(['#/role']);
  });
});

describe('two admins acting on each other at the same moment', () => {
  it('leave an active admin when they demote each other', async () => {
    const { t, admin } = await setUp();
    const other = await signedInAs(t, 'admin');
    holdBothAtTheGuard(t);

    const responses = await Promise.all([
      setRole(t, admin.cookie, other.user.id, 'viewer'),
      setRole(t, other.cookie, admin.user.id, 'viewer'),
    ]);

    await expectSecondRefused(responses);
    expect(t.db.select().from(user).where(eq(user.role, 'admin')).all()).toHaveLength(1);
    expect(userEvents(t)).toHaveLength(1);
  });

  it('leave an active admin when they deactivate each other', async () => {
    const { t, admin } = await setUp();
    const other = await signedInAs(t, 'admin');
    holdBothAtTheGuard(t);

    const responses = await Promise.all([
      deactivate(t, admin.cookie, other.user.id),
      deactivate(t, other.cookie, admin.user.id),
    ]);

    await expectSecondRefused(responses);
    const activeAdmins = t.db
      .select()
      .from(user)
      .where(and(eq(user.role, 'admin'), eq(user.banned, false)))
      .all();
    expect(activeAdmins).toHaveLength(1);
    expect(userEvents(t)).toHaveLength(1);
  });
});

describe('an admin who lost the role after their request passed the guard', () => {
  // Through HTTP, that's the race above. Here the actor is changed just before the call.
  it('is refused every change once demoted or deactivated, before the target is looked at', async () => {
    for (const [, change] of [
      ['demoted', { role: 'editor' }],
      ['deactivated', { banned: true }],
    ] as const) {
      const { t, admin } = await setUp();
      const member = (await signedInAs(t, 'editor')).user;
      const inactive = (await signedInAs(t, 'editor')).user;
      t.db.update(user).set({ banned: true }).where(eq(user.id, inactive.id)).run();
      t.db.update(user).set(change).where(eq(user.id, admin.user.id)).run();
      const origin = { ...NOBODY_ELSE, actorId: admin.user.id };

      const calls = {
        "a member's role": () => changeRole(t.db, origin, member.id, 'admin'),
        'their own role': () => changeRole(t.db, origin, admin.user.id, 'admin'),
        "an unknown user's role": () => changeRole(t.db, origin, 'no-such-user', 'admin'),
        'deactivating a member': () => deactivateUser(t.db, origin, member.id),
        'deactivating themselves': () => deactivateUser(t.db, origin, admin.user.id),
        'deactivating an unknown user': () => deactivateUser(t.db, origin, 'no-such-user'),
        'reactivating a member': () => reactivateUser(t.db, origin, inactive.id),
        'reactivating an unknown user': () => reactivateUser(t.db, origin, 'no-such-user'),
      };
      for (const [label, call] of Object.entries(calls)) {
        expect(call(), label).toEqual({ ok: false, reason: 'forbidden' });
      }

      expect(userRow(t, member.id)).toMatchObject({ role: 'editor', banned: false });
      expect(userRow(t, inactive.id)).toMatchObject({ banned: true });
      expect(userEvents(t)).toEqual([]);
    }
  });
});

describe('POST /api/v1/users/{id}/deactivate', () => {
  it('ends their sessions, refuses their sign-ins, and records it', async () => {
    const { t, admin, rawLogs } = await setUp();
    const member = await signedInAs(t, 'editor');
    await signIn(t, member.user.email); // a second session
    expect(await accessWith(t, member.cookie)).toBe(403);

    const res = await deactivate(t, admin.cookie, member.user.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: member.user.id, deactivated: true } });
    expect(await accessWith(t, member.cookie)).toBe(401);
    expect(t.db.select().from(session).where(eq(session.userId, member.user.id)).all()).toEqual([]);
    expect(await accessWith(t, admin.cookie)).toBe(200);
    expect((await signIn(t, member.user.email)).status).toBe(403);
    expect(userEvents(t)).toMatchObject([
      {
        action: 'user.deactivated',
        actorId: admin.user.id,
        targetType: 'user',
        targetId: member.user.id,
        metadata: { sessionsEnded: 2 },
      },
    ]);
    expect(rawLogs()).not.toContain(member.user.email);
  });

  it('changes nothing, and records nothing, for a user already deactivated', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');
    await deactivate(t, admin.cookie, member.user.id);

    const again = await deactivate(t, admin.cookie, member.user.id);

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ user: { deactivated: true } });
    expect(userEvents(t)).toHaveLength(1);
  });

  it("refuses to deactivate the admin's own account", async () => {
    const { t, admin } = await setUp();
    await signedInAs(t, 'admin');

    const res = await deactivate(t, admin.cookie, admin.user.id);

    expect(res.status).toBe(409);
    expect(await detail(res)).toBe("You can't deactivate yourself. Another admin has to.");
    expect(await accessWith(t, admin.cookie)).toBe(200);
    expect(userEvents(t)).toEqual([]);
  });

  it('answers 404 for an unknown user', async () => {
    const { t, admin } = await setUp();

    const res = await deactivate(t, admin.cookie, 'no-such-user');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/users/{id}/reactivate', () => {
  it('lets the user sign in again, and records it', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');
    await deactivate(t, admin.cookie, member.user.id);

    const res = await reactivate(t, admin.cookie, member.user.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { deactivated: false } });
    expect((await signIn(t, member.user.email)).status).toBe(200);
    expect(userEvents(t).map(({ action }) => action)).toEqual([
      'user.deactivated',
      'user.reactivated',
    ]);
    expect(userEvents(t)[1]).toMatchObject({ actorId: admin.user.id, targetId: member.user.id });
  });

  it('changes nothing, and records nothing, for an active user', async () => {
    const { t, admin } = await setUp();
    const member = await signedInAs(t, 'editor');

    const res = await reactivate(t, admin.cookie, member.user.id);

    expect(res.status).toBe(200);
    expect(userEvents(t)).toEqual([]);
  });

  it('answers 404 for an unknown user', async () => {
    const { t, admin } = await setUp();

    expect((await reactivate(t, admin.cookie, 'no-such-user')).status).toBe(404);
  });
});
