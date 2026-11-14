import { PROBLEM_CONTENT_TYPE } from '@myli/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from './context.ts';
import { JSON_ONLY_DETAIL, jsonOnly } from './json-only.ts';
import { onError } from './problems.ts';
import { createTestApp } from './testing.ts';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** One route answering 204 to every method, behind the middleware. */
function appWithEveryMethod() {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use(jsonOnly());
  app.on(['GET', 'HEAD', 'OPTIONS', ...WRITE_METHODS], '/thing', (c) => c.body(null, 204));
  return app;
}

/** A request with this content type, and a body whenever there is a content type to describe. */
function send(method: string, contentType?: string) {
  return appWithEveryMethod().request('/thing', {
    method,
    ...(contentType !== undefined && { headers: { 'content-type': contentType }, body: '{}' }),
  });
}

describe('jsonOnly', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through without a content type', async (method) => {
    expect((await send(method)).status).toBe(204);
  });

  // What a page on another origin can send with the user's cookie and no CORS preflight: an HTML
  // form's three encodings, or a no-CORS fetch or sendBeacon without a body. Plus near misses.
  it.each(
    WRITE_METHODS.flatMap((method) =>
      [
        undefined,
        'text/plain',
        'text/plain;charset=UTF-8',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        'application/jsonx',
        'text/json',
        'application/problem+json',
      ].map((contentType) => [method, contentType] as const),
    ),
  )('refuses %s with content type %s', async (method, contentType) => {
    const res = await send(method, contentType);

    expect(res.status).toBe(415);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toMatchObject({ status: 415, detail: JSON_ONLY_DETAIL });
  });

  it.each(
    WRITE_METHODS.flatMap((method) =>
      ['application/json', 'Application/JSON; charset=utf-8'].map(
        (contentType) => [method, contentType] as const,
      ),
    ),
  )('lets %s with %s through', async (method, contentType) => {
    expect((await send(method, contentType)).status).toBe(204);
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
