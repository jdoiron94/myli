/** Prefix for every REST endpoint. Shared so the API router and the web client can't drift apart. */
export const API_BASE_PATH = '/api/v1';

/**
 * Where Better Auth's own routes live (sign-in, sign-out, session). They aren't versioned or in the
 * OpenAPI document: the web app calls them through Better Auth's client (ADR 0005).
 */
export const AUTH_BASE_PATH = '/api/auth';

export {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemDetailsSchema,
  VALIDATION_PROBLEM_TYPE,
  type ValidationProblem,
  validationProblemSchema,
} from './problem.ts';
export { DEFAULT_ROLE, ROLES, type Role, roleSchema } from './roles.ts';
