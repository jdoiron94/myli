import { API_BASE_PATH } from '@myli/shared';
import createClient, { type Middleware } from 'openapi-fetch';
import { ApiProblem } from './problem.ts';
import type { paths } from './schema.ts';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The API answers 415 to a request that changes data without `Content-Type: application/json`,
 * even one with no body (CLAUDE.md, Cross-site requests). openapi-fetch only sets it with a body.
 * A content type the caller chose is left alone.
 */
const sendWritesAsJson: Middleware = {
  onRequest({ request }) {
    if (!READ_ONLY_METHODS.has(request.method) && !request.headers.has('content-type')) {
      request.headers.set('content-type', 'application/json');
    }
    return request;
  },
};

/** Failed calls throw an `ApiProblem`, so a call that returns has succeeded. */
const throwProblems: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) throw await ApiProblem.fromResponse(response);
    return response;
  },
};

/**
 * The versioned API (`/api/v1`), typed from its OpenAPI document. Requests are same-origin, so the
 * session cookie goes along. Better Auth's routes (`/api/auth`) aren't in it: the web app calls
 * those through Better Auth's own client.
 */
export const api = createClient<paths>({
  baseUrl: new URL(API_BASE_PATH, location.origin).href,
  // Looked up on each call: openapi-fetch would otherwise keep the `fetch` it saw when this module
  // loaded, and tests replace it (MSW) after that.
  fetch: (request) => globalThis.fetch(request),
});
api.use(sendWritesAsJson, throwProblems);

/**
 * The body of a successful call. Failed calls have already thrown (`throwProblems`), so this only
 * fails if the API answered a success without the body its OpenAPI document promises.
 */
export function responseData<T>({ data }: { data?: T }): T {
  if (data === undefined) throw new Error('The API answered without a body.');
  return data;
}
