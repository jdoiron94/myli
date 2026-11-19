import { createHash, randomUUID } from 'node:crypto';
import { AUTH_BASE_PATH, validationProblemSchema } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserWithPassword } from '../auth/users.ts';
import { invitation, user } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, signedInAs, type TestApp, type TestAppOptions } from '../testing.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const UNUSABLE = 'This invitation link is invalid, expired or already used. Ask for a new one.';
const NOT_OPEN = 'No open invitation has this ID. It may have been accepted or revoked.';
const INVITEE = { name: 'Grace Hopper', password: 'An invitee password 1' };

/** A test app with a signed-in admin, and every log line kept. */
async function setUp(options: TestAppOptions = {}) {
  const lines: string[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      lines.push(line);
    },
  });
  const t = createTestApp({ ...options, logger });
  const admin = await signedInAs(t, 'admin');
  return {
    t,
    admin,
    rawLogs: () => lines.join(''),
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function post(t: TestApp, path: string, body: unknown, cookie?: string) {
  return t.app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie !== undefined && { cookie }) },
    body: JSON.stringify(body),
  });
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'expired';
  expiresAt: string;
  createdAt: string;
}

interface Created {
  invitation: Invitation;
  link: string;
}

/** Invites `email` as the admin and returns the response body and the token from the link. */
async function invite(
  t: TestApp,
  cookie: string,
  body: { email: string; role: string } = { email: 'grace@example.com', role: 'editor' },
) {
  const res = await post(t, '/invitations', body, cookie);
  expect(res.status).toBe(201);
  const created = (await res.json()) as Created;
  return { ...created, token: tokenOf(created.link) };
}

