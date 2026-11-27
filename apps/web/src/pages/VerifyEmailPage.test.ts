import { screen } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { accessibilityViolations, apiServer, problemResponse, renderApp } from '@/testing.ts';

const TOKEN = 'k3Y-2b_Q9xLmT0vZpR7sWn4cHdA1eUiFgJ6oBy8tMqE';
const VERIFIED = 'Your address ada@example.com is verified.';

/** Answers the link's confirmation with each of `answers` in turn, keeping the bodies sent. */
function answerConfirm(...answers: (() => Response)[]) {
  const bodies: unknown[] = [];
  apiServer.use(
    http.post('/api/v1/email-verification/confirm', async ({ request }) => {
      bodies.push(await request.json());
      return (
        answers[bodies.length - 1] ?? (() => HttpResponse.json({ email: 'ada@example.com' }))
      )();
    }),
  );
  return bodies;
}

describe('VerifyEmailPage', () => {
  it('verifies the address with the token in the body, and takes it out of the address', async () => {
    const bodies = answerConfirm();
    const { router } = await renderApp(`/verify-email#${TOKEN}`, { signedInAs: null });

    expect((await screen.findByText(VERIFIED)).getAttribute('role')).toBe('status');
    expect(bodies).toEqual([{ token: TOKEN }]);
    expect(router.currentRoute.value.hash).toBe('');
    expect(screen.getByRole('link', { name: 'Go to your account' })).toBeTruthy();
    // The journey never opens a verification link: it runs without email.
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('says why a link doesn’t work any more, as the API explains', async () => {
    const detail = 'This verification link is invalid, expired or already used.';
    answerConfirm(() => problemResponse(404, detail));
    await renderApp(`/verify-email#${TOKEN}`, { signedInAs: null });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(detail);
  });

  it('asks for the link when opened without one, sending nothing', async () => {
    await renderApp('/verify-email', { signedInAs: null });

    expect(
      screen.getByText(
        'This page needs the link from your email. Open that link again, exactly as you received it.',
      ),
    ).toBeTruthy();
  });

  it('tries again when asked after a failure, and verifies then', async () => {
    const bodies = answerConfirm(() => problemResponse(503, 'Unavailable'));
    const { user } = await renderApp(`/verify-email#${TOKEN}`, { signedInAs: null });

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await screen.findByText(VERIFIED);
    expect(bodies).toEqual([{ token: TOKEN }, { token: TOKEN }]);
  });
});
