import { AUTH_BASE_PATH } from '@myli/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupClaim, user } from '../db/schema.ts';
import { createTestApp, type TestApp } from '../testing.ts';
import { STALE_CLAIM_MS } from './setup.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const ADMIN = {
  name: 'Ada Lovelace',
  email: 'Ada@Example.com',
  password: 'Correct horse battery 9',
};

function postSetup(t: TestApp, body: unknown = ADMIN) {
  return t.app.request('/api/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function setupStatus(t: TestApp) {
  return (await t.app.request('/api/v1/setup')).json();
}

const users = (t: TestApp) => t.db.select().from(user).all();
const claims = (t: TestApp) => t.db.select().from(setupClaim).all();

async function problemDetail(res: Response) {
  return ((await res.json()) as { detail?: string }).detail;
}

describe('GET /api/v1/setup', () => {
  it('says setup is needed on a fresh instance, and is never cached', async () => {
    const res = await createTestApp().app.request('/api/v1/setup');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ needed: true });
  });
});

describe('POST /api/v1/setup', () => {
  it('creates the first admin, unverified, who can sign in; then setup is no longer needed', async () => {
    const t = createTestApp();

    const res = await postSetup(t);
    expect(res.status).toBe(201);
    const { user: admin } = (await res.json()) as { user: { id: string } };
    expect(admin).toEqual({
      id: expect.any(String) as unknown,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'admin',
    });
    expect(users(t)).toMatchObject([{ id: admin.id, role: 'admin', emailVerified: false }]);
    expect(claims(t)).toEqual([]);
    expect(await setupStatus(t)).toEqual({ needed: false });

    const signIn = await t.app.request(`${AUTH_BASE_PATH}/sign-in/email`, {
      method: 'POST',
      headers: { origin: t.publicUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
    });
    expect(signIn.status).toBe(200);
  });

  it('refuses a second setup once the first admin exists', async () => {
    const t = createTestApp();
    await postSetup(t);

    const again = await postSetup(t, { ...ADMIN, email: 'grace@example.com' });
    expect(again.status).toBe(409);
    expect(await problemDetail(again)).toBe('Setup is already complete. Sign in instead.');
    expect(users(t)).toHaveLength(1);
  });

  it('creates exactly one admin when two setups arrive at the same moment', async () => {
    const t = createTestApp();

    const responses = await Promise.all([
      postSetup(t),
      postSetup(t, { ...ADMIN, email: 'grace@example.com' }),
    ]);

    expect(responses.map((res) => res.status).toSorted()).toEqual([201, 409]);
    const refused = responses.find((res) => res.status === 409);
    expect(await problemDetail(refused ?? new Response())).toBe(
      'Setup is already in progress. Try again in a moment.',
    );
    expect(users(t)).toHaveLength(1);
    expect(claims(t)).toEqual([]);
  });

  it('releases the claim when creating the admin fails, so setup can be tried again', async () => {
    const t = createTestApp();
    vi.spyOn(t.auth.api, 'createUser').mockRejectedValueOnce(new Error('disk full'));

    expect((await postSetup(t)).status).toBe(500);
    expect(claims(t)).toEqual([]);

    expect((await postSetup(t)).status).toBe(201);
  });

  it('takes over a claim left behind by a crash, but not a recent one', async () => {
    const t = createTestApp();
    t.db
      .insert(setupClaim)
      .values({ id: 1, claimedAt: new Date(Date.now() - 60_000) })
      .run();

    expect((await postSetup(t)).status).toBe(409);

    t.db
      .update(setupClaim)
      .set({ claimedAt: new Date(Date.now() - STALE_CLAIM_MS - 1000) })
      .run();
    expect((await postSetup(t)).status).toBe(201);
  });

  it('never releases a claim that another setup has taken over in the meantime', async () => {
    const t = createTestApp();
    const takenOverAt = new Date(Date.now() + 60_000);
    // A setup that stalls past the stale limit: a second setup takes over its claim, then it fails.
    vi.spyOn(t.auth.api, 'createUser').mockImplementationOnce(() => {
      t.db.update(setupClaim).set({ claimedAt: takenOverAt }).run();
      return Promise.reject(new Error('stalled, then failed'));
    });

    expect((await postSetup(t)).status).toBe(500);
    expect(claims(t)).toEqual([{ id: 1, claimedAt: takenOverAt }]);
  });
});
