import { AUTH_BASE_PATH, problemDetailsSchema } from '@myli/shared';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { session } from '../db/schema.ts';
import { createTestApp, signedInAs } from '../testing.ts';
import { deactivateUser } from '../users/manage.ts';
import { requireSession } from './session.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const DAY_MS = 24 * 60 * 60 * 1000;
// Better Auth's defaults: sessions last 7 days, and are extended once they're a day old.
const SESSION_LIFETIME_MS = 7 * DAY_MS;
const REFRESH_AFTER_MS = DAY_MS;

/** The test app plus two throwaway routes: one open to anyone, one behind `requireSession`. */
function appWithTestRoutes() {
  const t = createTestApp();
  t.app.get('/api/v1/test/whoami', (c) => c.json({ user: c.var.user, session: c.var.session }));
  // `c.var.user.role` only typechecks because requireSession narrows the type.
  t.app.get('/api/v1/test/private', requireSession, (c) => c.json({ role: c.var.user.role }));

  const get = (path: 'whoami' | 'private', cookie?: string) =>
    t.app.request(`/api/v1/test/${path}`, { headers: cookie ? { cookie } : {} });
  return { ...t, get };
}

async function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  expect(problemDetailsSchema.parse(await res.json())).toMatchObject({
    status: 401,
    detail: 'Sign in to continue.',
  });
}

describe('without a session cookie', () => {
  it('sets user and session to null, and requireSession answers 401', async () => {
    const t = appWithTestRoutes();

    expect(await (await t.get('whoami')).json()).toEqual({ user: null, session: null });
    await expectUnauthorized(await t.get('private'));
  });
});

describe('with a valid session', () => {
  it('exposes the user with their role, and only the fields the app needs', async () => {
    const t = appWithTestRoutes();
    const { user, cookie } = await signedInAs(t, 'editor');

    expect(await (await t.get('whoami', cookie)).json()).toEqual({
      user: { id: user.id, name: user.name, email: user.email, role: 'editor' },
      session: { id: expect.any(String) as unknown, expiresAt: expect.any(String) as unknown },
    });

    const res = await t.get('private', cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'editor' });
  });
});

describe('a session that is no longer valid', () => {
  it('stops working right after sign-out', async () => {
    const t = appWithTestRoutes();
    const { cookie } = await signedInAs(t, 'viewer');

    const signOut = await t.app.request(`${AUTH_BASE_PATH}/sign-out`, {
      method: 'POST',
      headers: { cookie, origin: t.publicUrl, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(signOut.status).toBe(200);

    await expectUnauthorized(await t.get('private', cookie));
  });

  it('is rejected when the cookie was tampered with or is unsigned', async () => {
    const t = appWithTestRoutes();
    const { cookie } = await signedInAs(t, 'viewer');
    const [name = '', value = ''] = cookie.split('=');
    const [token = '', signature = ''] = decodeURIComponent(value).split('.');
    const flipped = signature.endsWith('A') ? 'B' : 'A';

    for (const forged of [token, `${token}.${signature.slice(0, -1)}${flipped}`]) {
      await expectUnauthorized(await t.get('private', `${name}=${encodeURIComponent(forged)}`));
    }
  });

  it('is rejected once expired, deleted, and its cookie cleared', async () => {
    const t = appWithTestRoutes();
    const { user, cookie } = await signedInAs(t, 'viewer');
    t.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.userId, user.id))
      .run();

    const res = await t.get('private', cookie);
    await expectUnauthorized(res);
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__Secure-myli\.session_token=;.*Max-Age=0/),
    );
    expect(t.db.select().from(session).where(eq(session.userId, user.id)).all()).toEqual([]);
  });

  it('is rejected on the very next request after the user is deactivated', async () => {
    const t = appWithTestRoutes();
    const admin = await signedInAs(t, 'admin');
    const viewer = await signedInAs(t, 'viewer');
    expect((await t.get('private', viewer.cookie)).status).toBe(200);

    const origin = { actorId: admin.user.id, ip: null, userAgent: null };
    expect(deactivateUser(t.db, origin, viewer.user.id)).toMatchObject({ ok: true, changed: true });

    await expectUnauthorized(await t.get('private', viewer.cookie));
  });
});

describe('session refresh', () => {
  it('extends a day-old session and sends the new cookie, whatever the route answers', async () => {
    const t = appWithTestRoutes();
    const { user, cookie } = await signedInAs(t, 'viewer');
    const dayOld = new Date(Date.now() + SESSION_LIFETIME_MS - REFRESH_AFTER_MS - 60_000);
    t.db.update(session).set({ expiresAt: dayOld }).where(eq(session.userId, user.id)).run();

    // A route that has nothing to do with sessions, and fails: the cookie must still get through.
    const res = await t.app.request('/api/v1/does-not-exist', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__Secure-myli\.session_token=[^;]+;.*Max-Age=604800/),
    );
    const [row] = t.db.select().from(session).where(eq(session.userId, user.id)).all();
    expect(row?.expiresAt.getTime()).toBeGreaterThan(dayOld.getTime() + REFRESH_AFTER_MS / 2);
  });

  it('leaves a fresh session and its cookie alone', async () => {
    const t = appWithTestRoutes();
    const { cookie } = await signedInAs(t, 'viewer');

    const res = await t.get('private', cookie);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('when the session lookup fails', () => {
  it('treats a session that vanished mid-refresh as signed out', async () => {
    const t = appWithTestRoutes();
    const { cookie } = await signedInAs(t, 'viewer');
    vi.spyOn(t.auth.api, 'getSession').mockRejectedValue(new APIError('UNAUTHORIZED'));

    expect(await (await t.get('whoami', cookie)).json()).toEqual({ user: null, session: null });
    await expectUnauthorized(await t.get('private', cookie));
  });

  it('fails closed with a 500 on any other error', async () => {
    const t = appWithTestRoutes();
    const { cookie } = await signedInAs(t, 'viewer');
    vi.spyOn(t.auth.api, 'getSession').mockRejectedValue(new Error('database is locked'));

    const res = await t.get('whoami', cookie);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('database');
  });
});
