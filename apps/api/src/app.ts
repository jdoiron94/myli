import { API_BASE_PATH, AUTH_BASE_PATH } from '@myli/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Auth } from './auth/auth.ts';
import { sessionMiddleware } from './auth/session.ts';
import type { AppEnv } from './context.ts';
import type { Logger } from './logger.ts';
import { onError, onNotFound } from './problems.ts';
import { requestLogging } from './request-logging.ts';
import { createV1Router } from './v1.ts';

export interface AppDeps {
  logger: Logger;
  auth: Auth;
}

/**
 * Builds the Hono app without starting a server, so tests can call `app.request()` directly.
 */
export function createApp({ logger, auth }: AppDeps) {
  const app = new Hono<AppEnv>();
  // Every error response is RFC 9457 application/problem+json.
  app.onError(onError);
  app.notFound(onNotFound);

  // Liveness only: answers as long as the process can serve HTTP. `/readyz` will check dependencies.
  // Registered before the middleware below, so the container healthcheck doesn't flood the logs.
  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  app.use(requestId());
  app.use(requestLogging(logger));

  // Better Auth answers its own routes, in its own format rather than problem details (ADR 0005).
  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));
  app.use(`${API_BASE_PATH}/*`, sessionMiddleware(auth));
  app.route(API_BASE_PATH, createV1Router());

  return app;
}
