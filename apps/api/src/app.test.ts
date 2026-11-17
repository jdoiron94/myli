import { PROBLEM_CONTENT_TYPE } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './testing.ts';

describe('GET /healthz', () => {
  it('reports that the process is alive and is never cached', async () => {
    const res = await createTestApp().app.request('/healthz');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  const searchReady = (ready: boolean) => ({
    isReady: () => Promise.resolve(ready),
    client: undefined,
  });

  it('reports ready when the database and search both work, and is never cached', async () => {
    const res = await createTestApp({ search: searchReady(true) }).app.request('/readyz');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 when search is unavailable', async () => {
    const res = await createTestApp({ search: searchReady(false) }).app.request('/readyz');

    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'Not ready: search is unavailable.',
    });
  });

  it('answers 503 when the database is unavailable', async () => {
    const { app, db } = createTestApp({ search: searchReady(true) });
    db.$client.close();

    const res = await app.request('/readyz');

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ detail: 'Not ready: the database is unavailable.' });
  });

  it('names both when neither works', async () => {
    const { app, db } = createTestApp({ search: searchReady(false) });
    db.$client.close();

    const res = await app.request('/readyz');

    expect(await res.json()).toMatchObject({
      detail: 'Not ready: the database and search are unavailable.',
    });
  });
});
