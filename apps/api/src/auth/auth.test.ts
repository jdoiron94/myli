import { AUTH_BASE_PATH, problemDetailsSchema, type Role } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { user } from '../db/schema.ts';
import { createLogger } from '../logger.ts';
import { createTestApp, TEST_AUTH_ENV } from '../testing.ts';
import { createUserWithPassword } from './users.ts';

type TestApp = ReturnType<typeof createTestApp>;

const ADA = { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' };

/** A request as the browser would send it from the configured origin. */
function authRequest(
  { app }: TestApp,
  path: string,
  {
    method = 'POST',
    body,
    headers = {},
  }: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.request(`${AUTH_BASE_PATH}${path}`, {
    method,
    headers: {
      origin: TEST_AUTH_ENV.PUBLIC_URL,
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function signIn(t: TestApp, email: string, password: string, headers?: Record<string, string>) {
  return authRequest(t, '/sign-in/email', {
    body: { email, password },
    ...(headers && { headers }),
  });
}

/** The session cookie from a sign-in response, ready to send back in a `Cookie` header. */
function sessionCookie(res: Response) {
  const header = res.headers.getSetCookie().find((cookie) => cookie.includes('session_token='));
  if (!header) throw new Error('no session cookie was set');
  return { header, cookie: header.split(';')[0] ?? '' };
}

async function userWithRole(t: TestApp, role: Role) {
  return createUserWithPassword(t.auth, { ...ADA, role });
}

describe('Better Auth', () => {
  it('accepts the database schema', async () => {
    // Better Auth compares the Drizzle schema with what it expects on the first request, and
    // fails every request if they differ.
    const res = await authRequest(createTestApp(), '/ok', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('has public sign-up disabled', async () => {
    const t = createTestApp();
    const res = await authRequest(t, '/sign-up/email', { body: { ...ADA } });

    expect(res.status).toBe(400);
    expect(t.db.select().from(user).all()).toEqual([]);
  });
});

describe('createUserWithPassword', () => {
  it('creates a verified user with the given role, who can then sign in', async () => {
    const t = createTestApp();
    const created = await userWithRole(t, 'editor');
    expect(created).toMatchObject({ email: ADA.email, role: 'editor', emailVerified: true });

    const res = await signIn(t, ADA.email, ADA.password);
    expect(res.status).toBe(200);

    const session = await authRequest(t, '/get-session', {
      method: 'GET',
      headers: { cookie: sessionCookie(res).cookie },
    });
    expect(await session.json()).toMatchObject({ user: { id: created.id, role: 'editor' } });
  });

  it('rejects a role that does not exist', async () => {
    const t = createTestApp();
    await expect(userWithRole(t, 'owner' as Role)).rejects.toThrow();
    expect(t.db.select().from(user).all()).toEqual([]);
  });
});

describe('the user table', () => {
  it.each(['user', 'admin,editor', ''])('refuses role %j', (role) => {
    const { db } = createTestApp();
    expect(() =>
      db
        .insert(user)
        .values({ id: 'u1', name: 'Ada', email: ADA.email, role: role as Role })
        .run(),
    ).toThrow(/CHECK constraint failed: user_role_check/);
  });
});

describe('sign-in', () => {
  it('sets an HttpOnly, Secure, SameSite session cookie when PUBLIC_URL is https', async () => {
    const t = createTestApp();
    await userWithRole(t, 'viewer');

    const { header } = sessionCookie(await signIn(t, ADA.email, ADA.password));
    expect(header).toMatch(/^__Secure-myli\.session_token=/);
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; SameSite=Lax/i);
  });

  it('leaves Secure off when PUBLIC_URL is plain http, as in local development', async () => {
    const t = createTestApp({ env: { PUBLIC_URL: 'http://localhost:5173' } });
    await userWithRole(t, 'viewer');

    const res = await signIn(t, ADA.email, ADA.password, { origin: 'http://localhost:5173' });
    const { header } = sessionCookie(res);
    expect(header).toMatch(/^myli\.session_token=/);
    expect(header).not.toMatch(/; Secure/i);
  });

  it('answers a wrong password and an unknown email the same way, without a cookie', async () => {
    const t = createTestApp();
    await userWithRole(t, 'viewer');

    const wrongPassword = await signIn(t, ADA.email, 'not the password');
    const unknownEmail = await signIn(t, 'nobody@example.com', ADA.password);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    expect(wrongPassword.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a cross-site form submission, which could sign the victim in as someone else', async () => {
    const t = createTestApp();
    await userWithRole(t, 'viewer');

    const res = await signIn(t, ADA.email, ADA.password, {
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    });
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('cross-site requests carrying the session cookie (CSRF)', () => {
  it('are refused, even though Vitest sets NODE_ENV=test, and the log says why', async () => {
    const logs: Record<string, unknown>[] = [];
    const logger = createLogger('info', {
      write(line: string) {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    const t = createTestApp({ logger });
    await userWithRole(t, 'viewer');
    const { cookie } = sessionCookie(await signIn(t, ADA.email, ADA.password));

    const signOut = await authRequest(t, '/sign-out', {
      body: {},
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(signOut.status).toBe(403);
    expect(logs).toContainEqual(
      expect.objectContaining({ component: 'auth', msg: 'Invalid origin: https://evil.example' }),
    );

    const session = await authRequest(t, '/get-session', { method: 'GET', headers: { cookie } });
    expect(await session.json()).toMatchObject({ user: { email: ADA.email } });
  });
});

describe('admin plugin endpoints', () => {
  it('are not reachable over HTTP, even for an admin', async () => {
    const t = createTestApp();
    await userWithRole(t, 'admin');
    const { cookie } = sessionCookie(await signIn(t, ADA.email, ADA.password));

    const endpoints = Object.values(t.auth.api as Record<string, unknown>)
      .map((endpoint) => endpoint as { path?: string; options?: { method?: string | string[] } })
      .filter((endpoint) => endpoint.path?.startsWith('/admin/'));
    expect(endpoints.length).toBeGreaterThan(10);

    for (const { path = '', options } of endpoints) {
      const method = [options?.method ?? 'POST'].flat()[0] ?? 'POST';
      const res = await authRequest(t, path, {
        method,
        headers: { cookie },
        ...(method !== 'GET' && { body: { userId: 'someone', role: 'admin' } }),
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('unexpected errors', () => {
  it("become the app's generic 500 problem, with nothing internal in the response", async () => {
    const logs: Record<string, unknown>[] = [];
    const logger = createLogger('info', {
      write(line: string) {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      },
    });
    const t = createTestApp({ logger });
    await authRequest(t, '/ok', { method: 'GET' }); // let the schema check pass first
    t.db.$client.close();

    const res = await signIn(t, ADA.email, ADA.password);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = problemDetailsSchema.parse(await res.json());
    expect(JSON.stringify(body)).not.toMatch(/database|sqlite|connection/i);
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: 'request failed',
        status: 500,
        err: expect.any(Object) as unknown,
      }),
    );
  });
});
