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
    const { router, user } = await renderApp('/recipes/no-such-recipe');

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
    const { router } = await renderApp('/recipes/1?sort=newest', { signedInAs: null });

    await pageHeading('Sign in');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/recipes/1?sort=newest' });
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
    const { router } = await renderApp('/login?redirect=/recipes/1%3Fsort%3Dnewest');

    await pageHeading('Page not found');
    expect(router.currentRoute.value.fullPath).toBe('/recipes/1?sort=newest');
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
    const { router } = await renderApp('/', { answerSession: false });

    await router.push('/recipes/1');
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

    await renderApp('/recipes/1', { answerSession: false });

    await pageHeading('Page not found');
    expect(calls.count).toBe(3);
  });

  it('says so, and goes on to the page once it can', async () => {
    const calls = failSession(3);
    const { router, user } = await renderApp('/recipes/1', { answerSession: false });

    await pageHeading("Can't reach myli");
    expect(router.currentRoute.value.path).toBe('/unavailable');
    expect(router.currentRoute.value.query).toEqual({ redirect: '/recipes/1' });
    expect(calls.count).toBe(3);
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await pageHeading('Page not found');
    expect(router.currentRoute.value.fullPath).toBe('/recipes/1');
    expect(screen.getByRole('button', { name: 'Account: Ada Lovelace' })).toBeDefined();
  });

  it('says when trying again failed too', async () => {
    const calls = failSession(6);
    const { user } = await renderApp('/recipes/1', { answerSession: false });
    await pageHeading("Can't reach myli");

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Still no answer. Try again in a moment.')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: "Can't reach myli" })).toBeDefined();
    expect(calls.count).toBe(6);
  });

  it('still shows the sign-in page, which fetches the session again after signing in', async () => {
    failSession(3);

    await renderApp('/login', { answerSession: false });

    await pageHeading('Sign in');
  });
});
