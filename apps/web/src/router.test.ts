import { AUTH_BASE_PATH } from '@myli/shared';
import { screen } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  accessibilityViolations,
  apiServer,
  renderApp,
  sessionResponse,
  testUsers,
} from './testing.ts';

const pageHeading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('the router', () => {
  it('shows the home page at /, titled with the app name', async () => {
    await renderApp('/');

    await pageHeading('Recipes');
    expect(document.title).toBe('myli');
  });

  it('shows a page-not-found page at any other address, with a link home', async () => {
    const { router, user } = await renderApp('/no-such-page');

    await pageHeading('Page not found');
    expect(document.title).toBe('Page not found · myli');

    await user.click(screen.getByRole('link', { name: 'Go to the home page' }));

    await pageHeading('Recipes');
    expect(router.currentRoute.value.path).toBe('/');
    expect(document.title).toBe('myli');
  });
});

describe("the router's sign-in check", () => {
  it('sends signed-out visitors to the sign-in page, to come back afterwards', async () => {
    const { router } = await renderApp('/no-such-page/1?sort=newest', { signedInAs: null });

    await pageHeading('Sign in');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/no-such-page/1?sort=newest' });
    expect(document.title).toBe('Sign in · myli');
  });

  it("doesn't add a redirect for the home page", async () => {
    const { router } = await renderApp('/', { signedInAs: null });

    await pageHeading('Sign in');
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });

  it('sends signed-in users away from the sign-in page, home by default', async () => {
    const { router } = await renderApp('/login');

    await pageHeading('Recipes');
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('sends signed-in users away from the sign-in page to where they were going', async () => {
    const { router } = await renderApp('/login?redirect=/no-such-page/1%3Fsort%3Dnewest');

    await pageHeading('Page not found');
    expect(router.currentRoute.value.fullPath).toBe('/no-such-page/1?sort=newest');
  });

  it('never sends them to another site', async () => {
    const { router } = await renderApp(`/login?redirect=${encodeURIComponent('//example.com/')}`);

    await pageHeading('Recipes');
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('asks for the session only once, not on every navigation', async () => {
    let asked = 0;
    apiServer.use(
      http.get(`${AUTH_BASE_PATH}/get-session`, () => {
        asked += 1;
        return sessionResponse(testUsers.editor);
      }),
    );
    const { router } = await renderApp('/');

    await router.push('/no-such-page/1');
    await router.push('/');

    expect(asked).toBe(1);
  });
});

describe("when the session can't be fetched", () => {
  /** Answers GET /get-session with a 503 `failures` times, then with `user` signed in. */
  function failSession(failures: number) {
    const calls = { count: 0 };
    apiServer.use(
      http.get(`${AUTH_BASE_PATH}/get-session`, () => {
        calls.count += 1;
        return calls.count <= failures
          ? new HttpResponse('Service unavailable', { status: 503 })
          : sessionResponse(testUsers.editor);
      }),
    );
    return calls;
  }

  it('tries twice more before giving up', async () => {
    const calls = failSession(2);

    await renderApp('/no-such-page/1');

    await pageHeading('Page not found');
    expect(calls.count).toBe(3);
  });

  it('says so, and goes on to the page once it can', async () => {
    const calls = failSession(3);
    const { router, user } = await renderApp('/no-such-page/1');

    await pageHeading("Can't reach myli");
    expect(router.currentRoute.value.path).toBe('/unavailable');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/no-such-page/1' });
    expect(calls.count).toBe(3);
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await pageHeading('Page not found');
    expect(router.currentRoute.value.fullPath).toBe('/no-such-page/1');
    expect(screen.getByRole('button', { name: 'Account: Ada Lovelace' })).toBeDefined();
  });

  it('says when trying again failed too', async () => {
    const calls = failSession(6);
    const { user } = await renderApp('/no-such-page/1');
    await pageHeading("Can't reach myli");

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Still no answer. Try again in a moment.')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: "Can't reach myli" })).toBeDefined();
    expect(calls.count).toBe(6);
  });

  it('still shows the sign-in page, which fetches the session again after signing in', async () => {
    failSession(3);

    await renderApp('/login');

    await pageHeading('Sign in');
  });
});

describe('first-run setup', () => {
  /** Answers GET /setup with each of `answers` in turn (the last one after that), counting calls. */
  function answerSetupWith(...answers: (() => Response)[]) {
    const calls = { count: 0 };
    apiServer.use(
      http.get('/api/v1/setup', () => {
        const answer = answers[Math.min(calls.count, answers.length - 1)];
        calls.count += 1;
        if (!answer) throw new Error('give at least one answer');
        return answer();
      }),
    );
    return calls;
  }
  const needed = (value: boolean) => () => HttpResponse.json({ needed: value });

  it.each(['/', '/no-such-page/1', '/login', '/login?redirect=/no-such-page/1'])(
    'is the only page while no user exists, even at %s',
    async (path) => {
      const { router } = await renderApp(path, { signedInAs: null, setupNeeded: true });

      await pageHeading('Set up myli');
      expect(router.currentRoute.value.fullPath).toBe('/setup');
      expect(document.title).toBe('Set up myli · myli');
    },
  );

  it('sends signed-out visitors to the sign-in page once a user exists', async () => {
    const { router } = await renderApp('/setup', { signedInAs: null });

    await pageHeading('Sign in');
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });

  it("sends signed-in users home, without asking: they're proof a user exists", async () => {
    const calls = answerSetupWith(needed(true));

    const { router } = await renderApp('/setup');

    await pageHeading('Recipes');
    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(calls.count).toBe(0);
  });

  it("asks again on each navigation while it's needed, in case someone else finished it", async () => {
    const calls = answerSetupWith(needed(true), needed(false));
    const { router } = await renderApp('/setup', { signedInAs: null });

    await router.push('/no-such-page/1');

    await pageHeading('Sign in');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/no-such-page/1' });
    expect(calls.count).toBe(2);
  });

  it("stops asking once it's done", async () => {
    const calls = answerSetupWith(needed(false));
    const { router } = await renderApp('/login', { signedInAs: null });

    await router.push('/no-such-page/1');
    await router.push('/setup');

    await pageHeading('Sign in');
    expect(calls.count).toBe(1);
  });

  it("says when it can't tell whether setup is needed, and goes on once it can", async () => {
    const unavailable = () => new HttpResponse('Service unavailable', { status: 503 });
    const calls = answerSetupWith(unavailable, unavailable, unavailable, needed(true));
    const { router, user } = await renderApp('/', { signedInAs: null });

    await pageHeading("Can't reach myli");
    expect(calls.count).toBe(3);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await pageHeading('Set up myli');
    expect(router.currentRoute.value.fullPath).toBe('/setup');
  });
});

describe("the router's permission check", () => {
  const answerAdminPages = () => {
    apiServer.use(
      http.get('/api/v1/invitations', () => HttpResponse.json({ invitations: [] })),
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          users: [
            { ...testUsers.admin, deactivated: false, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      ),
    );
  };

  it.each([
    ['/admin/invitations', 'invitations', 'Invitations', 'No open invitations.'],
    ['/admin/users', 'users', 'Users', testUsers.admin.email],
  ])('opens %s to a user whose role allows it', async (path, name, heading, loaded) => {
    answerAdminPages();
    const { router } = await renderApp(path, { signedInAs: 'admin' });

    await pageHeading(heading);
    expect(router.currentRoute.value.name).toBe(name);
    await screen.findByText(loaded);
  });

  it.each([
    ['an editor', 'editor', '/admin/invitations'],
    ['a viewer', 'viewer', '/admin/invitations'],
    ['an editor', 'editor', '/admin/users'],
    ['a viewer', 'viewer', '/admin/users'],
  ] as const)(
    "shows %s that they don't have access to %s, at its address",
    async (_, role, path) => {
      const { router, user } = await renderApp(`${path}?sort=email#top`, { signedInAs: role });

      await pageHeading("You don't have access to this page");
      expect(router.currentRoute.value.name).toBe('no-access');
      expect(router.currentRoute.value.fullPath).toBe(`${path}?sort=email#top`);
      expect(document.title).toBe('No access · myli');
      expect(await accessibilityViolations()).toEqual([]);

      await user.click(screen.getByRole('link', { name: 'Go to the home page' }));

      await pageHeading('Recipes');
    },
  );

  it('checks it on navigating within the app too', async () => {
    const { router } = await renderApp('/', { signedInAs: 'viewer' });

    await router.push('/admin/users');

    await pageHeading("You don't have access to this page");
    expect(router.currentRoute.value.fullPath).toBe('/admin/users');
  });

  it('sends signed-out visitors to sign in first', async () => {
    const { router } = await renderApp('/admin/users', { signedInAs: null });

    await pageHeading('Sign in');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/admin/users' });
  });
});
