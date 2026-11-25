import { API_BASE_PATH } from '@myli/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context.ts';
import type { Logger } from './logger.ts';

/** Where a public link's token is in a path, which is a secret: anyone with it can open the link. */
const PUBLIC_TOKEN = new RegExp(`^(${API_BASE_PATH}/public/recipes/)[^/]+`);

/** A request's path as it's logged: with a public link's token, its name in its place (ADR 0016). */
const loggedPath = (path: string) => path.replace(PUBLIC_TOKEN, '$1{token}');

/**
 * Gives each request a child logger tagged with its request ID, and logs one line when it completes.
 * Runs after Hono's `requestId` middleware, which validates or generates the ID.
 */
export function requestLogging(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    const log = logger.child({ reqId: c.var.requestId });
    c.set('logger', log);

    await next();

    // Path only, never the query string, which can carry tokens, and a public link's token taken
    // out. Headers aren't logged at all, so cookies and Authorization stay out of the logs.
    const line = {
      method: c.req.method,
      path: loggedPath(c.req.path),
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    };
    if (c.res.status >= 500) {
      log.error({ ...line, err: c.error }, 'request failed');
    } else {
      log.info(line, 'request completed');
    }
  };
}
