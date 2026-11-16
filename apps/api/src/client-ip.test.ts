import { AUTH_BASE_PATH } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createUserWithPassword } from './auth/users.ts';
import {
  parseProxyRange,
  resolveClientIp,
  trustedProxies,
  unmapIpv4,
  withClientIp,
} from './client-ip.ts';
import { auditEvent, session } from './db/schema.ts';
import { envSchema } from './env.ts';
import { cookieHeaderFrom, createTestApp, type TestApp } from './testing.ts';

/** `trustedProxies` for `TRUSTED_PROXIES` entries, parsed as the env parses them. */
function trusting(...entries: string[]) {
  return trustedProxies(envSchema.shape.TRUSTED_PROXIES.parse(entries.join(',')));
}

describe('parseProxyRange', () => {
  it.each([
    ['172.18.0.2', { address: '172.18.0.2', prefix: 32, family: 'ipv4' }],
    ['172.18.0.0/16', { address: '172.18.0.0', prefix: 16, family: 'ipv4' }],
    ['0.0.0.0/0', { address: '0.0.0.0', prefix: 0, family: 'ipv4' }],
    ['fd00::/8', { address: 'fd00::', prefix: 8, family: 'ipv6' }],
    ['::1', { address: '::1', prefix: 128, family: 'ipv6' }],
  ])('reads %s', (entry, range) => {
    expect(parseProxyRange(entry)).toEqual(range);
  });

  it.each([
    'caddy',
    '',
    '172.18.0',
    '172.18.0.0/33',
    '::/129',
    '172.18.0.0/',
    '172.18.0.0/-1',
    '172.18.0.0/1e1',
    '172.18.0.0/16/16',
    '172.18.0.0/ 16',
    '[::1]',
  ])('refuses %j', (entry) => {
    expect(parseProxyRange(entry)).toBeNull();
  });
});

describe('unmapIpv4', () => {
  it.each([
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    // The IPv6 spelling of a mapped address isn't produced by Node's sockets; left as it is.
    ['::ffff:cb00:7107', '::ffff:cb00:7107'],
  ])('%s is %s', (address, unmapped) => {
    expect(unmapIpv4(address)).toBe(unmapped);
  });
});

describe('trustedProxies', () => {
  it('matches addresses and ranges of either family, mapped IPv4 included', () => {
    const isTrusted = trusting('172.18.0.0/16', '10.1.2.3', 'fd00::/8');

    expect(isTrusted('172.18.200.9')).toBe(true);
    expect(isTrusted('10.1.2.3')).toBe(true);
    expect(isTrusted('fd12::5')).toBe(true);
    expect(isTrusted('172.19.0.1')).toBe(false);
    expect(isTrusted('10.1.2.4')).toBe(false);
    expect(isTrusted('fe80::1')).toBe(false);
    expect(isTrusted('not an address')).toBe(false);
  });

  it('trusts no one by default', () => {
    const isTrusted = trustedProxies([]);

    expect(isTrusted('127.0.0.1')).toBe(false);
    expect(isTrusted('::1')).toBe(false);
  });
});

