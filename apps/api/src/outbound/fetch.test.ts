import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FetchOptions, FetchRefused, fetchPublic } from './fetch.ts';

/** Stands in for the public internet, on the loopback address, and counts what reaches it. */
let server: Server;
let origin: string;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    hits.push(path);
    if (path === '/recipe') {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(gzipSync('<h1>Bread</h1>'));
    } else if (path.startsWith('/to?')) {
      response.writeHead(302, { location: new URL(path, origin).searchParams.get('url') ?? '/' });
      response.end();
    } else if (path === '/loop') {
      response.writeHead(301, { location: '/loop' });
      response.end();
    } else if (path === '/bomb') {
      // Under a kilobyte gzipped, 640 KB once decompressed.
      response.writeHead(200, { 'content-encoding': 'gzip' });
      response.end(gzipSync(Buffer.alloc(640 * 1024)));
    } else if (path === '/slow') {
      response.writeHead(200);
      response.write('<html>');
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const page = { accept: 'text/html', maxBytes: 100 * 1024 };
/** The test server's address passes; every other address, the rest of the loopback range included, doesn't. */
const testServerOnly = (address: string) => address === '127.0.0.1';

/** Why each URL was refused, or `fetched` if it wasn't. */
async function reasons(urls: string[], options: FetchOptions = page) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        await fetchPublic(url, options);
        return [url, 'fetched'];
      } catch (error) {
        return [url, error instanceof FetchRefused ? error.reason : error];
      }
    }),
  );
  return Object.fromEntries(results) as Record<string, unknown>;
}

describe('fetchPublic', () => {
  it('fetches a page through its redirects, decompressed', async () => {
    const fetched = await fetchPublic(`${origin}/to?url=/recipe`, {
      ...page,
      isAllowed: testServerOnly,
    });
    expect([fetched.url.href, fetched.contentType, fetched.body.toString()]).toEqual([
      `${origin}/recipe`,
      'text/html',
      '<h1>Bread</h1>',
    ]);
  });

  it('never connects to an address that isn’t public, typed, resolved or redirected to', async () => {
    hits.length = 0;
    const port = new URL(origin).port;
    const typed = [`${origin}/recipe`, `http://[::1]:${port}/recipe`, `http://2130706433:${port}/`];
    const resolved = [`http://localhost:${port}/recipe`];
    const notHttp = ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/'];
    expect(await reasons([...typed, ...resolved, ...notHttp])).toEqual({
      [typed[0] ?? '']: 'address',
      [typed[1] ?? '']: 'address',
      // The URL parser reads a number as an IPv4 address: 127.0.0.1.
      [typed[2] ?? '']: 'address',
      [resolved[0] ?? '']: 'address',
      [notHttp[0] ?? '']: 'scheme',
      [notHttp[1] ?? '']: 'scheme',
      [notHttp[2] ?? '']: 'scheme',
    });
    expect(hits).toEqual([]);

    const redirected = [`http://127.0.0.2:${port}/recipe`, 'file:///etc/passwd'];
    expect(
      await reasons(
        redirected.map((url) => `${origin}/to?url=${encodeURIComponent(url)}`),
        { ...page, isAllowed: testServerOnly },
      ),
    ).toEqual({
      [`${origin}/to?url=${encodeURIComponent(redirected[0] ?? '')}`]: 'address',
      [`${origin}/to?url=${encodeURIComponent(redirected[1] ?? '')}`]: 'scheme',
    });
  });

  it('gives up past its limits: redirects, size once decompressed, time and status', async () => {
    const options = { ...page, isAllowed: testServerOnly, timeoutMs: 300 };
    expect(
      await reasons(
        ['/loop', '/bomb', '/slow', '/missing'].map((path) => `${origin}${path}`),
        options,
      ),
    ).toEqual({
      [`${origin}/loop`]: 'redirects',
      [`${origin}/bomb`]: 'too-large',
      [`${origin}/slow`]: 'timeout',
      [`${origin}/missing`]: 'status',
    });
  });
});
