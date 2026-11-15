import { AUTH_BASE_PATH } from '@myli/shared';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { createAppQueryClient } from '@/api/query.ts';
import { answerSession, apiServer, sessionResponse, testUsers } from '@/testing.ts';
import { AuthProblem, authClient, unwrap } from './client.ts';
import { sessionQuery } from './session.ts';

const fetchSession = () => createAppQueryClient().query({ ...sessionQuery, retry: false });

describe('the session', () => {
  it('is the signed-in user, role included, and nothing else Better Auth sends', async () => {
    answerSession(testUsers.viewer);

    await expect(fetchSession()).resolves.toStrictEqual(testUsers.viewer);
  });

  it('is null when no one is signed in', async () => {
    answerSession(null);

    await expect(fetchSession()).resolves.toBeNull();
  });

  it("fails when the user has no role the app knows, instead of guessing what they're allowed", async () => {
    apiServer.use(
      http.get(`${AUTH_BASE_PATH}/get-session`, async () => {
        const body = (await sessionResponse(testUsers.editor).json()) as {
          user: Record<string, unknown>;
        };
        return HttpResponse.json({ ...body, user: { ...body.user, role: 'owner' } });
      }),
    );

    await expect(fetchSession()).rejects.toThrow(/role/);
  });
});

describe("Better Auth's calls", () => {
  it('return the data of a successful answer', async () => {
    answerSession(testUsers.admin);

    await expect(unwrap(authClient.getSession())).resolves.toMatchObject({
      user: { id: testUsers.admin.id },
    });
  });

  it("throw an AuthProblem with the status and Better Auth's code for an error answer", async () => {
    apiServer.use(
      http.post(`${AUTH_BASE_PATH}/sign-in/email`, () =>
        HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );

    const failure = unwrap(authClient.signIn.email({ email: 'ada@example.com', password: 'x' }));

    await expect(failure).rejects.toBeInstanceOf(AuthProblem);
    await expect(failure).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    });
  });

  it('throw an AuthProblem with only the status when the answer says nothing more', async () => {
    apiServer.use(
      http.post(
        `${AUTH_BASE_PATH}/sign-out`,
        () => new HttpResponse('Bad gateway', { status: 502 }),
      ),
    );

    await expect(unwrap(authClient.signOut())).rejects.toMatchObject({
      status: 502,
      code: undefined,
      message: 'The request failed with HTTP status 502.',
    });
  });
});
