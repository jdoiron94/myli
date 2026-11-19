import { PROBLEM_CONTENT_TYPE } from '@myli/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from './context.ts';
import { JSON_ONLY_DETAIL, jsonOnly } from './json-only.ts';
import { onError } from './problems.ts';
import { createTestApp } from './testing.ts';

/** Each request's status, keyed by its method, path and content type. */
async function statuses(
  app: Hono<AppEnv>,
  requests: [method: string, path: string, type?: string][],
) {
  return Object.fromEntries(
    await Promise.all(
      requests.map(async ([method, path, contentType]) => {
        const res = await app.request(path, {
          method,
          ...(contentType !== undefined && {
            headers: { 'content-type': contentType },
            body: '{}',
          }),
        });
        return [`${method} ${path} ${contentType ?? '(none)'}`, res.status] as const;
      }),
    ),
  );
}

describe('jsonOnly', () => {
  // What a page on another origin can send with the user's cookie and no CORS preflight: an HTML
  // form's three encodings, or a no-CORS fetch or sendBeacon without a body. Plus near misses.
  it('lets reads through, and writes only as JSON, refusing with a problem', async () => {
    const app = new Hono<AppEnv>();
    app.onError(onError);
    app.use(jsonOnly());
    app.on(['GET', 'HEAD', 'OPTIONS', 'POST', 'DELETE'], '/thing', (c) => c.body(null, 204));
    const requests: [string, string, string?][] = [
      ['GET', '/thing'],
      ['HEAD', '/thing'],
      ['OPTIONS', '/thing'],
      ['POST', '/thing', 'application/json'],
      ['POST', '/thing', 'Application/JSON; charset=utf-8'],
      ['DELETE', '/thing', 'application/json'],
      ['POST', '/thing'],
      ['DELETE', '/thing'],
      ['POST', '/thing', 'text/plain;charset=UTF-8'],
      ['POST', '/thing', 'application/x-www-form-urlencoded'],
      ['POST', '/thing', 'multipart/form-data; boundary=x'],
      ['POST', '/thing', 'application/jsonx'],
      ['POST', '/thing', 'text/json'],
      ['POST', '/thing', 'application/problem+json'],
    ];

    expect(await statuses(app, requests)).toEqual({
      'GET /thing (none)': 204,
      'HEAD /thing (none)': 204,
      'OPTIONS /thing (none)': 204,
      'POST /thing application/json': 204,
      'POST /thing Application/JSON; charset=utf-8': 204,
      'DELETE /thing application/json': 204,
      'POST /thing (none)': 415,
      'DELETE /thing (none)': 415,
      'POST /thing text/plain;charset=UTF-8': 415,
      'POST /thing application/x-www-form-urlencoded': 415,
      'POST /thing multipart/form-data; boundary=x': 415,
      'POST /thing application/jsonx': 415,
      'POST /thing text/json': 415,
      'POST /thing application/problem+json': 415,
    });
    const refused = await app.request('/thing', { method: 'POST' });
    expect(refused.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await refused.json()).toMatchObject({ status: 415, detail: JSON_ONLY_DETAIL });
  });

  it('lets JPEG, PNG and WebP through only as an upload of an image', async () => {
    const app = new Hono<AppEnv>();
    app.onError(onError);
    app.use(jsonOnly());
    app.on(['POST', 'PUT'], ['/api/v1/images', '/api/v1/images/x', '/api/v1/recipes'], (c) =>
      c.body(null, 204),
    );
    const requests: [string, string, string?][] = [
      ['POST', '/api/v1/images', 'image/jpeg'],
      ['POST', '/api/v1/images', 'image/png'],
      ['POST', '/api/v1/images', 'Image/WebP; charset=binary'],
      ['POST', '/api/v1/images', 'image/gif'],
      ['POST', '/api/v1/images', 'image/svg+xml'],
      ['POST', '/api/v1/images', 'multipart/form-data; boundary=x'],
      ['PUT', '/api/v1/images', 'image/jpeg'],
      ['POST', '/api/v1/images/x', 'image/jpeg'],
      ['POST', '/api/v1/recipes', 'image/jpeg'],
    ];

    expect(await statuses(app, requests)).toEqual({
      'POST /api/v1/images image/jpeg': 204,
      'POST /api/v1/images image/png': 204,
      'POST /api/v1/images Image/WebP; charset=binary': 204,
      'POST /api/v1/images image/gif': 415,
      'POST /api/v1/images image/svg+xml': 415,
      'POST /api/v1/images multipart/form-data; boundary=x': 415,
      'PUT /api/v1/images image/jpeg': 415,
      'POST /api/v1/images/x image/jpeg': 415,
      'POST /api/v1/recipes image/jpeg': 415,
    });
  });

  it('guards every route under the versioned API', async () => {
    const t = createTestApp();

    const res = await t.app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({
        name: 'First Admin',
        email: 'first-admin@example.com',
        password: 'A first-admin password 1',
      }),
    });

    expect(res.status).toBe(415);
    expect(await (await t.app.request('/api/v1/setup')).json()).toEqual({ needed: true });
  });
});
