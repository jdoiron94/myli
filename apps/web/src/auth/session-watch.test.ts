import { AUTH_BASE_PATH, type User } from '@myli/shared';
import type { QueryClient } from '@tanstack/vue-query';
import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api, responseData } from '@/api/client.ts';
import { apiServer, problemResponse, renderApp, sessionResponse, testUsers } from '@/testing.ts';
import { authClient, unwrap } from './client.ts';
import { SESSION_ENDED_NOTICE } from './session-watch.ts';

const INVITATIONS_PATH = '/api/v1/invitations';
const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`;
const SESSION_PATH = `${AUTH_BASE_PATH}/get-session`;
const noSession = () => problemResponse(401, 'Sign in to continue.');
const refused = () => problemResponse(403, "You don't have permission to do this.");

/**
 * Answers the session with `current()` each time it's asked for, and counts the requests: the first
 * is the app starting.
 */
function answerSessionWith(current: () => User | null) {
  const asked = { count: 0 };
  apiServer.use(
    http.get(SESSION_PATH, () => {
      asked.count += 1;
      return sessionResponse(current());
    }),
  );
  return asked;
}

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
    const { router, queryClient } = await renderApp('/no-such-page/1');

    await mutate(queryClient, invite);

    await signInHeading();
    expect(router.currentRoute.value.query).toEqual({ redirect: '/no-such-page/1' });
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeDefined();
    expect(emailField()).toHaveProperty('value', testUsers.editor.email);
  });

  it('several requests finding out at once go to the sign-in page once', async () => {
    apiServer.use(http.post(INVITATIONS_PATH, noSession));
    const { router, queryClient } = await renderApp('/no-such-page/1');
    const replace = vi.spyOn(router, 'replace');

    await Promise.all([mutate(queryClient, invite), mutate(queryClient, invite)]);

    await signInHeading();
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('when the API refuses something (403)', () => {
  const demoted: User = { ...testUsers.admin, role: 'editor' };

  it('a query finding out their role changed checks the page again, which they lose', async () => {
    let user = testUsers.admin;
    const asked = answerSessionWith(() => user);
    apiServer.use(http.get(INVITATIONS_PATH, refused));
    // Another admin made them an editor after the app fetched the session.
    const { router, queryClient } = await renderApp('/', { signedInAs: 'admin' });
    user = demoted;

    await router.push('/admin/invitations?sort=email#top');

    await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" });
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations?sort=email#top');
    expect(queryClient.getQueryData(['session'])).toEqual(demoted);
    expect(screen.queryByRole('link', { name: 'Invitations' })).toBeNull();
    expect(asked.count).toBe(2);
  });

  it('a mutation finding out does the same', async () => {
    let user = testUsers.admin;
    answerSessionWith(() => user);
    apiServer.use(
      http.get(INVITATIONS_PATH, () => HttpResponse.json({ invitations: [] })),
      http.post(INVITATIONS_PATH, refused),
    );
    const { queryClient } = await renderApp('/admin/invitations', { signedInAs: 'admin' });
    await screen.findByText('No open invitations.');
    user = demoted;

    await mutate(queryClient, invite);

    await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" });
    expect(queryClient.getQueryData(['session'])).toEqual(demoted);
  });

  it('leaves them where they are when their role is the same', async () => {
    const asked = answerSessionWith(() => testUsers.editor);
    apiServer.use(http.post(INVITATIONS_PATH, refused));
    const { router, queryClient } = await renderApp('/no-such-page/1');
    const replace = vi.spyOn(router, 'replace');

    await mutate(queryClient, invite);
    await waitFor(() => {
      expect(asked.count).toBe(2);
    });
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/no-such-page/1');
    expect(replace).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['session'])).toEqual(testUsers.editor);
  });

  it('several refusals at once fetch the session once', async () => {
    // The session isn't answered until the app has heard both refusals, so the second arrives
    // while the request the first one started is still under way. Without that, a slow run can
    // finish the first request before the second refusal, which rightly asks again.
    const heardBoth = Promise.withResolvers<undefined>();
    const asked = { count: 0 };
    apiServer.use(
      http.get(SESSION_PATH, async () => {
        asked.count += 1;
        if (asked.count > 1) await heardBoth.promise;
        return sessionResponse(testUsers.editor);
      }),
      http.post(INVITATIONS_PATH, refused),
    );
    const { queryClient } = await renderApp('/no-such-page/1');
    // Subscribed after the app's watcher, so it hears each refusal once the watcher has.
    let refusals = 0;
    queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return;
      refusals += 1;
      if (refusals === 2) heardBoth.resolve(undefined);
    });

    await Promise.all([mutate(queryClient, invite), mutate(queryClient, invite)]);
    await heardBoth.promise;
    await waitFor(() => {
      expect(asked.count).toBe(2);
    });
    await settle();

    expect(asked.count).toBe(2);
  });

  it('goes to the sign-in page when the session has ended meanwhile', async () => {
    let user: User | null = testUsers.editor;
    answerSessionWith(() => user);
    apiServer.use(http.post(INVITATIONS_PATH, refused));
    const { router, queryClient } = await renderApp('/no-such-page/1');
    user = null;

    await mutate(queryClient, invite);

    await signInHeading();
    expect(router.currentRoute.value.query).toEqual({ redirect: '/no-such-page/1' });
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeDefined();
    expect(emailField()).toHaveProperty('value', testUsers.editor.email);
  });

  it("leaves them signed in where they are when the session can't be fetched", async () => {
    let failing = false;
    apiServer.use(
      http.get(SESSION_PATH, () =>
        failing ? problemResponse(500, 'Internal Server Error') : sessionResponse(testUsers.editor),
      ),
      http.post(INVITATIONS_PATH, refused),
    );
    const { router, queryClient } = await renderApp('/no-such-page/1');
    failing = true;

    await mutate(queryClient, invite);
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/no-such-page/1');
    expect(queryClient.getQueryData(['session'])).toEqual(testUsers.editor);
    expect(screen.getByRole('button', { name: `Account: ${testUsers.editor.name}` })).toBeDefined();
  });

  it("doesn't ask for the session when no one was signed in", async () => {
    const asked = answerSessionWith(() => null);
    apiServer.use(http.post(INVITATIONS_PATH, refused));
    const { router, queryClient } = await renderApp('/login', { signedInAs: null });

    await mutate(queryClient, invite);
    await settle();

    expect(asked.count).toBe(1);
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });
});

describe("a failure that doesn't mean the session ended", () => {
  it('such as a 500, leaves them signed in where they are', async () => {
    const asked = answerSessionWith(() => testUsers.editor);
    apiServer.use(http.post(INVITATIONS_PATH, () => problemResponse(500, 'Internal Server Error')));
    const { router, queryClient } = await renderApp('/');

    await mutate(queryClient, invite);
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(queryClient.getQueryData(['session'])).toEqual(testUsers.editor);
    expect(asked.count).toBe(1);
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
