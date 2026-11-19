import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { focusManager } from '@tanstack/vue-query';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import {
  apiServer,
  describedBy,
  problemResponse,
  type RenderAppOptions,
  renderApp,
} from '@/testing.ts';

const TOKEN = 'k3Y-2b_Q9xLmT0vZpR7sWn4cHdA1eUiFgJ6oBy8tMqE';
const LINK = `/accept-invitation#${TOKEN}`;
const STRONG_PASSWORD = 'Correct horse battery 9';
const UNUSABLE = 'This invitation link is invalid, expired or already used. Ask for a new one.';
const INVITATION = {
  email: 'margaret@example.com',
  role: 'editor',
  expiresAt: '2026-11-22T15:30:00.000Z',
} as const;

const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const emailField = () => screen.getByRole('textbox', { name: 'Email' });
// Password inputs have no role.
const passwordField = () => screen.getByLabelText('Password');
const createButton = () => screen.getByRole('button', { name: 'Create account' });
const heading = () => screen.getByRole('heading', { level: 1, name: 'Accept invitation' });

/** Every request the page made, as `METHOD url`. */
const requests: string[] = [];
const recordRequest = ({ request }: { request: Request }) => {
  requests.push(`${request.method} ${request.url}`);
};
afterEach(() => {
  apiServer.events.removeListener('request:start', recordRequest);
  requests.length = 0;
});

interface Answers {
  lookup?: () => Response | Promise<Response>;
  accept?: () => Response | Promise<Response>;
}

/**
 * The accept-invitation page at `path`, the API answering the invitation's lookup and acceptance
 * with `answers`. No one is signed in unless `options` says otherwise. Returns the request bodies
 * of each.
 */
async function renderAccept(
  path = LINK,
  answers: Answers = {},
  options: RenderAppOptions = { signedInAs: null },
) {
  const lookups: unknown[] = [];
  const accepts: unknown[] = [];
  apiServer.events.on('request:start', recordRequest);
  apiServer.use(
    http.post('/api/v1/invitations/lookup', async ({ request }) => {
      lookups.push(await request.json());
      return (answers.lookup ?? (() => HttpResponse.json(INVITATION)))();
    }),
    http.post('/api/v1/invitations/accept', async ({ request }) => {
      accepts.push(await request.json());
      return (
        answers.accept ??
        (() =>
          HttpResponse.json(
            { user: { id: 'user-new', name: 'Margaret Hamilton', ...INVITATION } },
            { status: 201 },
          ))
      )();
    }),
  );
  const rendered = await renderApp(path, options);
  return { ...rendered, lookups, accepts };
}

/** Long enough for a request to be sent, if the page were going to send one. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Renders the page with a working link, and waits for its form. */
async function renderForm(answers: Answers = {}) {
  const rendered = await renderAccept(LINK, answers);
  await screen.findByRole('button', { name: 'Create account' });
  return rendered;
}

async function fillIn(user: Awaited<ReturnType<typeof renderAccept>>['user']) {
  await user.type(nameField(), 'Margaret Hamilton');
  await user.type(passwordField(), STRONG_PASSWORD);
}

