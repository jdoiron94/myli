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

  it.each([
    ['a 5xx', problem(500, 'Internal Server Error')],
    ['a 4xx with no explanation', problem(400)],
    ["Better Auth's 4xx, which isn't written for users", new AuthProblem(400, 'X', 'Bad body')],
  ])('is a general one for %s', (_, error) => {
    expect(failureMessage(error)).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
  });

  it('says the server was unreachable when there was no answer at all', () => {
    expect(failureMessage(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach myli. Check your connection, then try again.",
    );
  });
});
