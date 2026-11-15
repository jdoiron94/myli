import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  accessibilityViolations,
  apiServer,
  describedBy,
  describedElements,
  listItems,
  problemResponse,
  renderApp,
} from '@/testing.ts';

const STRONG_PASSWORD = 'Correct horse battery 9';

const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const emailField = () => screen.getByRole('textbox', { name: 'Email' });
// Password inputs have no role.
const passwordField = () => screen.getByLabelText('Password');
const showPassword = () => screen.getByRole('button', { name: 'Show password' });
const createButton = () => screen.getByRole('button', { name: 'Create admin account' });

/**
 * The setup page, with no user yet, and the API answering `POST /setup` with `answer`. Returns the
 * request bodies it was sent, and how many times the router asked whether setup is needed.
 */
async function renderSetup(answer: () => Response = () => HttpResponse.json({}, { status: 201 })) {
  let done = false;
  const setups: unknown[] = [];
  const asked = { count: 0 };
  apiServer.use(
    http.get('/api/v1/setup', () => {
      asked.count += 1;
      return HttpResponse.json({ needed: !done });
    }),
    http.post('/api/v1/setup', async ({ request }) => {
      setups.push(await request.json());
      const response = answer();
      done = response.ok;
      return response;
    }),
  );
  const rendered = await renderApp('/setup', { signedInAs: null });
  await screen.findByRole('heading', { level: 1, name: 'Set up myli' });
  return { ...rendered, setups, asked };
}

async function fillIn(user: Awaited<ReturnType<typeof renderSetup>>['user']) {
  await user.type(nameField(), 'Grace Hopper');
  await user.type(emailField(), 'Grace@Example.com');
  await user.type(passwordField(), STRONG_PASSWORD);
}

