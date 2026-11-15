// Caddy, in the web image (apps/web/Caddyfile). Only the run against the images has it: the dev
// servers' run skips this file (playwright.config.ts).
import { execFileSync } from 'node:child_process';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { WEB_IMAGE } from '../images.ts';
import { expect, test } from './fixtures.ts';

/** A response's Content Security Policy, as each directive's sources. */
function csp(response: APIResponse) {
  const header = response.headers()['content-security-policy'] ?? '';
  return new Map(
    header
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

/** The sources that would let injected code run: inline code, eval, and their relatives. */
const unsafeSources = (policy: Map<string, string[]>) =>
  [...policy.values()].flat().filter((source) => source.startsWith("'unsafe-"));

/** The address of a built file that the app's page loads. */
async function assetPath(request: APIRequestContext) {
  const page = await (await request.get('/')).text();
  const [path] = /\/assets\/app-[\w-]+\.js/.exec(page) ?? [];
  if (!path) throw new Error("The app's page loads no script from /assets");
  return path;
}

test('serves the app at any address, under a CSP that allows nothing inline and no eval', async ({
  request,
}) => {
  for (const path of ['/', '/admin/users', '/accept-invitation']) {
    const response = await request.get(path);

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<div id="app"></div>');
    const policy = csp(response);
    expect(unsafeSources(policy)).toEqual([]);
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
  }
});

test('serves the API docs page under its own CSP, which allows inline styles but no scripts', async ({
  request,
}) => {
  const redirect = await request.get('/api/docs?section=setup', { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe('/api/docs/?section=setup');

  const response = await request.get('/api/docs/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<title>API docs · myli</title>');
  const policy = csp(response);
  // Scalar adds styles as it runs (ADR 0012).
  expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  expect(unsafeSources(policy)).toEqual(["'unsafe-inline'"]);
  expect(policy.get('default-src')).toEqual(["'none'"]);
  expect(policy.get('script-src')).toEqual(["'self'"]);
  expect(policy.get('img-src')).toEqual(["'self'"]);
  expect(policy.get('font-src')).toEqual(["'self'"]);
  expect(policy.get('connect-src')).toEqual(["'self'"]);
  expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
});

test('sends the rest of /api to the API, with a CSP that allows nothing', async ({ request }) => {
  const setup = await request.get('/api/v1/setup');
  expect(setup.status()).toBe(200);
  // The journey may have finished setup already: it runs against the same containers.
  expect(await setup.json()).toEqual({ needed: expect.any(Boolean) });
  expect(csp(setup).get('default-src')).toEqual(["'none'"]);

  // Better Auth's routes, under /api/auth.
  const session = await request.get('/api/auth/get-session');
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
  expect(csp(session).get('default-src')).toEqual(["'none'"]);
});

test('lets browsers keep built files, and has them check pages on every load', async ({
  request,
}) => {
  const asset = await request.get(await assetPath(request));
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(asset.headers()['content-encoding']).toBe('gzip');

  const missing = await request.get('/assets/app-missing.js');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control']).toBeUndefined();

  for (const path of ['/', '/admin/users', '/theme.js', '/api/docs/']) {
    expect((await request.get(path)).headers()['cache-control']).toBe('no-cache');
  }
});

test('sets the security headers on every response, the API included', async ({ request }) => {
  for (const path of ['/', await assetPath(request), '/api/docs/', '/api/v1/setup']) {
    const headers = (await request.get(path)).headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['permissions-policy']).toContain('screen-wake-lock=(self)');
  }
});

test('runs as an unprivileged user', () => {
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

  expect(docker(['image', 'inspect', '--format', '{{.Config.User}}', WEB_IMAGE])).toBe('caddy');
  expect(docker(['run', '--rm', '--entrypoint', 'id', WEB_IMAGE, '-u'])).toBe('1000');
});
