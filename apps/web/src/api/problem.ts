import {
  type ProblemDetails,
  problemDetailsSchema,
  type ValidationProblem,
  validationProblemSchema,
} from '@myli/shared';

export type FieldError = ValidationProblem['errors'][number];

/**
 * An API call that failed with an HTTP error. `problem` is the RFC 9457 body the API sent, or a
 * generic one when the response wasn't a problem at all, such as a proxy's error page.
 * `fieldErrors` lists the invalid fields of a 422, for a form to show next to each field.
 */
export class ApiProblem extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly fieldErrors: readonly FieldError[];

  constructor(problem: ProblemDetails, fieldErrors: readonly FieldError[] = []) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiProblem';
    this.status = problem.status;
    this.problem = problem;
    this.fieldErrors = fieldErrors;
  }

  /** The problem a failed response describes, if its body is one; otherwise a generic one. */
  static async fromResponse(response: Response): Promise<ApiProblem> {
    const body = await readJson(response);

    const validation = validationProblemSchema.safeParse(body);
    if (validation.success) return new ApiProblem(validation.data, validation.data.errors);
    const problem = problemDetailsSchema.safeParse(body);
    if (problem.success) return new ApiProblem(problem.data);

    return new ApiProblem({
      type: 'about:blank',
      title: 'Request failed',
      status: response.status,
      detail: `The request failed with HTTP status ${String(response.status)}.`,
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
