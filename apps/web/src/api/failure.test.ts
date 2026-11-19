import { describe, expect, it } from 'vitest';
import { AuthProblem } from '@/auth/client.ts';
import { failureMessage } from './failure.ts';
import { ApiProblem } from './problem.ts';

const problem = (status: number, detail?: string) =>
  new ApiProblem({ type: 'about:blank', title: 'Error', status, ...(detail && { detail }) });

describe('what a failed request tells the user', () => {
  it("is the API's own explanation of a 4xx", () => {
    expect(failureMessage(problem(409, 'Setup is already complete. Sign in instead.'))).toBe(
      'Setup is already complete. Sign in instead.',
    );
  });

  it("is the API's own explanation of a 503, which says what's unavailable", () => {
    expect(failureMessage(problem(503, 'Search is unavailable right now.'))).toBe(
      'Search is unavailable right now.',
    );
  });

  it('is a general one for a 5xx, an answer with no explanation, or Better Auth’s 4xx', () => {
    const errors = {
      'a 5xx': problem(500, 'Internal Server Error'),
      'a 503 with no explanation, as from a proxy': problem(503),
      'a 4xx with no explanation': problem(400),
      // Not written for users.
      "Better Auth's 4xx": new AuthProblem(400, 'X', 'Bad body'),
    };
    const general = "Something went wrong on myli's server. Try again in a moment.";

    expect(
      Object.fromEntries(
        Object.entries(errors).map(([name, error]) => [name, failureMessage(error)]),
      ),
    ).toEqual(Object.fromEntries(Object.keys(errors).map((name) => [name, general])));
  });

  it('says the server was unreachable when there was no answer at all', () => {
    expect(failureMessage(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach myli. Check your connection, then try again.",
    );
  });
});
