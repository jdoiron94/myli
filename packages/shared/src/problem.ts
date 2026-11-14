import { z } from 'zod';

/** Media type of every API error response. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * RFC 9457 Problem Details: the body of every API error response.
 * Specific problem types extend this schema with their own fields.
 */
export const problemDetailsSchema = z
  .object({
    type: z
      .string()
      .describe(
        'Identifies the problem type. `about:blank` means the status code says everything, and `title` is then the standard status text.',
      ),
    title: z.string().describe('Short summary of the problem type.'),
    status: z.number().int().min(400).max(599).describe('The HTTP status code.'),
    detail: z
      .string()
      .optional()
      .describe(
        'Explanation of this occurrence, written for the client. Never contains internals.',
      ),
    requestId: z
      .string()
      .optional()
      .describe(
        'Matches the `X-Request-Id` response header and the server log lines for this request.',
      ),
  })
  .meta({ id: 'ProblemDetails', description: 'RFC 9457 problem details.' });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/**
 * `type` of a request that failed schema validation. A relative URI: the project owns no domain
 * to mint absolute ones under, and clients compare it as an opaque string.
 */
export const VALIDATION_PROBLEM_TYPE = '/problems/validation-error';

/** A request that failed schema validation, with one entry per invalid field. */
export const validationProblemSchema = problemDetailsSchema
  .extend({
    type: z.literal(VALIDATION_PROBLEM_TYPE),
    status: z.literal(422),
    errors: z
      .array(
        z.object({
          in: z
            .enum(['body', 'query', 'path', 'header', 'cookie'])
            .describe('Which part of the request the field is in.'),
          pointer: z
            .string()
            .describe('RFC 6901 JSON Pointer to the field within that part, e.g. `#/tags/0`.'),
          detail: z.string().describe('What is wrong with the field.'),
        }),
      )
      .min(1)
      .describe('One entry per invalid field.'),
  })
  .meta({ id: 'ValidationProblem', description: 'A request that failed schema validation.' });

export type ValidationProblem = z.infer<typeof validationProblemSchema>;
