import type { CurrentSession, CurrentUser } from './auth/session.ts';
import type { Logger } from './logger.ts';

/** Variables every request handler can read from the Hono context, e.g. `c.var.logger`. */
export interface AppEnv {
  Variables: {
    /** The incoming `X-Request-Id` if it was well-formed, otherwise a generated UUID. */
    requestId: string;
    /** Child logger that tags every line with this request's ID. */
    logger: Logger;
    /**
     * The signed-in user, or `null`. Set on `API_BASE_PATH` routes by the session middleware.
     * Routes that need a user add `requireSession`, which also narrows the type.
     */
    user: CurrentUser | null;
    /** The current session, or `null`. Set together with `user`. */
    session: CurrentSession | null;
    /**
     * The client's address, trusting `X-Forwarded-For` only from `TRUSTED_PROXIES` (client-ip.ts).
     * `null` when it's unknown, as in tests that don't pass a socket.
     */
    clientIp: string | null;
  };
}
