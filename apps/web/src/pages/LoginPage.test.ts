import { AUTH_BASE_PATH } from '@myli/shared';
import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  accessibilityViolations,
  apiServer,
  renderApp,
  sessionResponse,
  testUsers,
} from '@/testing.ts';

const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`;

const emailField = () => screen.getByRole('textbox', { name: 'Email' });
// Password inputs have no role.
const passwordField = () => screen.getByLabelText('Password');
const signInButton = () => screen.getByRole('button', { name: 'Sign in' });

/** The text of the message an input points to with `aria-describedby`, if any. */
function describedBy(input: HTMLElement) {
  const id = input.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent.trim() : undefined;
}

/**
 * The sign-in page, signed out, with Better Auth answering sign-ins with `answer` and the session
 * following. Returns the sign-in requests' bodies.
 */
async function renderLogin(path = '/login', answer: () => Response = () => HttpResponse.json({})) {
  let signedIn = false;
  const signIns: unknown[] = [];
  apiServer.use(
    http.get(`${AUTH_BASE_PATH}/get-session`, () =>
      sessionResponse(signedIn ? testUsers.editor : null),
    ),
    http.post(SIGN_IN_PATH, async ({ request }) => {
      signIns.push(await request.json());
      const response = answer();
      signedIn = response.ok;
      return response;
    }),
  );
  const rendered = await renderApp(path, { answerSession: false });
  await screen.findByRole('heading', { level: 1, name: 'Sign in' });
  return { ...rendered, signIns };
}

describe('the sign-in page', () => {
  it('signs in, then goes where they were going, signed in', async () => {
    const { router, user, signIns } = await renderLogin('/login?redirect=/recipes/1');

    await user.type(emailField(), 'Ada@Example.com');
    await user.type(passwordField(), 'correct horse battery staple');
    await user.click(signInButton());

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/1');
    expect(screen.getByRole('button', { name: 'Account: Ada Lovelace' })).toBeDefined();
    // Emails are compared in lower case.
    expect(signIns).toEqual([
      { email: 'ada@example.com', password: 'correct horse battery staple' },
    ]);
  });

  it('goes home after signing in when it was opened directly', async () => {
    const { router, user } = await renderLogin();

    await user.type(emailField(), 'ada@example.com');
    await user.type(passwordField(), 'correct horse battery staple');
    await user.keyboard('{Enter}');

    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it("doesn't check the password against the rules: those apply when one is set", async () => {
    const { user, signIns } = await renderLogin();

    await user.type(emailField(), 'ada@example.com');
    await user.type(passwordField(), 'short');
    await user.click(signInButton());

    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(signIns).toEqual([{ email: 'ada@example.com', password: 'short' }]);
  });

  it('checks the fields on submit, sends nothing, and moves focus to the first problem', async () => {
    const { user, signIns } = await renderLogin();

    await user.click(signInButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(emailField().getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(emailField())).toBe('Enter a valid email address.');
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(passwordField())).toBe('Enter your password.');
    expect(signIns).toEqual([]);
    expect(await accessibilityViolations()).toEqual([]);
  });

  it("doesn't show an error while a field is first filled in", async () => {
    const { user } = await renderLogin();

    await user.type(emailField(), 'ada@');
    await user.click(passwordField());

    expect(emailField().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  });

  it('clears an error as soon as the field is fixed', async () => {
    const { user } = await renderLogin();
    await user.type(emailField(), 'ada@');
    await user.click(signInButton());
    await screen.findByText('Enter a valid email address.');

    await user.type(emailField(), 'example.com');

    await waitFor(() => {
      expect(screen.queryByText('Enter a valid email address.')).toBeNull();
    });
    expect(emailField().getAttribute('aria-invalid')).toBeNull();
    // The other field's error stays until it's fixed too.
    expect(screen.getByText('Enter your password.')).toBeDefined();
  });

  it.each([
    [
      'a wrong email or password',
      () =>
        HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        ),
      'Wrong email or password.',
    ],
    [
      'a deactivated account',
      () =>
        HttpResponse.json(
          { code: 'BANNED_USER', message: 'You have been banned from this application' },
          { status: 403 },
        ),
      'This account is deactivated. Ask an admin to reactivate it.',
    ],
    [
      'too many attempts',
      () =>
        HttpResponse.json(
          { message: 'Too many requests. Please try again later.' },
          { status: 429 },
        ),
      'Too many sign-in attempts. Wait a moment, then try again.',
    ],
    [
      'a server error',
      () => new HttpResponse('Internal Server Error', { status: 500 }),
      "Signing in didn't work. Try again in a moment.",
    ],
    [
      'no answer at all',
      () => HttpResponse.error(),
      "Couldn't reach myli. Check your connection, then try again.",
    ],
  ])('says so after %s, and stays on the page', async (_, answer, message) => {
    const { router, user } = await renderLogin('/login', answer);

    await user.type(emailField(), 'ada@example.com');
    await user.type(passwordField(), 'correct horse battery staple');
    await user.click(signInButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(message);
    expect(router.currentRoute.value.path).toBe('/login');
    expect(emailField()).toHaveProperty('value', 'ada@example.com');
    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('sends one sign-in at a time, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    let signIns = 0;
    apiServer.use(
      http.get(`${AUTH_BASE_PATH}/get-session`, () => sessionResponse(null)),
      http.post(SIGN_IN_PATH, async () => {
        signIns += 1;
        await answered.promise;
        return HttpResponse.json(
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          { status: 401 },
        );
      }),
    );
    const { user } = await renderApp('/login', { answerSession: false });
    await user.type(emailField(), 'ada@example.com');
    await user.type(passwordField(), 'correct horse battery staple');

    await user.dblClick(signInButton());
    expect(signInButton().getAttribute('aria-disabled')).toBe('true');
    // Long enough for a second sign-in to be sent, if the second press had started one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    answered.resolve(undefined);

    await screen.findByText('Wrong email or password.');
    await waitFor(() => {
      expect(signInButton().getAttribute('aria-disabled')).toBeNull();
    });
    expect(signIns).toBe(1);
  });

  it('has no accessibility violations', async () => {
    await renderLogin();

    expect(await accessibilityViolations()).toEqual([]);
  });
});
