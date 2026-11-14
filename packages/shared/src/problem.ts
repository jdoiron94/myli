import { z } from 'zod';

/** Media type of every API error response. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * RFC 9457 Problem Details: the body of every API error response.
 *
 * `type` is `about:blank` when the status code says everything, in which case `title` is the
 * standard status text. Specific problem types with their own extra fields will extend this schema.
 */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  /** Explanation of this occurrence, written for the client. Never contains internals. */
  detail: z.string().optional(),
  /** Matches the `X-Request-Id` response header and the API's log lines for this request. */
  requestId: z.string().optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
