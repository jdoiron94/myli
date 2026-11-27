import { screen } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiServer, renderApp } from '@/testing.ts';

function answerAvailability(emailEnabled: boolean) {
  apiServer.use(http.get('/api/v1/password-reset', () => HttpResponse.json({ emailEnabled })));
}

describe('ForgotPasswordPage', () => {
  it('opens from sign-in, and asks for a link to the address given, saying the same whatever happens', async () => {
    answerAvailability(true);
    const bodies: unknown[] = [];
    apiServer.use(
      http.post('/api/v1/password-reset', async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const { user } = await renderApp('/login', { signedInAs: null });

    await user.click(screen.getByRole('link', { name: 'Forgot your password?' }));
    await screen.findByRole('heading', { level: 1, name: 'Forgot your password?' });
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'Ada@Example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    const said = await screen.findByText(/^If ada@example\.com is the verified address/);
    expect(said.getAttribute('role')).toBe('status');
    expect(bodies).toEqual([{ email: 'ada@example.com' }]);
  });

  it('says to ask whoever runs myli when the server sends no email', async () => {
    answerAvailability(false);
    await renderApp('/forgot-password', { signedInAs: null });

    await screen.findByText(
      "This server doesn't send email. Ask whoever runs myli to make you a reset link.",
    );
    expect(screen.queryByRole('button', { name: 'Send reset link' })).toBeNull();
  });
});
