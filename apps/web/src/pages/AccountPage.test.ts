import { AUTH_BASE_PATH, IMAGE_MAX_BYTES, TOO_LARGE_DETAIL } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { emailVerificationQuery } from '@/account/email-verification.ts';
import { answerUploads, photoFile } from '@/recipes/testing.ts';
import {
  answerAvatar,
  apiServer,
  describedBy,
  problemResponse,
  renderApp,
  testUsers,
} from '@/testing.ts';

const { email } = testUsers.editor;
const SENT = `We sent a link to ${email}. Open it to verify your address.`;
const CHANGED = "Your password is changed. You've been signed out on your other devices.";
const sendButton = () => screen.queryByRole('button', { name: 'Send verification link' });
// Password inputs have no role.
const currentPassword = () => screen.getByLabelText('Current password');
const newPassword = () => screen.getByLabelText('New password', { exact: true });
const photoSection = () => screen.getByRole('region', { name: 'Profile photo' });
const accountButton = () =>
  screen.getByRole('button', { name: `Account: ${testUsers.editor.name}` });
/** The address of the photo in `element`, or `null` when it shows none. */
const photoIn = (element: HTMLElement) => element.querySelector('img')?.getAttribute('src') ?? null;

/** The photo section's file input, once it knows whether there's a photo. */
async function photoInput() {
  await within(photoSection()).findByRole('button', { name: /^(Upload|Change) photo$/ });
  const input = photoSection().querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  return input;
}

function answerVerification(answer: { verified: boolean; emailEnabled: boolean }) {
  apiServer.use(
    http.get('/api/v1/me/email-verification', () => HttpResponse.json({ email, ...answer })),
  );
}

/** Answers Better Auth's change-password route with `answer`, keeping the bodies sent. */
function answerChangePassword(answer: () => Response) {
  const bodies: unknown[] = [];
  apiServer.use(
    http.post(`${AUTH_BASE_PATH}/change-password`, async ({ request }) => {
      bodies.push(await request.json());
      return answer();
    }),
  );
  return bodies;
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

    expect((await screen.findByText(SENT)).getAttribute('role')).toBe('status');
    expect(sent).toBe(1);
  });

  it('explains why a link wasn’t sent', async () => {
    answerVerification({ verified: false, emailEnabled: true });
    const detail = 'A link was sent to you less than five minutes ago. Check your inbox.';
    apiServer.use(http.post('/api/v1/me/email-verification', () => problemResponse(429, detail)));
    const { user } = await renderApp('/account');

    await user.click(await screen.findByRole('button', { name: 'Send verification link' }));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(detail);
    expect(screen.queryByText(SENT)).toBeNull();
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

  it('changes the password with the current one, and clears the form', async () => {
    answerVerification({ verified: true, emailEnabled: true });
    const bodies = answerChangePassword(() => HttpResponse.json({ token: 'new', user: {} }));
    const { user } = await renderApp('/account');

    await user.type(currentPassword(), 'Correct horse battery 9');
    await user.type(newPassword(), 'An even better passphrase 2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect((await screen.findByText(CHANGED)).getAttribute('role')).toBe('status');
    expect(bodies).toEqual([
      {
        currentPassword: 'Correct horse battery 9',
        newPassword: 'An even better passphrase 2',
        revokeOtherSessions: true,
      },
    ]);
    expect(currentPassword()).toHaveProperty('value', '');
    expect(newPassword()).toHaveProperty('value', '');
  });

  it('shows a wrong current password at its field, and moves focus there', async () => {
    answerVerification({ verified: true, emailEnabled: true });
    answerChangePassword(() =>
      HttpResponse.json({ code: 'INVALID_PASSWORD', message: 'Invalid password' }, { status: 400 }),
    );
    const { user } = await renderApp('/account');

    await user.type(currentPassword(), 'Not my password at all 1');
    await user.type(newPassword(), 'An even better passphrase 2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(currentPassword());
    });
    expect(describedBy(currentPassword())).toEqual(["That isn't your current password."]);
    expect(screen.queryByText(CHANGED)).toBeNull();
  });

  it('uploads a photo, which then shows here and in the header', async () => {
    answerVerification({ verified: true, emailEnabled: true });
    answerUploads();
    const chosen: unknown[] = [];
    apiServer.use(
      http.put('/api/v1/me/avatar', async ({ request }) => {
        chosen.push(await request.json());
        return HttpResponse.json({ avatar: { id: 'upload-1', width: 320 } });
      }),
    );
    const { user } = await renderApp('/account');

    await user.upload(await photoInput(), photoFile('me.jpg'));

    const changed = await screen.findByText('Your profile photo is changed.');
    expect(changed.getAttribute('role')).toBe('status');
    expect(chosen).toEqual([{ imageId: 'upload-1' }]);
    expect({ page: photoIn(photoSection()), header: photoIn(accountButton()) }).toEqual({
      page: '/api/v1/images/upload-1/320',
      header: '/api/v1/images/upload-1/320',
    });
    expect(within(photoSection()).getByRole('button', { name: 'Change photo' })).toBeDefined();
  });

  it('refuses a photo the API would, without sending it', async () => {
    answerVerification({ verified: true, emailEnabled: true });
    const sent = answerUploads();
    const { user } = await renderApp('/account');

    await user.upload(await photoInput(), photoFile('huge.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(TOO_LARGE_DETAIL);
    expect(sent).toEqual([]);
  });

  it('removes the photo, leaving the initials, with focus on the picker', async () => {
    answerVerification({ verified: true, emailEnabled: true });
    answerAvatar({ id: 'photo-1', width: 640 });
    let removed = 0;
    apiServer.use(
      http.delete('/api/v1/me/avatar', () => {
        removed += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = await renderApp('/account');

    await user.click(await within(photoSection()).findByRole('button', { name: 'Remove photo' }));

    await screen.findByText('Your profile photo is removed. Your initials show instead.');
    expect(removed).toBe(1);
    expect(document.activeElement).toBe(
      within(photoSection()).getByRole('button', { name: 'Upload photo' }),
    );
    expect({ page: photoIn(photoSection()), header: photoIn(accountButton()) }).toEqual({
      page: null,
      header: null,
    });
    // Ada Lovelace's, drawn by CSS.
    expect(photoSection().querySelector('[data-initials]')?.getAttribute('data-initials')).toBe(
      'AL',
    );
  });
});
