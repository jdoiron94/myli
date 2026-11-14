import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';
import { createTestApp } from './testing.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An app whose log lines are collected in `logs` instead of written to stdout. */
function appWithCapturedLogs() {
  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('info', {
    write(line: string) {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  const { app } = createTestApp({ logger });
  app.get('/hello', (c) => {
    c.var.logger.info('hello from a handler');
    return c.text('hi');
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  return { app, logs };
}

describe('request IDs', () => {
  it('generates one when the request has none, and returns it', async () => {
    const { app } = appWithCapturedLogs();
    const res = await app.request('/hello');
    expect(res.headers.get('x-request-id')).toMatch(UUID);
  });

  it('reuses a well-formed incoming X-Request-Id', async () => {
    const { app } = appWithCapturedLogs();
    const res = await app.request('/hello', { headers: { 'X-Request-Id': 'caddy-abc_123=' } });
    expect(res.headers.get('x-request-id')).toBe('caddy-abc_123=');
  });

  it.each([
    ['unsafe characters', 'abc; drop table'],
    ['more than 255 characters', 'a'.repeat(256)],
  ])('replaces an incoming ID with %s', async (_, incoming) => {
    const { app, logs } = appWithCapturedLogs();
    const res = await app.request('/hello', { headers: { 'X-Request-Id': incoming } });
    expect(res.headers.get('x-request-id')).toMatch(UUID);
    expect(JSON.stringify(logs)).not.toContain(incoming);
  });
});

describe('request logging', () => {
  it('logs one line per request with method, path, status, duration and request ID', async () => {
    const { app, logs } = appWithCapturedLogs();
    const res = await app.request('/hello');

    const completed = logs.filter((line) => line.msg === 'request completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: 30,
      reqId: res.headers.get('x-request-id'),
      method: 'GET',
      path: '/hello',
      status: 200,
      durationMs: expect.any(Number) as unknown,
    });
  });

  it('tags lines logged inside handlers with the request ID', async () => {
    const { app, logs } = appWithCapturedLogs();
    const res = await app.request('/hello');
    expect(logs.find((line) => line.msg === 'hello from a handler')).toMatchObject({
      reqId: res.headers.get('x-request-id'),
    });
  });

  it('never logs the query string', async () => {
    const { app, logs } = appWithCapturedLogs();
    await app.request('/hello?token=super-secret-token');
    expect(logs.find((line) => line.msg === 'request completed')).toMatchObject({ path: '/hello' });
    expect(JSON.stringify(logs)).not.toContain('super-secret-token');
  });

  it('never logs headers such as cookies', async () => {
    const { app, logs } = appWithCapturedLogs();
    await app.request('/hello', { headers: { Cookie: 'session=super-secret-cookie' } });
    expect(JSON.stringify(logs)).not.toContain('super-secret-cookie');
  });

  it('logs client errors at info level', async () => {
    const { app, logs } = appWithCapturedLogs();
    await app.request('/missing');
    expect(logs.find((line) => line.msg === 'request completed')).toMatchObject({
      level: 30,
      status: 404,
    });
  });

  it('logs server errors at error level with the error and its stack', async () => {
    const { app, logs } = appWithCapturedLogs();
    await app.request('/boom');
    expect(logs.find((line) => line.msg === 'request failed')).toMatchObject({
      level: 50,
      status: 500,
      err: { message: 'boom', stack: expect.stringContaining('Error: boom') as unknown },
    });
  });

  it('skips /healthz, so the container healthcheck does not flood the logs', async () => {
    const { app, logs } = appWithCapturedLogs();
    await app.request('/healthz');
    expect(logs).toEqual([]);
  });
});