describe('resolveClientIp', () => {
  const caddy = '172.18.0.2';
  const isTrusted = trusting('172.18.0.0/16');

  it("is the connection's address when nothing is forwarded", () => {
    expect(resolveClientIp('198.51.100.7', undefined, isTrusted)).toBe('198.51.100.7');
    expect(resolveClientIp('::ffff:198.51.100.7', undefined, isTrusted)).toBe('198.51.100.7');
    expect(resolveClientIp(caddy, undefined, isTrusted)).toBe(caddy);
  });

  it('is unknown without a connection, as in tests', () => {
    expect(resolveClientIp(undefined, '203.0.113.9', isTrusted)).toBeNull();
  });

  it('ignores X-Forwarded-For from a connection that is not a trusted proxy', () => {
    expect(resolveClientIp('198.51.100.7', '203.0.113.9', isTrusted)).toBe('198.51.100.7');
    expect(resolveClientIp('198.51.100.7', '203.0.113.9', trustedProxies([]))).toBe('198.51.100.7');
    // The same proxy address is trusted only when it's listed.
    expect(resolveClientIp(caddy, '203.0.113.9', trustedProxies([]))).toBe(caddy);
  });

  it('believes a trusted proxy, unmapping the address it forwards', () => {
    expect(resolveClientIp(caddy, '203.0.113.9', isTrusted)).toBe('203.0.113.9');
    expect(resolveClientIp(`::ffff:${caddy}`, '::ffff:203.0.113.9', isTrusted)).toBe('203.0.113.9');
    expect(resolveClientIp(caddy, '2001:db8::1', isTrusted)).toBe('2001:db8::1');
  });

  it('takes the rightmost address that is not a trusted proxy, so a client can only add on the left', () => {
    // The client sent "X-Forwarded-For: 1.2.3.4", and a proxy that appends added its address.
    expect(resolveClientIp(caddy, '1.2.3.4, 203.0.113.9', isTrusted)).toBe('203.0.113.9');
    // Two trusted proxies in a row.
    expect(resolveClientIp(caddy, '1.2.3.4,203.0.113.9 , 172.18.0.3', isTrusted)).toBe(
      '203.0.113.9',
    );
  });

  it('is the leftmost hop when every hop is a trusted proxy', () => {
    expect(resolveClientIp(caddy, '172.18.0.9, 172.18.0.3', isTrusted)).toBe('172.18.0.9');
  });

  it("falls back to the connection's address at anything that isn't an address", () => {
    for (const forwarded of [
      '',
      'unknown',
      '1.2.3.4, garbage',
      '203.0.113.9:443',
      '[2001:db8::1]',
    ]) {
      expect(resolveClientIp(caddy, forwarded, isTrusted)).toBe(caddy);
    }
    // Something unreadable to the left of the client's address doesn't matter.
    expect(resolveClientIp(caddy, 'garbage, 203.0.113.9', isTrusted)).toBe('203.0.113.9');
  });
});

describe('withClientIp', () => {
  const request = () =>
    new Request('https://myli.test/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'content-type': 'application/json' },
      body: '{"email":"ada@example.com"}',
    });

  it('replaces X-Forwarded-For with the client address, keeping everything else', async () => {
    const rewritten = withClientIp(request(), '203.0.113.9');

    expect(rewritten.headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(rewritten.headers.get('content-type')).toBe('application/json');
    expect(rewritten.method).toBe('POST');
    expect(rewritten.url).toBe('https://myli.test/api/auth/sign-in/email');
    expect(await rewritten.text()).toBe('{"email":"ada@example.com"}');
  });

  it('removes X-Forwarded-For when the address is unknown', () => {
    expect(withClientIp(request(), null).headers.has('x-forwarded-for')).toBe(false);
  });
});

