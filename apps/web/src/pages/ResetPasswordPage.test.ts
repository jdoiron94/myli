import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { accessibilityViolations, apiServer, problemResponse, renderApp } from '@/testing.ts';

const TOKEN = 'k3Y-2b_Q9xLmT0vZpR7sWn4cHdA1eUiFgJ6oBy8tMqE';
const NEW_PASSWORD = 'An even better passphrase 2';
// Password inputs have no role.
const newPassword = () => screen.getByLabelText('New password', { exact: true });

/** Answers the reset with `answer`, keeping the bodies sent. */
function answerReset(answer: () => Response) {
  const bodies: unknown[] = [];
  apiServer.use(
    http.post('/api/v1/password-reset/confirm', async ({ request }) => {
      bodies.push(await request.json());
      return answer();
    }),
  );
  return bodies;
}

describe('ResetPasswordPage', () => {
  it('sets the password with the link’s token, then goes to sign in, signed out here', async () => {
    const bodies = answerReset(() => HttpResponse.json({ email: 'katherine@example.com' }));
    // Someone was signed in here: the reset ended their session if it was theirs.
    const { user, router } = await renderApp(`/reset-password#${TOKEN}`, { signedInAs: 'editor' });
    await waitFor(() => {
      expect(router.currentRoute.value.hash).toBe('');
    });

    await user.type(newPassword(), NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(
      screen.getByText(
        "Your password is reset, and you've been signed out everywhere. Sign in with your new password.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveProperty(
      'value',
      'katherine@example.com',
    );
    expect(bodies).toEqual([{ token: TOKEN, newPassword: NEW_PASSWORD }]);
  });

  it('says when the link doesn’t work any more, offers a new one, and starts them on the page again', async () => {
    const detail = 'This reset link is invalid, expired or already used.';
    answerReset(() => problemResponse(404, detail));
    const { user } = await renderApp(`/reset-password#${TOKEN}`, { signedInAs: null });

    await user.type(newPassword(), NEW_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(detail);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Reset your password' }),
    );
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeTruthy();
    // The journey's link always works.
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('asks for the link when opened without one', async () => {
    await renderApp('/reset-password', { signedInAs: null });

    expect(
      screen.getByText(
        'This page needs a reset link. Open the link again, exactly as you received it.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull();
  });
});