describe('the setup page', () => {
  it('creates the first admin, then hands over to the sign-in page with the email filled in', async () => {
    const { router, user, setups, asked } = await renderSetup();

    await fillIn(user);
    await user.click(createButton());

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(setups).toEqual([
      { name: 'Grace Hopper', email: 'grace@example.com', password: STRONG_PASSWORD },
    ]);
    expect(emailField()).toHaveProperty('value', 'grace@example.com');
    expect(
      screen.getByText('Your admin account is ready. Sign in with its email and password.'),
    ).toBeDefined();
    // Not in the address, where it would end up in server logs.
    expect(router.currentRoute.value.fullPath).toBe('/login');
    // Setup can't be needed again, so the router doesn't ask any more.
    expect(asked.count).toBe(1);
  });

  it('checks the fields on submit, sends nothing, and moves focus to the first problem', async () => {
    const { user, setups } = await renderSetup();

    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(nameField());
    });
    expect(describedBy(nameField())).toEqual(['Enter a name.']);
    expect(describedBy(emailField())).toEqual(['Enter a valid email address.']);
    expect(describedBy(passwordField())[0]).toBe('Choose a password.');
    expect(setups).toEqual([]);
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('lists the password rules, marking each one met as the password is typed', async () => {
    const { user } = await renderSetup();
    // The rules are what the input points to last.
    const rules = () => listItems(describedElements(passwordField()).at(-1));

    expect(rules()).toEqual([
      'At least 15 characters: not yet',
      'A lowercase letter: not yet',
      'An uppercase letter: not yet',
      'A number: not yet',
      'A special character: anything but a letter or a number, a space included: not yet',
    ]);

    await user.type(passwordField(), 'Abc 1');

    expect(rules()).toEqual([
      'At least 15 characters: not yet',
      'A lowercase letter: done',
      'An uppercase letter: done',
      'A number: done',
      'A special character: anything but a letter or a number, a space included: done',
    ]);
    // Screen readers hear the rules with the input.
    expect(describedBy(passwordField())).toEqual([
      expect.stringMatching(/^It needs: At least 15 characters: not yet/),
    ]);
  });

  it('says which rules a password breaks when it is submitted', async () => {
    const { user, setups } = await renderSetup();
    await user.type(nameField(), 'Grace Hopper');
    await user.type(emailField(), 'grace@example.com');
    await user.type(passwordField(), 'correct horse battery');

    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(passwordField());
    });
    expect(listItems(describedElements(passwordField())[0])).toEqual([
      'Must contain an uppercase letter.',
      'Must contain a number.',
    ]);
    expect(setups).toEqual([]);

    // Each rule's error goes as soon as it's met, and the field is valid once all are.
    await user.type(passwordField(), ' 9');
    await waitFor(() => {
      expect(describedBy(passwordField())[0]).toBe('Must contain an uppercase letter.');
    });
    await user.clear(passwordField());
    await user.type(passwordField(), STRONG_PASSWORD);
    await waitFor(() => {
      expect(passwordField().getAttribute('aria-invalid')).toBeNull();
    });
    expect(describedElements(passwordField())).toHaveLength(1);
  });

  it('shows what is typed in the password field when asked, and hides it again', async () => {
    const { user } = await renderSetup();
    expect(passwordField().getAttribute('type')).toBe('password');
    expect(showPassword().getAttribute('aria-pressed')).toBe('false');

    await user.click(showPassword());

    expect(passwordField().getAttribute('type')).toBe('text');
    expect(showPassword().getAttribute('aria-pressed')).toBe('true');

    await user.click(showPassword());

    expect(passwordField().getAttribute('type')).toBe('password');
  });

  it("shows the API's field errors next to their fields", async () => {
    const { user } = await renderSetup(() =>
      problemResponse(422, 'The request is invalid.', {
        type: VALIDATION_PROBLEM_TYPE,
        errors: [
          { in: 'body', pointer: '#/email', detail: 'That email is not allowed.' },
          { in: 'body', pointer: '#/password', detail: 'That password is too common.' },
        ],
      }),
    );

    await fillIn(user);
    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(describedBy(emailField())).toEqual(['That email is not allowed.']);
    expect(describedBy(passwordField())[0]).toBe('That password is too common.');
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('The request is invalid.')).toBeNull();
  });

  it('says so when someone else finished setup first, with a way to sign in', async () => {
    const { router, user } = await renderSetup(() =>
      problemResponse(409, 'Setup is already complete. Sign in instead.'),
    );
    apiServer.use(http.get('/api/v1/setup', () => HttpResponse.json({ needed: false })));

    await fillIn(user);
    await user.click(createButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Setup is already complete. Sign in instead.');
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(within(alert).getByRole('link', { name: 'Go to sign-in' }));

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });

  it.each([
    [
      'a server error',
      () => problemResponse(500, 'Internal Server Error'),
      "Something went wrong on myli's server. Try again in a moment.",
    ],
    [
      'no answer at all',
      () => HttpResponse.error(),
      "Couldn't reach myli. Check your connection, then try again.",
    ],
  ])('says so after %s, keeping what was typed', async (_, answer, message) => {
    const { router, user } = await renderSetup(answer);

    await fillIn(user);
    await user.click(createButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(message);
    expect(screen.queryByRole('link', { name: 'Go to sign-in' })).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/setup');
    expect(nameField()).toHaveProperty('value', 'Grace Hopper');
  });

  it('sends one setup at a time, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, setups } = await renderSetup(() => problemResponse(500, 'Not now.'));
    apiServer.use(
      http.post('/api/v1/setup', async ({ request }) => {
        setups.push(await request.json());
        await answered.promise;
        return problemResponse(500, 'Not now.');
      }),
    );
    await fillIn(user);

    await user.dblClick(createButton());
    // Long enough for a second setup to be sent, if the second press had started one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    answered.resolve(undefined);

    await screen.findByRole('alert');
    await waitFor(() => {
      expect(createButton().getAttribute('aria-disabled')).toBeNull();
    });
    expect(setups).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const { user } = await renderSetup();
    await user.type(passwordField(), 'Abc 1');

    expect(await accessibilityViolations()).toEqual([]);
  });
});
