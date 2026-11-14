import { STATUS_CODES } from 'node:http';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@myli/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './context.ts';

/**
 * Throw from a handler to answer with an RFC 9457 problem response.
 * `detail` is sent to the client as is, so it must never contain internals.
 */
export class HttpProblem extends Error {
  override name = 'HttpProblem';
  readonly status: ContentfulStatusCode;
  readonly detail: string | undefined;

  constructor(status: ContentfulStatusCode, detail?: string) {
    super(detail ?? STATUS_CODES[status]);
    this.status = status;
    this.detail = detail;
  }
}

function problemResponse(c: Context<AppEnv>, status: ContentfulStatusCode, detail?: string) {
  const body: ProblemDetails = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Unknown Error',
    status,
    detail,
    requestId: c.get('requestId'),
  };
  return c.json(body, status, { 'Content-Type': PROBLEM_CONTENT_TYPE });
}

export const onNotFound: NotFoundHandler<AppEnv> = (c) => problemResponse(c, 404);

export const onError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof HttpProblem) {
    return problemResponse(c, error.status, error.detail);
  }
  if (error instanceof HTTPException) {
    // Hono's own middleware throws these with client-facing messages, but only trust them for 4xx.
    const detail = error.status < 500 && error.message !== '' ? error.message : undefined;
    return problemResponse(c, error.status, detail);
  }
  // Unexpected: the request logger records the error and its stack. The client gets only the
  // status and the request ID, which leads an operator to that log line.
  return problemResponse(c, 500);
};