describe('the accept-invitation page', () => {
  it('shows what the invitation is for, without the token in the address', async () => {
    const { router, lookups } = await renderForm();

    expect(
      screen.getByText(/You're invited to join myli as an editor\. Choose your name/),
    ).toBeDefined();
    const expiry = screen.getByText(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(
        new Date(INVITATION.expiresAt),
      ),
    );
    expect(expiry.tagName).toBe('TIME');
    expect(expiry.getAttribute('datetime')).toBe(INVITATION.expiresAt);
    expect(emailField()).toHaveProperty('value', 'margaret@example.com');
    expect(emailField()).toHaveProperty('readOnly', true);
    expect(describedBy(emailField())).toEqual([
      'Your account gets the address the invitation was sent to.',
    ]);

    // The token goes in the body, and is gone from the address.
    expect(lookups).toEqual([{ token: TOKEN }]);
    expect(router.currentRoute.value.fullPath).toBe('/accept-invitation');
    expect(requests.filter((request) => request.includes(TOKEN))).toEqual([]);
  });

  it('says it is checking the invitation while it is', async () => {
    const answered = Promise.withResolvers<undefined>();
    await renderAccept(LINK, {
      lookup: async () => {
        await answered.promise;
        return HttpResponse.json(INVITATION);
      },
    });

    expect((await screen.findByRole('status')).textContent.trim()).toBe(
      'Checking your invitation…',
    );
    answered.resolve(undefined);
    await screen.findByRole('button', { name: 'Create account' });
  });

  it('creates the account, then hands over to the sign-in page with the email filled in', async () => {
    const { router, queryClient, user, accepts } = await renderForm();

    await fillIn(user);
    await user.click(createButton());

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(accepts).toEqual([
      { token: TOKEN, name: 'Margaret Hamilton', password: STRONG_PASSWORD },
    ]);
    expect(emailField()).toHaveProperty('value', 'margaret@example.com');
    expect(
      screen.getByText('Your account is ready. Sign in with your email and password.'),
    ).toBeDefined();
    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(requests.filter((request) => request.includes(TOKEN))).toEqual([]);
    // Nothing keeps the token once the page is gone.
    await waitFor(() => {
      expect(queryClient.getQueryCache().findAll({ queryKey: ['invitation'] })).toEqual([]);
    });
  });

  it("doesn't look the invitation up again when they come back to the tab", async () => {
    const { lookups } = await renderForm();

    try {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await settle();
    } finally {
      focusManager.setFocused(undefined);
    }

    expect(lookups).toHaveLength(1);
  });

  it('checks the fields on submit, sends nothing, and moves focus to the first problem', async () => {
    const { user, accepts } = await renderForm();

    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(nameField());
    });
    expect(describedBy(nameField())).toEqual(['Enter a name.']);
    expect(describedBy(passwordField())[0]).toBe('Choose a password.');
    expect(accepts).toEqual([]);
  });

  it("says so when the link doesn't work, without a form", async () => {
    await renderAccept(LINK, { lookup: () => problemResponse(404, UNUSABLE) });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(UNUSABLE);
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says so when looking the invitation up fails, and tries again when asked', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { user, lookups } = await renderAccept(LINK, { lookup: () => answer() });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    // Retried twice before giving up, as every query is.
    expect(lookups).toHaveLength(3);

    // Still failing: they're told the new try happened, and stay on the button.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent.trim()).toBe(
        'Still not working. Try again in a moment.',
      );
    });
    expect(lookups).toHaveLength(6);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));

    answer = () => HttpResponse.json(INVITATION);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('button', { name: 'Create account' });
    // The button they pressed is gone, so focus starts on the page again.
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
    expect(lookups).toEqual(Array.from({ length: 7 }, () => ({ token: TOKEN })));
  });

  it('tries again once, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    let answer: () => Response | Promise<Response> = () => HttpResponse.error();
    const { user, lookups } = await renderAccept(LINK, { lookup: () => answer() });
    await screen.findByRole('button', { name: 'Try again' });
    answer = async () => {
      await answered.promise;
      return HttpResponse.json(INVITATION);
    };

    await user.dblClick(screen.getByRole('button', { name: 'Try again' }));
    expect(
      (await screen.findByRole('button', { name: 'Trying again…' })).getAttribute('aria-disabled'),
    ).toBe('true');
    await settle();
    answered.resolve(undefined);

    await screen.findByRole('button', { name: 'Create account' });
    // Three tries at first, then one more.
    expect(lookups).toHaveLength(4);
  });

  // Opened without one, or with one cut short, which the shared schema refuses.
  it('asks for the link again when opened with something that can’t be a token, and looks nothing up', async () => {
    const { router, lookups } = await renderAccept(`/accept-invitation#${'a'.repeat(201)}`);

    expect(
      screen.getByText(
        'This page needs the link from your invitation. Open that link again, exactly as you received it.',
      ),
    ).toBeDefined();
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/accept-invitation');
    });
    await settle();
    expect(lookups).toEqual([]);
  });

  it('tells someone signed in to sign out first, and looks nothing up', async () => {
    const { router, lookups } = await renderAccept(LINK, {}, { signedInAs: 'viewer' });

    expect(
      await screen.findByText(
        "You're signed in as Alan Turing. This invitation is for a new account: sign out, then open the invitation link again.",
      ),
    ).toBeDefined();
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/accept-invitation');
    });
    await settle();
    expect(lookups).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  });

  it('says so when the invitation stopped working before the account was created', async () => {
    const { user } = await renderForm({ accept: () => problemResponse(404, UNUSABLE) });

    await fillIn(user);
    await user.click(createButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(UNUSABLE);
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    // The button they pressed is gone, so focus starts on the page again.
    await waitFor(() => {
      expect(document.activeElement).toBe(heading());
    });
  });

  it('says so when the email already has an account, with a way to sign in', async () => {
    const { router, user } = await renderForm({
      accept: () => problemResponse(409, 'A user with this email already exists.'),
    });

    await fillIn(user);
    await user.click(createButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A user with this email already exists.');

    await user.click(within(alert).getByRole('link', { name: 'Go to sign-in' }));

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });

  it("shows the API's field errors next to their fields", async () => {
    const { user } = await renderForm({
      accept: () =>
        problemResponse(422, 'The request is invalid.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors: [{ in: 'body', pointer: '#/password', detail: 'That password is too common.' }],
        }),
    });

    await fillIn(user);
    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(passwordField());
    });
    expect(describedBy(passwordField())[0]).toBe('That password is too common.');
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('The request is invalid.')).toBeNull();
  });

  it('says so after a server error, keeping what was typed', async () => {
    const { router, user } = await renderForm({
      accept: () => problemResponse(500, 'Internal Server Error'),
    });

    await fillIn(user);
    await user.click(createButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(screen.queryByRole('link', { name: 'Go to sign-in' })).toBeNull();
    expect(router.currentRoute.value.fullPath).toBe('/accept-invitation');
    expect(nameField()).toHaveProperty('value', 'Margaret Hamilton');
  });

  it('creates one account at a time, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, accepts } = await renderForm({
      accept: async () => {
        await answered.promise;
        return problemResponse(500, 'Not now.');
      },
    });
    await fillIn(user);

    await user.dblClick(createButton());
    await settle();
    answered.resolve(undefined);

    await screen.findByRole('alert');
    await waitFor(() => {
      expect(createButton().getAttribute('aria-disabled')).toBeNull();
    });
    expect(accepts).toHaveLength(1);
  });
});
