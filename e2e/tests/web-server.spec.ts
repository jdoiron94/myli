// Caddy, in the web image (apps/web/Caddyfile). Only the run against the images has it: the dev
// servers' run skips this file (playwright.config.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { connect, type PeerCertificate } from 'node:tls';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { redirectPortFor, WEB_IMAGE } from '../images.ts';
import { expect, test } from './fixtures.ts';

/** The project's address, which Playwright types as optional. */
function origin(baseURL: string | undefined) {
  if (!baseURL) throw new Error('The project has no baseURL');
  return new URL(baseURL);
}

/** The certificate the web server presents, and the protocol it picks when offered HTTP/2 first. */
function handshake(url: URL) {
  return new Promise<{ certificate: PeerCertificate; protocol: string | false | null }>(
    (resolve, reject) => {
      const socket = connect(
        {
          host: url.hostname,
          port: Number(url.port),
          servername: url.hostname,
          ALPNProtocols: ['h2', 'http/1.1'],
          // The test run's CA is new each time; this test checks who issued the certificate.
          rejectUnauthorized: false,
        },
        () => {
          resolve({ certificate: socket.getPeerCertificate(), protocol: socket.alpnProtocol });
          socket.end();
        },
      );
      socket.on('error', reject);
    },
  );
}

/** Runs the docker CLI, returning its output. Its warnings are kept out of the test's output. */
const docker = (args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

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
    expect(policy.get('upgrade-insecure-requests')).toEqual([]);
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
  expect(policy.get('upgrade-insecure-requests')).toEqual([]);
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

test('serves HTTPS and HTTP/2, with a certificate from its own local CA', async ({ baseURL }) => {
  const { certificate, protocol } = await handshake(origin(baseURL));

  expect(certificate.issuer.CN).toBe('Caddy Local Authority - ECC Intermediate');
  expect(certificate.subjectaltname).toBe('DNS:localhost');
  expect(protocol).toBe('h2');
});

test('redirects HTTP to HTTPS, keeping the path and query', async ({ request, baseURL }) => {
  const https = origin(baseURL);
  const http = `http://localhost:${String(redirectPortFor(https.href))}`;

  const response = await request.get(`${http}/admin/users?tab=roles`, { maxRedirects: 0 });

  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe(`${https.origin}/admin/users?tab=roles`);
  // HSTS means nothing over HTTP, where anyone could have added it.
  expect(response.headers()['strict-transport-security']).toBeUndefined();
});

test('sets the security headers on every response, the API included', async ({
  request,
  baseURL,
}) => {
  for (const path of ['/', await assetPath(request), '/api/docs/', '/api/v1/setup']) {
    const headers = (await request.get(path)).headers();

    expect(headers['strict-transport-security']).toBe('max-age=31536000');
    // HTTP/3, on the same port over UDP.
    expect(headers['alt-svc']).toContain(`h3=":${origin(baseURL).port}"`);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['permissions-policy']).toContain('screen-wake-lock=(self)');
  }
});

test.describe('the image', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'No browser involved: runs once.');

  /**
   * `docker run` of the web image, without a network: none of these checks needs one. A container
   * on Docker's default bridge changes the host's network as it starts and stops, which makes
   * Chromium abort the requests other tests have in flight (net::ERR_NETWORK_CHANGED).
   */
  const RUN = ['run', '--rm', '--network', 'none'];

  test('runs as an unprivileged user', () => {
    expect(docker(['image', 'inspect', '--format', '{{.Config.User}}', WEB_IMAGE])).toBe('caddy');
    expect(docker([...RUN, '--entrypoint', 'id', WEB_IMAGE, '-u'])).toBe('1000');
  });

  test('holds no certificate authority: each installation creates its own on first start', () => {
    // As root, so no directory is out of reach.
    const find = (...args: string[]) =>
      docker([...RUN, '--user', 'root', '--entrypoint', 'find', WEB_IMAGE, ...args]);

    // The base image's empty caddy directories are there, and nothing else.
    expect(find('/data', '/config', '-type', 'f')).toBe('');
    expect(find('/', '-xdev', '-name', '*.key')).toBe('');
  });

  test('starts only with an https origin in PUBLIC_URL, and says what is wrong', () => {
    /** Runs the image's check of PUBLIC_URL, with `true` in place of Caddy, so it never waits. */
    const check = (publicUrl: string | undefined) => {
      const env = publicUrl === undefined ? [] : ['-e', `PUBLIC_URL=${publicUrl}`];
      return spawnSync('docker', [...RUN, ...env, WEB_IMAGE, 'true'], {
        encoding: 'utf8',
        timeout: 20_000,
      });
    };

    for (const publicUrl of [
      'https://myli.example',
      'https://myli.example/',
      'https://10.0.0.5:8443',
    ]) {
      expect(check(publicUrl).status, publicUrl).toBe(0);
    }
    const problems = [
      [undefined, 'is not set'],
      ['', 'is not set'],
      ['http://myli.example', 'must start with https://'],
      ['myli.example', 'must start with https://'],
      ['https://', 'must start with https://'],
      ['https://myli.example/myli', 'must be an origin only, without a path'],
      ['https://myli.example?x=1', 'must be an origin only, without a path'],
    ] as const;
    for (const [publicUrl, problem] of problems) {
      const run = check(publicUrl);

      expect(run.status, String(publicUrl)).toBe(1);
      expect(run.stderr, String(publicUrl)).toContain(`PUBLIC_URL ${problem}.`);
    }
  });

  test('serves the whole site at PUBLIC_URL, slash or not, with its local CA, writing only to /data', () => {
    interface CaddyConfig {
      admin: unknown;
      apps: {
        http: { servers: Record<string, { listen: string[]; routes: { match?: unknown }[] }> };
        tls: unknown;
        pki: unknown;
      };
    }
    for (const publicUrl of ['https://myli.example', 'https://myli.example/']) {
      // The configuration Caddy would run, without running it.
      const adapt = [
        'caddy',
        'adapt',
        '--config',
        '/etc/caddy/Caddyfile',
        '--adapter',
        'caddyfile',
      ];
      const config = JSON.parse(
        docker([...RUN, '-e', `PUBLIC_URL=${publicUrl}`, WEB_IMAGE, ...adapt]),
      ) as CaddyConfig;
      const site = Object.values(config.apps.http.servers).find(({ listen }) =>
        listen.includes(':443'),
      );

      // A path here would limit the site to it.
      expect(site?.routes.map(({ match }) => match)).toEqual([[{ host: ['myli.example'] }]]);
      // The local CA even for a public name, where Caddy would otherwise ask Let's Encrypt. Its
      // root isn't added to the container's trust store.
      expect(config.apps.tls).toEqual({
        automation: {
          policies: [{ subjects: ['myli.example'], issuers: [{ module: 'internal' }] }],
        },
      });
      expect(config.apps.pki).toEqual({
        certificate_authorities: { local: { install_trust: false } },
      });
      // No admin endpoint, and no copy of the configuration saved in /config, so the container can
      // be read-only (compose.yaml).
      expect(config.admin).toEqual({ disabled: true, config: { persist: false } });
    }
  });
});