/** Resends or revokes an invitation, as a browser would: JSON, though there is no body. */
function act(t: TestApp, id: string, action: 'resend' | 'revoke', cookie: string) {
  return t.app.request(`/api/v1/invitations/${id}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
  });
}

async function listInvitations(t: TestApp, cookie: string) {
  const res = await t.app.request('/api/v1/invitations', { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { invitations: Invitation[] }).invitations;
}

const tokenOf = (link: string) => new URL(link).hash.slice(1);

/** Makes every invitation's link expire, as if its lifetime had passed. */
function expireAll(t: TestApp) {
  t.db
    .update(invitation)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .run();
}

/** Puts the invitation with `id` into `state`, through the API where it can. */
async function makeState(
  t: TestApp,
  cookie: string,
  created: { invitation: Invitation; token: string },
  state: 'accepted' | 'revoked',
) {
  const res =
    state === 'accepted'
      ? await post(t, '/invitations/accept', { token: created.token, ...INVITEE })
      : await act(t, created.invitation.id, 'revoke', cookie);
  expect(res.ok).toBe(true);
}

async function detail(res: Response) {
  return ((await res.json()) as { detail?: string }).detail;
}

const invitations = (t: TestApp) => t.db.select().from(invitation).all();
const usersWithEmail = (t: TestApp, email: string) =>
  t.db.select().from(user).where(eq(user.email, email)).all();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('POST /api/v1/invitations', () => {
  it('creates an invitation, with a link whose token is stored only as a hash', async () => {
    const { t, admin } = await setUp();

    const created = await invite(t, admin.cookie, { email: 'Grace@Example.com', role: 'editor' });

    expect(created.invitation).toEqual({
      id: expect.any(String) as unknown,
      email: 'grace@example.com',
      role: 'editor',
      status: 'pending',
      expiresAt: expect.any(String) as unknown,
      createdAt: expect.any(String) as unknown,
    });
    const { expiresAt, createdAt } = created.invitation;
    expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(7 * DAY_MS);
    expect(created.link).toMatch(/^https:\/\/myli\.test\/accept-invitation#[\w-]{43}$/);

    expect(invitations(t)).toMatchObject([
      { id: created.invitation.id, tokenHash: sha256(created.token), invitedBy: admin.user.id },
    ]);
    // Nowhere in the database, in any table or column.
    expect(t.db.$client.serialize().includes(created.token)).toBe(false);
  });

  it('keeps links working for INVITATION_TTL_DAYS', async () => {
    const { t, admin } = await setUp({ env: { INVITATION_TTL_DAYS: 2 } });

    const { invitation: created } = await invite(t, admin.cookie);

    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(2 * DAY_MS);
  });

  it('refuses an email that already belongs to a user', async () => {
    const { t, admin } = await setUp();

    const res = await post(
      t,
      '/invitations',
      { email: admin.user.email.toUpperCase(), role: 'viewer' },
      admin.cookie,
    );

    expect(res.status).toBe(409);
    expect(await detail(res)).toBe('A user with this email already exists.');
    expect(invitations(t)).toEqual([]);
  });

  it('refuses a second open invitation for the same email, expired or not', async () => {
    const { t, admin } = await setUp();
    await invite(t, admin.cookie);
    t.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();

    const again = await post(
      t,
      '/invitations',
      { email: 'grace@example.com', role: 'admin' },
      admin.cookie,
    );

    expect(again.status).toBe(409);
    expect(await detail(again)).toBe('This email already has an open invitation.');
    expect(invitations(t)).toHaveLength(1);
  });

  it('allows a new invitation once the earlier one was revoked', async () => {
    const { t, admin } = await setUp();
    await invite(t, admin.cookie);
    t.db.update(invitation).set({ revokedAt: new Date() }).run();

    await invite(t, admin.cookie);

    expect(invitations(t)).toHaveLength(2);
  });

  it('has the database refuse a second open invitation, whatever the code does', async () => {
    const { t, admin } = await setUp();
    const { invitation: first } = await invite(t, admin.cookie);
    const duplicate = {
      email: first.email,
      role: 'viewer' as const,
      tokenHash: sha256('another token'),
      expiresAt: new Date(Date.now() + DAY_MS),
      invitedBy: admin.user.id,
    };

    expect(() => t.db.insert(invitation).values(duplicate).run()).toThrow(/UNIQUE constraint/);
    t.db.update(invitation).set({ revokedAt: new Date() }).run();
    expect(() => t.db.insert(invitation).values(duplicate).run()).not.toThrow();
  });

  it('answers invalid input with a validation problem naming each field', async () => {
    const { t, admin } = await setUp();

    const res = await post(t, '/invitations', { email: 'nope', role: 'owner' }, admin.cookie);

    expect(res.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await res.json());
    expect(new Set(errors.map((error) => error.pointer))).toEqual(new Set(['#/email', '#/role']));
  });

  it('logs the new invitation by ID, never its email or link', async () => {
    const { t, admin, logs, rawLogs } = await setUp();

    const created = await invite(t, admin.cookie);

    expect(logs()).toContainEqual(
      expect.objectContaining({ msg: 'invitation created', invitationId: created.invitation.id }),
    );
    expect(rawLogs()).not.toContain('grace@example.com');
    expect(rawLogs()).not.toContain(created.token);
  });
});

describe('POST /api/v1/invitations/lookup', () => {
  it('says what a working link is for', async () => {
    const { t, admin } = await setUp();
    const { token, invitation: created } = await invite(t, admin.cookie);

    const res = await post(t, '/invitations/lookup', { token });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: 'grace@example.com',
      role: 'editor',
      expiresAt: created.expiresAt,
    });
  });

  it('answers every unusable link with the same 404: unknown, expired, revoked or accepted', async () => {
    const answers: Record<string, [number, string | undefined]> = {};
    for (const state of ['unknown', 'expired', 'revoked', 'accepted'] as const) {
      const { t, admin } = await setUp();
      let { token } = await invite(t, admin.cookie);
      if (state === 'unknown') token = 'not-a-real-token';
      if (state === 'expired') {
        t.db
          .update(invitation)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .run();
      }
      if (state === 'revoked') t.db.update(invitation).set({ revokedAt: new Date() }).run();
      if (state === 'accepted') {
        expect((await post(t, '/invitations/accept', { token, ...INVITEE })).status).toBe(201);
      }

      const res = await post(t, '/invitations/lookup', { token });
      answers[state] = [res.status, await detail(res)];
    }

    expect(answers).toEqual({
      unknown: [404, UNUSABLE],
      expired: [404, UNUSABLE],
      revoked: [404, UNUSABLE],
      accepted: [404, UNUSABLE],
    });
  });
});

describe('POST /api/v1/invitations/accept', () => {
  it('creates the invited user, verified, without signing them in; they can then sign in', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);

    const res = await post(t, '/invitations/accept', { token, ...INVITEE });

    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user).toEqual({
      id: expect.any(String) as unknown,
      name: 'Grace Hopper',
      email: 'grace@example.com',
      role: 'editor',
    });
    expect(usersWithEmail(t, 'grace@example.com')).toMatchObject([
      { id: body.user.id, role: 'editor', emailVerified: true },
    ]);
    expect(invitations(t)).toMatchObject([{ acceptedAt: expect.any(Date) as unknown }]);

    const signIn = await t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
      method: 'POST',
      headers: { origin: t.publicUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'grace@example.com', password: INVITEE.password }),
    });
    expect(signIn.status).toBe(200);
  });

  it('refuses a link already used, expired or revoked, creating no one', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    await post(t, '/invitations/accept', { token, ...INVITEE });
    const replay = await post(t, '/invitations/accept', { token, ...INVITEE, name: 'Mallory' });
    expect([replay.status, await detail(replay)]).toEqual([404, UNUSABLE]);
    expect(usersWithEmail(t, 'grace@example.com')).toMatchObject([{ name: 'Grace Hopper' }]);

    for (const state of ['expired', 'revoked'] as const) {
      const other = await setUp();
      const { token: unusable } = await invite(other.t, other.admin.cookie);
      other.t.db
        .update(invitation)
        .set(
          state === 'expired'
            ? { expiresAt: new Date(Date.now() - 1000) }
            : { revokedAt: new Date() },
        )
        .run();

      const res = await post(other.t, '/invitations/accept', { token: unusable, ...INVITEE });
      expect([res.status, await detail(res)], state).toEqual([404, UNUSABLE]);
      expect(usersWithEmail(other.t, 'grace@example.com'), state).toEqual([]);
    }
  });

  it('creates exactly one user when two acceptances arrive at the same moment', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);

    const responses = await Promise.all([
      post(t, '/invitations/accept', { token, ...INVITEE }),
      post(t, '/invitations/accept', { token, ...INVITEE, name: 'Grace Two' }),
    ]);

    expect(responses.map((res) => res.status).toSorted()).toEqual([201, 404]);
    expect(usersWithEmail(t, 'grace@example.com')).toHaveLength(1);
  });

  it('releases the claim when creating the user fails, so the link works again', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    vi.spyOn(t.auth.api, 'createUser').mockRejectedValueOnce(new Error('disk full'));

    expect((await post(t, '/invitations/accept', { token, ...INVITEE })).status).toBe(500);
    expect(invitations(t)).toMatchObject([{ acceptedAt: null }]);

    expect((await post(t, '/invitations/accept', { token, ...INVITEE })).status).toBe(201);
  });

  it('refuses when a user already has the email, and leaves the invitation open', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    // Can't happen through the API (inviting an existing user is refused), but other paths, like
    // a seed script, could create the user in between.
    await createUserWithPassword(t.auth, {
      name: 'Grace',
      email: 'grace@example.com',
      password: 'An existing password 1',
      role: 'viewer',
    });

    const res = await post(t, '/invitations/accept', { token, ...INVITEE });

    expect(res.status).toBe(409);
    expect(await detail(res)).toBe('A user with this email already exists.');
    expect(invitations(t)).toMatchObject([{ acceptedAt: null }]);
  });

  it('checks the name and password before using up the link', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);

    const res = await post(t, '/invitations/accept', { token, name: ' ', password: 'short' });

    expect(res.status).toBe(422);
    const { errors } = validationProblemSchema.parse(await res.json());
    expect(new Set(errors.map((error) => error.pointer))).toEqual(
      new Set(['#/name', '#/password']),
    );
    expect((await post(t, '/invitations/lookup', { token })).status).toBe(200);
  });

  it('logs the acceptance by ID, never the token or the email', async () => {
    const { t, admin, logs, rawLogs } = await setUp();
    const { token, invitation: created } = await invite(t, admin.cookie);

    const res = await post(t, '/invitations/accept', { token, ...INVITEE });
    const { user: accepted } = (await res.json()) as { user: { id: string } };

    expect(logs()).toContainEqual(
      expect.objectContaining({
        msg: 'invitation accepted',
        invitationId: created.id,
        userId: accepted.id,
      }),
    );
    expect(rawLogs()).not.toContain(token);
    expect(rawLogs()).not.toContain('grace@example.com');
  });
});

describe('GET /api/v1/invitations', () => {
  it('lists open invitations newest first, pending or expired, leaving out accepted and revoked ones', async () => {
    const { t, admin } = await setUp();
    const oldest = await invite(t, admin.cookie, { email: 'ada@example.com', role: 'viewer' });
    const expired = await invite(t, admin.cookie, { email: 'grace@example.com', role: 'editor' });
    const newest = await invite(t, admin.cookie, { email: 'alan@example.com', role: 'admin' });
    await makeState(
      t,
      admin.cookie,
      await invite(t, admin.cookie, { email: 'barbara@example.com', role: 'viewer' }),
      'accepted',
    );
    await makeState(
      t,
      admin.cookie,
      await invite(t, admin.cookie, { email: 'edsger@example.com', role: 'viewer' }),
      'revoked',
    );
    // Distinct creation times, so the order doesn't depend on the clock's resolution.
    const createdDaysAgo = (id: string, days: number) => {
      const createdAt = new Date(Date.now() - days * DAY_MS);
      t.db.update(invitation).set({ createdAt }).where(eq(invitation.id, id)).run();
      return createdAt.toISOString();
    };
    const newestCreatedAt = createdDaysAgo(newest.invitation.id, 1);
    createdDaysAgo(expired.invitation.id, 2);
    createdDaysAgo(oldest.invitation.id, 3);
    t.db
      .update(invitation)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitation.id, expired.invitation.id))
      .run();

    const listed = await listInvitations(t, admin.cookie);

    expect(listed.map(({ email, status }) => [email, status])).toEqual([
      ['alan@example.com', 'pending'],
      ['grace@example.com', 'expired'],
      ['ada@example.com', 'pending'],
    ]);
    // Exactly these fields: never a token or its hash.
    expect(listed[0]).toEqual({ ...newest.invitation, createdAt: newestCreatedAt });
  });
});

describe('POST /api/v1/invitations/{id}/resend', () => {
  it('issues a new link that works for the full lifetime again, and stops the old one', async () => {
    const { t, admin } = await setUp();
    const first = await invite(t, admin.cookie);
    expireAll(t);

    const before = Date.now();
    const res = await act(t, first.invitation.id, 'resend', admin.cookie);
    const after = Date.now();

    expect(res.status).toBe(200);
    const resent = (await res.json()) as Created;
    const token = tokenOf(resent.link);
    expect(token).not.toBe(first.token);
    expect(resent.invitation).toMatchObject({
      ...first.invitation,
      status: 'pending',
      expiresAt: expect.any(String) as unknown,
    });
    const expiresAt = Date.parse(resent.invitation.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + 7 * DAY_MS);

    expect((await post(t, '/invitations/lookup', { token: first.token })).status).toBe(404);
    expect((await post(t, '/invitations/lookup', { token })).status).toBe(200);
    expect(invitations(t)).toMatchObject([{ tokenHash: sha256(token) }]);
    expect(t.db.$client.serialize().includes(token)).toBe(false);
  });

  it('answers 404 for an invitation that is unknown, accepted or revoked, and changes nothing', async () => {
    for (const state of ['unknown', 'accepted', 'revoked'] as const) {
      const { t, admin } = await setUp();
      const created = await invite(t, admin.cookie);
      if (state !== 'unknown') await makeState(t, admin.cookie, created, state);
      const before = invitations(t);

      const id = state === 'unknown' ? randomUUID() : created.invitation.id;
      const res = await act(t, id, 'resend', admin.cookie);

      expect([res.status, await detail(res)], state).toEqual([404, NOT_OPEN]);
      expect(invitations(t), state).toEqual(before);
    }
  });

  it('refuses when a user has taken the email since, and changes nothing', async () => {
    const { t, admin } = await setUp();
    const created = await invite(t, admin.cookie);
    await createUserWithPassword(t.auth, {
      name: 'Grace',
      email: 'grace@example.com',
      password: 'An existing password 1',
      role: 'viewer',
    });
    const before = invitations(t);

    const res = await act(t, created.invitation.id, 'resend', admin.cookie);

    expect(res.status).toBe(409);
    expect(await detail(res)).toBe('A user with this email already exists.');
    expect(invitations(t)).toEqual(before);
  });

  it('logs the resend by ID, never the email or the new link', async () => {
    const { t, admin, logs, rawLogs } = await setUp();
    const created = await invite(t, admin.cookie);

    const res = await act(t, created.invitation.id, 'resend', admin.cookie);
    const { link } = (await res.json()) as Created;

    expect(logs()).toContainEqual(
      expect.objectContaining({ msg: 'invitation resent', invitationId: created.invitation.id }),
    );
    expect(rawLogs()).not.toContain('grace@example.com');
    expect(rawLogs()).not.toContain(tokenOf(link));
  });
});

describe('POST /api/v1/invitations/{id}/revoke', () => {
  it('stops the link working, drops it from the list, and lets the email be invited again', async () => {
    const { t, admin } = await setUp();
    const created = await invite(t, admin.cookie);

    const res = await act(t, created.invitation.id, 'revoke', admin.cookie);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await post(t, '/invitations/lookup', { token: created.token })).status).toBe(404);
    expect(invitations(t)).toMatchObject([{ revokedAt: expect.any(Date) as unknown }]);
    expect(await listInvitations(t, admin.cookie)).toEqual([]);
    await invite(t, admin.cookie);
  });

  it('answers 404 for an invitation that is unknown, accepted or revoked, and changes nothing', async () => {
    for (const state of ['unknown', 'accepted', 'revoked'] as const) {
      const { t, admin } = await setUp();
      const created = await invite(t, admin.cookie);
      if (state !== 'unknown') await makeState(t, admin.cookie, created, state);
      const before = invitations(t);

      const id = state === 'unknown' ? randomUUID() : created.invitation.id;
      const res = await act(t, id, 'revoke', admin.cookie);

      expect([res.status, await detail(res)], state).toEqual([404, NOT_OPEN]);
      expect(invitations(t), state).toEqual(before);
    }
  });

  it('logs the revocation by ID, never the email', async () => {
    const { t, admin, logs, rawLogs } = await setUp();
    const created = await invite(t, admin.cookie);

    await act(t, created.invitation.id, 'revoke', admin.cookie);

    expect(logs()).toContainEqual(
      expect.objectContaining({ msg: 'invitation revoked', invitationId: created.invitation.id }),
    );
    expect(rawLogs()).not.toContain('grace@example.com');
  });
});

describe('resending and revoking against accepting', () => {
  it('a resent invitation can no longer be accepted with the old link, only the new one', async () => {
    const { t, admin } = await setUp();
    const created = await invite(t, admin.cookie);
    const res = await act(t, created.invitation.id, 'resend', admin.cookie);
    const { link } = (await res.json()) as Created;

    const old = await post(t, '/invitations/accept', { token: created.token, ...INVITEE });
    expect(old.status).toBe(404);
    expect(await detail(old)).toBe(UNUSABLE);

    const current = await post(t, '/invitations/accept', { token: tokenOf(link), ...INVITEE });
    expect(current.status).toBe(201);
  });

  it('refuses both while an acceptance is creating the user, and the link works again if that fails', async () => {
    const { t, admin } = await setUp();
    const created = await invite(t, admin.cookie);
    const creating = Promise.withResolvers<never>();
    const createUser = vi.spyOn(t.auth.api, 'createUser').mockReturnValueOnce(creating.promise);

    const accepting = post(t, '/invitations/accept', { token: created.token, ...INVITEE });
    await vi.waitFor(() => {
      expect(createUser).toHaveBeenCalled();
    });

    expect((await act(t, created.invitation.id, 'resend', admin.cookie)).status).toBe(404);
    expect((await act(t, created.invitation.id, 'revoke', admin.cookie)).status).toBe(404);
    expect(await listInvitations(t, admin.cookie)).toEqual([]);

    creating.reject(new Error('disk full'));
    expect((await accepting).status).toBe(500);
    expect((await post(t, '/invitations/lookup', { token: created.token })).status).toBe(200);
    expect(await listInvitations(t, admin.cookie)).toHaveLength(1);
  });
});
