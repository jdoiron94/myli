import { AUTH_BASE_PATH } from '@myli/shared';
import type { QueryClient } from '@tanstack/vue-query';
import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api, responseData } from '@/api/client.ts';
import { apiServer, problemResponse, renderApp, testUsers } from '@/testing.ts';
import { authClient, unwrap } from './client.ts';
import { SESSION_ENDED_NOTICE } from './session-end.ts';

const INVITATIONS_PATH = '/api/v1/invitations';
const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`;
const noSession = () => problemResponse(401, 'Sign in to continue.');

const emailField = () => screen.getByRole('textbox', { name: 'Email' });
const signInHeading = () => screen.findByRole('heading', { level: 1, name: 'Sign in' });
/** Long enough for a navigation to start, if one were going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Runs `call` as a mutation on `queryClient`, as a page's `useMutation` would, ignoring its failure. */
async function mutate(queryClient: QueryClient, call: () => Promise<unknown>) {
  await queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: call })
    .execute(undefined)
    .catch(() => undefined);
}

/** A write to the versioned API, which the fake API answers at POST /invitations. */
const invite = async () =>
  responseData(
    await api.POST('/invitations', { body: { email: 'katherine@example.com', role: 'viewer' } }),
  );

describe('when the session ends', () => {
  it('a query finding out goes to the sign-in page, which comes back here afterwards', async () => {
    let ended = true;
    apiServer.use(
      http.get(INVITATIONS_PATH, () =>
        ended ? noSession() : HttpResponse.json({ invitations: [] }),
      ),
      http.post(SIGN_IN_PATH, () => {
        ended = false;
        return HttpResponse.json({});
      }),
    );
    const { router, queryClient, user } = await renderApp('/admin/invitations?sort=email', {
      signedInAs: 'admin',
    });

    await signInHeading();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/admin/invitations?sort=email' });
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeDefined();
    expect(emailField()).toHaveProperty('value', testUsers.admin.email);
    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
    // Nothing fetched while they were signed in stays behind.
    expect(queryClient.getQueryData(['session'])).toBeNull();
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: ['invitations'] })).toBeUndefined();
    });

    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('No open invitations.');
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations?sort=email');
  });

  it('a mutation finding out does the same', async () => {
    apiServer.use(http.post(INVITATIONS_PATH, noSession));
    const { router, queryClient } = await renderApp('/recipes/1');

    await mutate(queryClient, invite);

    await signInHeading();
    expect(router.currentRoute.value.query).toEqual({ redirect: '/recipes/1' });
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeDefined();
    expect(emailField()).toHaveProperty('value', testUsers.editor.email);
  });

  it('several requests finding out at once go to the sign-in page once', async () => {
    apiServer.use(http.post(INVITATIONS_PATH, noSession));
    const { router, queryClient } = await renderApp('/recipes/1');
    const replace = vi.spyOn(router, 'replace');

    await Promise.all([mutate(queryClient, invite), mutate(queryClient, invite)]);

    await signInHeading();
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("a failure that doesn't mean the session ended", () => {
  it.each([
    ['403', () => problemResponse(403, 'Only admins can invite people.')],
    ['500', () => problemResponse(500, 'Internal Server Error')],
  ])('such as a %s, leaves them signed in where they are', async (_, answer) => {
    apiServer.use(http.post(INVITATIONS_PATH, answer));
    const { router, queryClient } = await renderApp('/');

    await mutate(queryClient, invite);
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(queryClient.getQueryData(['session'])).toEqual(testUsers.editor);
  });

  it("such as Better Auth's 401 for a wrong password, is for the page to explain", async () => {
    apiServer.use(
      http.post(SIGN_IN_PATH, () =>
        HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );
    const { router, queryClient } = await renderApp('/');

    await mutate(queryClient, () =>
      unwrap(authClient.signIn.email({ email: 'ada@example.com', password: 'wrong' })),
    );
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(queryClient.getQueryData(['session'])).toEqual(testUsers.editor);
  });

  it('nor does a 401 when no one was signed in', async () => {
    apiServer.use(http.post(INVITATIONS_PATH, noSession));
    const { router, queryClient } = await renderApp('/login', { signedInAs: null });

    await mutate(queryClient, invite);
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(screen.queryByText(SESSION_ENDED_NOTICE)).toBeNull();
  });
});
