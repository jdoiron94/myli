import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiServer, problemResponse } from '../testing.ts';
import { api, responseData } from './client.ts';
import { ApiProblem } from './problem.ts';

/** Answers `method path` with `response`, keeping the Content-Type each request was sent with. */
function recordContentTypes(
  handlers: { method: 'get' | 'post'; path: string; response: () => Response }[],
) {
  const seen: Record<string, string | null> = {};
  apiServer.use(
    ...handlers.map(({ method, path, response }) =>
      http[method](`/api/v1${path}`, ({ request }) => {
        seen[`${method.toUpperCase()} ${path}`] = request.headers.get('content-type');
        return response();
      }),
    ),
  );
  return seen;
}

const noContent = () => new HttpResponse(null, { status: 204 });

describe('the API client', () => {
  it('sends writes without a body as JSON, which the API requires (or it answers 415)', async () => {
    const seen = recordContentTypes([
      { method: 'post', path: '/invitations/:id/revoke', response: noContent },
      { method: 'post', path: '/invitations/:id/resend', response: () => HttpResponse.json({}) },
    ]);

    await api.POST('/invitations/{id}/revoke', { params: { path: { id: 'inv-1' } } });
    await api.POST('/invitations/{id}/resend', { params: { path: { id: 'inv-1' } } });

    expect(seen).toEqual({
      'POST /invitations/:id/revoke': 'application/json',
      'POST /invitations/:id/resend': 'application/json',
    });
  });

  it('leaves reads, JSON bodies and a content type the caller chose as they are', async () => {
    const seen = recordContentTypes([
      { method: 'get', path: '/invitations', response: () => HttpResponse.json({}) },
      { method: 'post', path: '/invitations', response: () => HttpResponse.json({}) },
      { method: 'post', path: '/invitations/:id/revoke', response: noContent },
    ]);

    await api.GET('/invitations');
    await api.POST('/invitations', { body: { email: 'ada@example.com', role: 'editor' } });
    await api.POST('/invitations/{id}/revoke', {
      params: { path: { id: 'inv-1' } },
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

    expect(seen).toEqual({
      'GET /invitations': null,
      'POST /invitations': 'application/json',
      'POST /invitations/:id/revoke': 'application/json; charset=utf-8',
    });
  });

  it('returns the body of a successful call', async () => {
    apiServer.use(http.get('/api/v1/setup', () => HttpResponse.json({ needed: true })));

    const { data } = await api.GET('/setup');

    expect(data).toEqual({ needed: true });
  });

  it("refuses a success that's missing the body the API promises", async () => {
    apiServer.use(http.get('/api/v1/setup', () => new HttpResponse(null, { status: 200 })));

    const result = await api.GET('/setup');

    expect(() => responseData(result)).toThrow('The API answered without a body.');
    expect(responseData({ data: { needed: false } })).toEqual({ needed: false });
  });

  it('throws the problem the API answered with', async () => {
    const detail = 'No open invitation has this ID. It may have been accepted or revoked.';
    apiServer.use(http.post('/api/v1/invitations/:id/revoke', () => problemResponse(404, detail)));

    const call = api.POST('/invitations/{id}/revoke', { params: { path: { id: 'inv-1' } } });

    await expect(call).rejects.toBeInstanceOf(ApiProblem);
    await expect(call).rejects.toMatchObject({
      status: 404,
      message: detail,
      problem: { status: 404, detail },
      fieldErrors: [],
    });
  });

  it("keeps a validation problem's field errors, for a form to show", async () => {
    const errors = [{ in: 'body', pointer: '#/email', detail: 'Invalid email address' }];
    apiServer.use(
      http.post('/api/v1/invitations', () =>
        problemResponse(422, 'The request failed validation.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors,
        }),
      ),
    );

    const call = api.POST('/invitations', { body: { email: 'not-an-email', role: 'editor' } });

    await expect(call).rejects.toMatchObject({ status: 422, fieldErrors: errors });
  });

  it('turns an answer that isn’t a problem, an HTML page or the wrong shape, into a generic one with the status', async () => {
    for (const [, response] of [
      [
        'an HTML error page',
        () =>
          new HttpResponse('<h1>Bad Gateway</h1>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ],
      [
        'a problem body of the wrong shape',
        () =>
          HttpResponse.json(
            { message: 'nope' },
            { status: 502, headers: { 'content-type': 'application/problem+json' } },
          ),
      ],
    ] as const) {
      apiServer.use(http.get('/api/v1/setup', response));

      await expect(api.GET('/setup')).rejects.toMatchObject({
        status: 502,
        message: 'The request failed with HTTP status 502.',
        problem: { type: 'about:blank', title: 'Request failed', status: 502 },
        fieldErrors: [],
      });
    }
  });
});
