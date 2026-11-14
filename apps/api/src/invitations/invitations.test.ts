import { createHash } from 'node:crypto';
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

interface Created {
  invitation: { id: string; email: string; role: string; expiresAt: string; createdAt: string };
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
  return { ...created, token: new URL(created.link).hash.slice(1) };
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

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
    'refuses a %s body, which a cross-site form could send with the admin cookie',
    async (contentType) => {
      const { t, admin } = await setUp();

      const res = await t.app.request('/api/v1/invitations', {
        method: 'POST',
        headers: { cookie: admin.cookie, 'content-type': contentType },
        body: JSON.stringify({ email: 'grace@example.com', role: 'admin' }),
      });

      expect(res.status).toBe(415);
      expect(invitations(t)).toEqual([]);
    },
  );

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

  it.each(['unknown', 'expired', 'revoked', 'accepted'] as const)(
    'answers an %s link with the same 404 as every other unusable link',
    async (state) => {
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

      expect(res.status).toBe(404);
      expect(await detail(res)).toBe(UNUSABLE);
    },
  );
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

  it('refuses the same link a second time', async () => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    await post(t, '/invitations/accept', { token, ...INVITEE });

    const replay = await post(t, '/invitations/accept', { token, ...INVITEE, name: 'Mallory' });

    expect(replay.status).toBe(404);
    expect(await detail(replay)).toBe(UNUSABLE);
    expect(usersWithEmail(t, 'grace@example.com')).toMatchObject([{ name: 'Grace Hopper' }]);
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

  it.each(['expired', 'revoked'] as const)('refuses a %s link', async (state) => {
    const { t, admin } = await setUp();
    const { token } = await invite(t, admin.cookie);
    t.db
      .update(invitation)
      .set(
        state === 'expired'
          ? { expiresAt: new Date(Date.now() - 1000) }
          : { revokedAt: new Date() },
      )
      .run();

    const res = await post(t, '/invitations/accept', { token, ...INVITEE });

    expect(res.status).toBe(404);
    expect(await detail(res)).toBe(UNUSABLE);
    expect(usersWithEmail(t, 'grace@example.com')).toEqual([]);
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
