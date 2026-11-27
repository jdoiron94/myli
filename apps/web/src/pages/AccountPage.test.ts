import { screen, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { emailVerificationQuery } from '@/account/email-verification.ts';
import { apiServer, problemResponse, renderApp, testUsers } from '@/testing.ts';

const { email } = testUsers.editor;
const sendButton = () => screen.queryByRole('button', { name: 'Send verification link' });
const status = () => screen.getByRole('status');

function answerVerification(answer: { verified: boolean; emailEnabled: boolean }) {
  apiServer.use(
    http.get('/api/v1/me/email-verification', () => HttpResponse.json({ email, ...answer })),
  );
}

describe('AccountPage', () => {
  it('sends a link to an unverified address, and says where it went', async () => {
    answerVerification({ verified: false, emailEnabled: true });
    let sent = 0;
    apiServer.use(
      http.post('/api/v1/me/email-verification', () => {
        sent += 1;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const { user } = await renderApp('/account');

    await screen.findByText('Not verified');
    await user.click(screen.getByRole('button', { name: 'Send verification link' }));

    await within(status()).findByText(`We sent a link to ${email}.`, { exact: false });
    expect(sent).toBe(1);
  });

  it('explains why a link wasn’t sent', async () => {
    answerVerification({ verified: false, emailEnabled: true });
    const detail = 'A link was sent to you less than five minutes ago. Check your inbox.';
    apiServer.use(http.post('/api/v1/me/email-verification', () => problemResponse(429, detail)));
    const { user } = await renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Send verification link' }));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(detail);
    expect(status().textContent.trim()).toBe('');
  });

  it('offers no link for a verified address, nor when the server sends no email', async () => {
    answerVerification({ verified: false, emailEnabled: false });
    const { queryClient } = await renderApp('/account');

    await screen.findByText("This server doesn't send email, so your address can't be verified.");
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(sendButton()).toBeNull();

    queryClient.setQueryData(emailVerificationQuery.queryKey, {
      email,
      verified: true,
      emailEnabled: true,
    });
    await screen.findByText('Verified');
    expect(sendButton()).toBeNull();
  });
});
