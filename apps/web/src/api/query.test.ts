import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiServer, problemResponse } from '../testing.ts';
import { api } from './client.ts';
import { ApiProblem } from './problem.ts';
import { createAppQueryClient } from './query.ts';

/** Answers GET /setup with `responses` in turn (the last one again after that), counting calls. */
function answerSetupWith(...responses: (() => Response)[]) {
  const calls = { count: 0 };
  apiServer.use(
    http.get('/api/v1/setup', () => {
      const response = responses[Math.min(calls.count, responses.length - 1)];
      calls.count += 1;
      if (!response) throw new Error('give at least one response');
      return response();
    }),
  );
  return calls;
}

/** Fetches GET /setup as a query with the app's defaults, without waiting between retries. */
function fetchSetup() {
  return createAppQueryClient().query({
    queryKey: ['setup'],
    queryFn: async () => (await api.GET('/setup')).data,
    retryDelay: 0,
  });
}

const unavailable = () => problemResponse(503, 'The server is starting.');

describe("the app's queries", () => {
  it('try a 5xx answer twice more, and succeed if one of those does', async () => {
    const calls = answerSetupWith(unavailable, unavailable, () =>
      HttpResponse.json({ needed: false }),
    );

    await expect(fetchSetup()).resolves.toEqual({ needed: false });
    expect(calls.count).toBe(3);
  });

  it('give up on a 5xx after two retries, and never retry a 4xx', async () => {
    const tries: Record<number, number> = {};
    for (const status of [400, 404, 422, 499, 500, 503]) {
      const calls = answerSetupWith(() => problemResponse(status, 'No.'));
      await expect(fetchSetup()).rejects.toBeInstanceOf(ApiProblem);
      tries[status] = calls.count;
    }

    expect(tries).toEqual({ 400: 1, 404: 1, 422: 1, 499: 1, 500: 3, 503: 3 });
  });

  it('retry network failures too', async () => {
    const calls = answerSetupWith(() => HttpResponse.error());

    await expect(fetchSetup()).rejects.toBeInstanceOf(TypeError);
    expect(calls.count).toBe(3);
  });
});
