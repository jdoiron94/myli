import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('GET /healthz', () => {
  it('reports that the process is alive and is never cached', async () => {
    const res = await createApp().request('/healthz');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
