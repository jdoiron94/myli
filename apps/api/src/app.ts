import { Hono } from 'hono';

/**
 * Builds the Hono app without starting a server, so tests can call `app.request()` directly.
 */
export function createApp() {
  const app = new Hono();

  // Liveness only: answers as long as the process can serve HTTP. `/readyz` will check dependencies.
  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  return app;
}
