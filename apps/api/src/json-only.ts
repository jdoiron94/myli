import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context.ts';
import { HttpProblem } from './problems.ts';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const JSON_ONLY_DETAIL =
  'Send requests that change data with Content-Type: application/json, even when they have no body.';

/**
 * Answers 415 to every request that could change data, unless it says `Content-Type:
 * application/json`, with or without a body.
 *
 * This is the cross-site request defense (CLAUDE.md, Content and security). Another origin can
 * make a browser send the session cookie only with a "simple" request: one whose content type is
 * form-encoded, multipart, `text/plain` or absent. Anything else, JSON included, needs a CORS
 * preflight, which this API never approves. `SameSite=Lax` cookies alone aren't enough: they still
 * go with requests from other origins on the same site, such as another app on a different port
 * of the same host.
 */
export function jsonOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!READ_ONLY_METHODS.has(c.req.method) && !isJson(c.req.header('content-type'))) {
      throw new HttpProblem(415, JSON_ONLY_DETAIL);
    }
    await next();
  };
}

/** `application/json`, in any case, with or without parameters such as `charset`. */
function isJson(contentType: string | undefined) {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}