describe('over HTTP', () => {
  const CADDY = '172.18.0.2';
  const PASSWORD = 'A test password, long enough 1';

  function appBehind(trusted: string, options: { NODE_ENV?: 'production' } = {}) {
    return createTestApp({
      env: { TRUSTED_PROXIES: envSchema.shape.TRUSTED_PROXIES.parse(trusted), ...options },
    });
  }

  interface From {
    /** The TCP peer's address, as @hono/node-server reports it; none if undefined. */
    peer?: string;
    forwardedFor?: string;
    cookie?: string;
  }

  function send(t: TestApp, path: string, body: unknown, from: From) {
    return t.app.request(
      path,
      {
        method: 'POST',
        headers: {
          origin: t.publicUrl,
          'content-type': 'application/json',
          ...(from.forwardedFor !== undefined && { 'x-forwarded-for': from.forwardedFor }),
          ...(from.cookie !== undefined && { cookie: from.cookie }),
        },
        body: JSON.stringify(body),
      },
      from.peer === undefined ? undefined : { incoming: { socket: { remoteAddress: from.peer } } },
    );
  }

  const signIn = (t: TestApp, email: string, password: string, from: From) =>
    send(t, `${AUTH_BASE_PATH}/sign-in/email`, { email, password }, from);

  async function adminOf(t: TestApp) {
    const email = 'ada@example.com';
    const admin = await createUserWithPassword(t.auth, {
      name: 'Ada',
      email,
      password: PASSWORD,
      role: 'admin',
    });
    return { email, id: admin.id };
  }

  const ips = (t: TestApp) =>
    t.db.select({ action: auditEvent.action, ip: auditEvent.ip }).from(auditEvent).all();
  const sessionIps = (t: TestApp, userId: string) =>
    t.db
      .select({ ip: session.ipAddress })
      .from(session)
      .where(eq(session.userId, userId))
      .all()
      .map(({ ip }) => ip);

  it("records the forwarded client, not the proxy, in the audit log and on the client's session", async () => {
    const t = appBehind('172.18.0.0/16');
    const admin = await adminOf(t);

    await signIn(t, admin.email, 'wrong password', { peer: CADDY, forwardedFor: '203.0.113.9' });
    const res = await signIn(t, admin.email, PASSWORD, {
      peer: `::ffff:${CADDY}`,
      forwardedFor: '1.2.3.4, 203.0.113.10',
    });
    expect(res.status).toBe(200);
    const invited = await send(
      t,
      '/api/v1/invitations',
      { email: 'grace@example.com', role: 'viewer' },
      { peer: CADDY, forwardedFor: '203.0.113.11', cookie: cookieHeaderFrom(res) },
    );
    expect(invited.status).toBe(201);

    expect(ips(t)).toEqual([
      { action: 'sign_in.failed', ip: '203.0.113.9' },
      { action: 'sign_in.succeeded', ip: '203.0.113.10' },
      { action: 'invitation.created', ip: '203.0.113.11' },
    ]);
    expect(sessionIps(t, admin.id)).toEqual(['203.0.113.10']);
  });

  it("doesn't let a client that reaches the API directly choose its address", async () => {
    const t = appBehind('172.18.0.0/16');
    const admin = await adminOf(t);

    await signIn(t, admin.email, 'wrong password', {
      peer: '198.51.100.7',
      forwardedFor: '203.0.113.9',
    });
    await signIn(t, admin.email, PASSWORD, { peer: '198.51.100.7', forwardedFor: '203.0.113.9' });
    // Without a connection (as here, in tests) the address is unknown, and Better Auth doesn't see
    // the client's header either: it falls back to the loopback address it uses in tests.
    await signIn(t, admin.email, PASSWORD, { forwardedFor: '203.0.113.9' });

    expect(ips(t)).toEqual([
      { action: 'sign_in.failed', ip: '198.51.100.7' },
      { action: 'sign_in.succeeded', ip: '198.51.100.7' },
      { action: 'sign_in.succeeded', ip: null },
    ]);
    expect(sessionIps(t, admin.id).sort()).toEqual(['127.0.0.1', '198.51.100.7']);
  });

  it('trusts no proxy unless TRUSTED_PROXIES lists it', async () => {
    const t = appBehind('');
    const admin = await adminOf(t);

    await signIn(t, admin.email, PASSWORD, { peer: CADDY, forwardedFor: '203.0.113.9' });

    expect(ips(t)).toEqual([{ action: 'sign_in.succeeded', ip: CADDY }]);
    expect(sessionIps(t, admin.id)).toEqual([CADDY]);
  });

  describe("Better Auth's rate limiting", () => {
    /** Failed sign-ins until one is refused for its rate; the attempts it took, or null. */
    async function attemptsUntilLimited(
      t: TestApp,
      email: string,
      from: (attempt: number) => From,
    ) {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const res = await signIn(t, email, 'wrong password', from(attempt));
        if (res.status === 429) return attempt;
        expect(res.status).toBe(401);
      }
      return null;
    }

    it("can't be dodged by sending a different X-Forwarded-For each time", async () => {
      const t = appBehind('172.18.0.0/16', { NODE_ENV: 'production' });
      const admin = await adminOf(t);

      const attempts = await attemptsUntilLimited(t, admin.email, (attempt) => ({
        peer: '198.51.100.7',
        forwardedFor: `203.0.113.${String(attempt)}`,
      }));

      expect(attempts).toBe(4);
    });

    it('limits each client behind a trusted proxy on its own', async () => {
      const t = appBehind('172.18.0.0/16', { NODE_ENV: 'production' });
      const admin = await adminOf(t);
      const behindCaddy = (forwardedFor: string) => () => ({ peer: CADDY, forwardedFor });

      expect(await attemptsUntilLimited(t, admin.email, behindCaddy('203.0.113.20'))).toBe(4);
      expect(await attemptsUntilLimited(t, admin.email, behindCaddy('203.0.113.21'))).toBe(4);
    });
  });
});
