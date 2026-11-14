import { problemDetailsSchema } from '@myli/shared';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.ts';
import { HttpProblem } from './problems.ts';
import { createTestApp } from './testing.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function appWithFailingRoutes() {
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const { app } = createTestApp({ logger });
  app.get('/teapot', () => {
    throw new HttpProblem(418, 'This server only brews tea.');
  });
  app.get('/unauthorized', () => {
    throw new HTTPException(401, { message: 'Sign in first.' });
  });
  app.get('/http-500', () => {
    throw new HTTPException(500, { message: 'pool exhausted at db.internal:5432' });
  });
  app.get('/boom', () => {
    throw new Error('connection string postgres://admin:hunter2@db');
  });
  return { app, logs };
}

/** Requests `path` and returns the parsed problem, after checking it's a valid problem response. */
async function requestProblem(app: ReturnType<typeof appWithFailingRoutes>['app'], path: string) {
  const res = await app.request(path);
  const text = await res.text();
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  const body: unknown = JSON.parse(text);
  expect(problemDetailsSchema.strict().safeParse(body).success).toBe(true);
  return { res, text, body };
}

describe('problem responses', () => {
  it('answers unknown routes with 404', async () => {
    const { app } = appWithFailingRoutes();
    const { res, body } = await requestProblem(app, '/no-such-route');
    expect(res.status).toBe(404);
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('turns an HttpProblem into its status, with its detail', async () => {
    const { app } = appWithFailingRoutes();
    const { res, body } = await requestProblem(app, '/teapot');
    expect(res.status).toBe(418);
    expect(body).toMatchObject({
      type: 'about:blank',
      title: "I'm a Teapot",
      status: 418,
      detail: 'This server only brews tea.',
    });
  });

  it("maps Hono's HTTPException, keeping a 4xx message as the detail", async () => {
    const { app } = appWithFailingRoutes();
    const { res, body } = await requestProblem(app, '/unauthorized');
    expect(res.status).toBe(401);
    expect(body).toMatchObject({ title: 'Unauthorized', status: 401, detail: 'Sign in first.' });
  });

  it('drops the message of a 5xx HTTPException', async () => {
    const { app } = appWithFailingRoutes();
    const { res, body, text } = await requestProblem(app, '/http-500');
    expect(res.status).toBe(500);
    expect(body).not.toHaveProperty('detail');
    expect(text).not.toContain('db.internal');
  });

  it('answers an unexpected error with a generic 500 that leaks nothing', async () => {
    const { app } = appWithFailingRoutes();
    const { res, body, text } = await requestProblem(app, '/boom');
    expect(res.status).toBe(500);
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      requestId: res.headers.get('x-request-id'),
    });
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('at ');
  });

  it('logs an unexpected error exactly once, through pino, under the same request ID', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, logs } = appWithFailingRoutes();
    const res = await app.request('/boom');

    const errorLines = logs.filter((line) => line.level === 50);
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]).toMatchObject({
      reqId: res.headers.get('x-request-id'),
      err: { message: 'connection string postgres://admin:hunter2@db' },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
