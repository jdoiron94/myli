import { BlockList, isIP } from 'node:net';
import type { HttpBindings } from '@hono/node-server';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './context.ts';

/** One `TRUSTED_PROXIES` entry: an address, or a range in CIDR notation. */
export interface ProxyRange {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** IPv4 clients of a dual-stack socket show up as IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`). */
export function unmapIpv4(address: string): string {
  const mapped = /^::ffff:(.+)$/i.exec(address)?.[1];
  return mapped !== undefined && isIP(mapped) === 4 ? mapped : address;
}

/** Parses `172.18.0.2`, `172.18.0.0/16` or `fd00::/8`. Anything else is `null`. */
export function parseProxyRange(entry: string): ProxyRange | null {
  const [address = '', prefixText, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || rest.length > 0) return null;
  const maxPrefix = version === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = prefixText === undefined ? maxPrefix : Number(prefixText);
  if (prefix > maxPrefix) return null;
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}

/** Whether an address belongs to one of the trusted proxies. */
export type IsTrustedProxy = (address: string) => boolean;

export function trustedProxies(ranges: readonly ProxyRange[]): IsTrustedProxy {
  const list = new BlockList();
  for (const { address, prefix, family } of ranges) list.addSubnet(address, prefix, family);
  return (address) => {
    const version = isIP(address);
    return version !== 0 && list.check(address, version === 4 ? 'ipv4' : 'ipv6');
  };
}

/**
 * The client's address. It's the connection's own, unless the connection comes from a trusted
 * proxy. Then it's the rightmost address in `X-Forwarded-For` that isn't a trusted proxy: each
 * proxy appends the address the request came to it from, and anything further left could have
 * been written by the client itself.
 */
export function resolveClientIp(
  peer: string | undefined,
  forwardedFor: string | undefined,
  isTrusted: IsTrustedProxy,
): string | null {
  if (peer === undefined) return null;
  const connection = unmapIpv4(peer);
  if (forwardedFor === undefined || !isTrusted(connection)) return connection;

  const hops = forwardedFor.split(',').map((hop) => unmapIpv4(hop.trim()));
  for (const hop of hops.toReversed()) {
    // Something no proxy writes: believe nothing to its left. The connection is still known.
    if (isIP(hop) === 0) return connection;
    if (!isTrusted(hop)) return hop;
  }
  // Every hop was a trusted proxy, so the leftmost one sent the request itself.
  return hops[0] ?? connection;
}

/**
 * Works out the client's address once per request, as `c.var.clientIp`. The audit log records it,
 * and Better Auth gets it through `withClientIp()`.
 */
export function clientAddress(isTrusted: IsTrustedProxy) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Set by @hono/node-server. Requests made with `app.request()` in tests have no socket, unless
    // the test passes one.
    const bindings = c.env as Partial<HttpBindings> | undefined;
    const peer = bindings?.incoming?.socket.remoteAddress;
    c.set('clientIp', resolveClientIp(peer, c.req.header('x-forwarded-for'), isTrusted));
    await next();
  });
}

/**
 * `request` as Better Auth should see it, with `X-Forwarded-For` set to exactly the client's
 * address, or removed. Better Auth reads that header for the IP it stores on sessions and
 * rate-limits by, and can't tell who sent it.
 */
export function withClientIp(request: Request, ip: string | null): Request {
  const headers = new Headers(request.headers);
  if (ip === null) headers.delete('x-forwarded-for');
  else headers.set('x-forwarded-for', ip);
  return new Request(request, { headers });
}
