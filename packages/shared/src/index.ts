/** Prefix for every REST endpoint. Shared so the API router and the web client can't drift apart. */
export const API_BASE_PATH = '/api/v1';

export {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemDetailsSchema,
  VALIDATION_PROBLEM_TYPE,
  type ValidationProblem,
  validationProblemSchema,
} from './problem.ts';
