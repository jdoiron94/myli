import { STATUS_CODES } from 'node:http';
import type { Hook } from '@hono/zod-openapi';
import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemDetailsSchema,
  VALIDATION_PROBLEM_TYPE,
  type ValidationProblem,
  validationProblemSchema,
} from '@myli/shared';
import type { Context, ErrorHandler, NotFoundHandler, ValidationTargets } from 'hono';
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

/**
 * Throw from a handler when a request body passed its schema but some of its fields still can't be
 * used, like a tag that no longer exists: the client gets the same 422 `ValidationProblem` as for a
 * schema failure, so forms show the message next to the field. `detail` goes to the client as is.
 */
export class InvalidFields extends Error {
  override name = 'InvalidFields';
  readonly fields: readonly { path: readonly PropertyKey[]; detail: string }[];

  constructor(fields: readonly { path: readonly PropertyKey[]; detail: string }[]) {
    super('Request validation failed');
    this.fields = fields;
  }
}

export function problemResponse(c: Context<AppEnv>, status: ContentfulStatusCode, detail?: string) {
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
  if (error instanceof InvalidFields) {
    return validationProblemResponse(
      c,
      error.fields.map(({ path, detail }) => ({
        in: 'body',
        pointer: toJsonPointer(path),
        detail,
      })),
    );
  }
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

/**
 * Error responses every OpenAPI route spreads into its `responses`. They put the problem schemas
 * into the OpenAPI document as components, so the generated client knows every error shape.
 *
 * (The schemas can't be registered up front instead: `openAPIRegistry.register()` calls
 * `.openapi()`, which a Zod 4 schema only has if it was built after `@hono/zod-openapi` loaded.
 * The shared schemas are usually built first.)
 */
export const errorResponses = {
  422: {
    description: 'The request failed validation.',
    content: { [PROBLEM_CONTENT_TYPE]: { schema: validationProblemSchema } },
  },
  default: {
    description: 'Any other error, as RFC 9457 problem details.',
    content: { [PROBLEM_CONTENT_TYPE]: { schema: problemDetailsSchema } },
  },
};

type FieldLocation = ValidationProblem['errors'][number]['in'];

const LOCATION_BY_TARGET = {
  json: 'body',
  form: 'body',
  query: 'query',
  param: 'path',
  header: 'header',
  cookie: 'cookie',
} as const satisfies Record<keyof ValidationTargets, FieldLocation>;

/** RFC 6901 JSON Pointer in URI fragment form, e.g. `['tags', 0]` becomes `#/tags/0`. */
function toJsonPointer(path: readonly PropertyKey[]): string {
  const escape = (key: PropertyKey) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  return `#${path.map((key) => `/${escape(key)}`).join('')}`;
}

/**
 * Default hook for OpenAPI routes: when a request fails its Zod schema, answer 422 with a
 * `ValidationProblem` listing every invalid field. Zod's messages describe the expected value
 * and never echo the input.
 */
export const validationHook: Hook<unknown, AppEnv, string, Response | undefined> = (result, c) => {
  if (result.success) {
    return undefined;
  }
  return validationProblemResponse(
    c,
    result.error.issues.map((issue) => ({
      in: LOCATION_BY_TARGET[result.target],
      pointer: toJsonPointer(issue.path),
      detail: issue.message,
    })),
  );
};

function validationProblemResponse(c: Context<AppEnv>, errors: ValidationProblem['errors']) {
  const body: ValidationProblem = {
    type: VALIDATION_PROBLEM_TYPE,
    title: 'Request validation failed',
    status: 422,
    errors,
    requestId: c.get('requestId'),
  };
  return c.json(body, 422, { 'Content-Type': PROBLEM_CONTENT_TYPE });
}
