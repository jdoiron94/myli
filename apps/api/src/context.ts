import type { Logger } from './logger.ts';

/** Variables every request handler can read from the Hono context, e.g. `c.var.logger`. */
export interface AppEnv {
  Variables: {
    /** The incoming `X-Request-Id` if it was well-formed, otherwise a generated UUID. */
    requestId: string;
    /** Child logger that tags every line with this request's ID. */
    logger: Logger;
  };
}
