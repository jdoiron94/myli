import { API_BASE_PATH, AUTH_BASE_PATH } from '@myli/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { auditSignIns, auditSignOuts } from './audit/auth-events.ts';
import type { Auth } from './auth/auth.ts';
import { sessionMiddleware } from './auth/session.ts';
import type { BlobStore } from './blobs/store.ts';
import { clientAddress, trustedProxies, withClientIp } from './client-ip.ts';
import type { AppEnv } from './context.ts';
import type { Db } from './db/database.ts';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';
import type { Outbound } from './outbound/fetch.ts';
import { onError, onNotFound, problemResponse } from './problems.ts';
import { requestLogging } from './request-logging.ts';
import type { SearchAccess } from './search/service.ts';
import { type AppSettings, createV1Router } from './v1.ts';

export interface AppDeps {
  logger: Logger;
  auth: Auth;
  db: Db;
  env: AppSettings & Pick<Env, 'TRUSTED_PROXIES'>;
  search: SearchAccess;
  blobs: BlobStore;
  outbound: Outbound;
}

/**
 * Builds the Hono app without starting a server, so tests can call `app.request()` directly.
 */
export function createApp({ logger, auth, db, env, search, blobs, outbound }: AppDeps) {
  const app = new Hono<AppEnv>();
  // Every error response is RFC 9457 application/problem+json.
  app.onError(onError);
  app.notFound(onNotFound);

  // Liveness only: answers as long as the process can serve HTTP. `/readyz` checks dependencies.
  // Both are registered before the middleware below, so polling them doesn't flood the logs.
  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok' });
  });

  // Readiness: whether the database and search work. Everything but search works without
  // Meilisearch (spec §4), so a 503 here means degraded, not down.
  app.get('/readyz', async (c) => {
    c.header('Cache-Control', 'no-store');
    const unavailable = [
      ...(databaseAnswers(db) ? [] : ['the database']),
      ...((await search.isReady()) ? [] : ['search']),
    ];
    if (unavailable.length === 0) return c.json({ status: 'ok' });
    const verb = unavailable.length > 1 ? 'are' : 'is';
    return problemResponse(c, 503, `Not ready: ${unavailable.join(' and ')} ${verb} unavailable.`);
  });

  app.use(requestId());
  app.use(requestLogging(logger));
  app.use(clientAddress(trustedProxies(env.TRUSTED_PROXIES)));

  // Better Auth answers its own routes, in its own format rather than problem details (ADR 0005).
  // Sign-ins and sign-outs pass through the audit log on the way.
  app.post(`${AUTH_BASE_PATH}/sign-in/email`, auditSignIns(db));
  app.post(`${AUTH_BASE_PATH}/sign-out`, auditSignOuts(db, auth));
  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) =>
    auth.handler(withClientIp(c.req.raw, c.var.clientIp)),
  );
  app.use(`${API_BASE_PATH}/*`, sessionMiddleware(auth));
  app.route(API_BASE_PATH, createV1Router({ db, auth, env, search, blobs, outbound }));

  return app;
}

function databaseAnswers(db: Db) {
  try {
    db.$client.prepare('select 1').get();
    return true;
  } catch {
    return false;
  }
}
