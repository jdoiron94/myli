import { type Role, VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { Invitation } from '@/admin/invitations.ts';
import { ROLE_DESCRIPTIONS } from '@/lib/roles.ts';
import { apiServer, describedBy, problemResponse, renderApp } from '@/testing.ts';

const KATHERINE: Invitation = {
  id: 'invitation-2',
  email: 'katherine@example.com',
  role: 'viewer',
  status: 'pending',
  expiresAt: '2026-11-22T15:30:00.000Z',
  createdAt: '2026-11-15T15:30:00.000Z',
};
const MARGARET: Invitation = {
  id: 'invitation-1',
  email: 'margaret@example.com',
  role: 'editor',
  status: 'expired',
  expiresAt: '2026-11-08T09:00:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
};
const NEW_EXPIRY = '2026-11-23T10:00:00.000Z';
const LINK = 'http://localhost:5173/accept-invitation#new-token';
const NOT_OPEN = 'No open invitation has this ID. It may have been accepted or revoked.';

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });
const format = (format: Intl.DateTimeFormat, iso: string) => format.format(new Date(iso));

/** An answer in place of the fake API's own, which it falls back to when this gives none. */
type Answer = (
  store: Invitation[],
  id: string,
) => Response | undefined | Promise<Response | undefined>;

interface FakeApiOptions {
  /** Replaces the fake API's answer to each request. */
  list?: () => Response | Promise<Response>;
  invite?: Answer;
  resend?: Answer;
  revoke?: Answer;
  /** Whether myli emails links (SMTP is set up), so the answers have no `link`. */
  emails?: boolean;
}

/**
 * The invitations page, as an admin, with a fake API that keeps a list of invitations: inviting adds
 * one, resending gives one a new expiry, and revoking removes one. Returns the list, and what each
 * request sent.
 */
async function renderInvitations(options: FakeApiOptions = {}) {
  const store: Invitation[] = [{ ...KATHERINE }, { ...MARGARET }];
  const sent = {
    lists: 0,
    invites: [] as unknown[],
    resends: [] as string[],
    revokes: [] as string[],
  };
  const withLink = (invitation: Invitation) =>
    options.emails ? { invitation } : { invitation, link: LINK };
  apiServer.use(
    http.get('/api/v1/invitations', () => {
      sent.lists += 1;
      return options.list?.() ?? HttpResponse.json({ invitations: store });
    }),
    http.post('/api/v1/invitations', async ({ request }) => {
      const body = (await request.json()) as { email: string; role: Role };
      sent.invites.push(body);
      const answer = await options.invite?.(store, '');
      if (answer) return answer;
      const invitation: Invitation = {
        id: `invitation-${String(store.length + 1)}`,
        ...body,
        status: 'pending',
        expiresAt: NEW_EXPIRY,
        createdAt: '2026-11-16T10:00:00.000Z',
      };
      store.unshift(invitation);
      return HttpResponse.json(withLink(invitation), { status: 201 });
    }),
    http.post<{ id: string }>('/api/v1/invitations/:id/resend', async ({ params: { id } }) => {
      sent.resends.push(id);
      const answer = await options.resend?.(store, id);
      if (answer) return answer;
      const invitation = store.find((candidate) => candidate.id === id);
      if (!invitation) return problemResponse(404, NOT_OPEN);
      Object.assign(invitation, { status: 'pending', expiresAt: NEW_EXPIRY });
      return HttpResponse.json(withLink(invitation));
    }),
    http.post<{ id: string }>('/api/v1/invitations/:id/revoke', async ({ params: { id } }) => {
      sent.revokes.push(id);
      const answer = await options.revoke?.(store, id);
      if (answer) return answer;
      const index = store.findIndex((candidate) => candidate.id === id);
      if (index === -1) return problemResponse(404, NOT_OPEN);
      store.splice(index, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const rendered = await renderApp('/admin/invitations', { signedInAs: 'admin' });
  return { ...rendered, store, sent };
}

const table = () => screen.findByRole('table', { name: 'Open invitations' });
const listHeading = () => screen.getByRole('heading', { level: 2, name: 'Open invitations' });
const emailField = () => screen.getByRole('textbox', { name: 'Email' });
const inviteButton = () => screen.getByRole('button', { name: 'Invite' });
const linkField = () => screen.getByRole('textbox', { name: 'Invitation link' });
const resendButton = (email: string) =>
  screen.getByRole('button', { name: `Resend invitation to ${email}` });
const revokeButton = (email: string) =>
  screen.getByRole('button', { name: `Revoke invitation for ${email}` });
const dialog = () =>
  screen.findByRole('alertdialog', { name: 'Revoke the invitation for katherine@example.com?' });
/** The page's own notices: emailed, sent again, revoked. */
const notice = () => screen.getByText(/^(Invitation emailed|Invitation sent again|Revoked)/);
/** Long enough for a second request to be sent, if a second press had started one. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** The text of each row's cells, header row included, without the buttons. */
async function tableText() {
  return within(await table())
    .getAllByRole('row')
    .map((row) =>
      [...row.querySelectorAll('th, td')].slice(0, 4).map((cell) => cell.textContent.trim()),
    );
}

const emails = async () => (await tableText()).slice(1).map(([email]) => email);

describe('the invitations page', () => {
  it('lists the open invitations as the API gives them, newest first', async () => {
    await renderInvitations();

    expect(await tableText()).toEqual([
      ['Email', 'Role', 'Status', 'Expires'],
      ['katherine@example.com', 'Viewer', 'Pending', format(shortDate, '2026-11-22T15:30:00.000Z')],
      ['margaret@example.com', 'Editor', 'Expired', format(shortDate, '2026-11-08T09:00:00.000Z')],
    ]);
    expect(document.title).toBe('Invitations · myli');
    const expiry = screen.getByText(format(shortDate, '2026-11-22T15:30:00.000Z'));
    expect(expiry.tagName).toBe('TIME');
    expect(expiry.getAttribute('datetime')).toBe('2026-11-22T15:30:00.000Z');
  });

  it('says when there are none', async () => {
    await renderInvitations({ list: () => HttpResponse.json({ invitations: [] }) });

    expect(await screen.findByText('No open invitations.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it is loading them while it is', async () => {
    const answered = Promise.withResolvers<undefined>();
    await renderInvitations({
      list: async () => {
        await answered.promise;
        return HttpResponse.json({ invitations: [] });
      },
    });

    expect(screen.getByText('Loading invitations…').getAttribute('role')).toBe('status');
    answered.resolve(undefined);
    await screen.findByText('No open invitations.');
  });

  it('says so when they could not be loaded, and tries again when asked', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { user, sent } = await renderInvitations({ list: () => answer() });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    // Retried twice before giving up, as every query is.
    expect(sent.lists).toBe(3);

    // Still failing: they're told the new try happened, and stay on the button.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const stillFailing = await screen.findByText('Still not working. Try again in a moment.');
    expect(stillFailing.getAttribute('role')).toBe('status');
    expect(sent.lists).toBe(6);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));

    answer = () => HttpResponse.json({ invitations: [KATHERINE] });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await table();
    // The button they pressed is gone, so focus starts on the page again.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Invitations' }),
      );
    });
  });

  it('leaves focus alone when the failure clears up without them pressing the button', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { queryClient } = await renderInvitations({ list: () => answer() });
    await screen.findByRole('alert');
    const themeButton = screen.getByRole('button', { name: 'Theme' });
    themeButton.focus();

    answer = () => HttpResponse.json({ invitations: [KATHERINE] });
    await queryClient.refetchQueries({ queryKey: ['invitations'] });

    await table();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(themeButton);
  });

  it("shows the API's reason when it refuses", async () => {
    const { router } = await renderInvitations({
      list: () => problemResponse(403, "You don't have permission to do this."),
    });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "You don't have permission to do this.",
    );
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations');
  });
});

describe('inviting someone', () => {
  it('offers each role with what it can do, least access first and chosen', async () => {
    await renderInvitations();

    const roles = within(screen.getByRole('group', { name: 'Role' }));
    expect(roles.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      const name = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' }[role];
      expect(describedBy(roles.getByRole('radio', { name }))).toEqual([ROLE_DESCRIPTIONS[role]]);
    }
  });

  it('shows the link once when myli does not email it, ready to copy', async () => {
    const { user, sent } = await renderInvitations();
    await table();

    await user.type(emailField(), 'Dorothy@Example.com');
    await user.click(screen.getByRole('radio', { name: 'Editor' }));
    await user.click(inviteButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    expect(sent.invites).toEqual([{ email: 'dorothy@example.com', role: 'editor' }]);
    expect(linkField()).toHaveProperty('value', LINK);
    expect(linkField()).toHaveProperty('readOnly', true);
    // Selected, to copy with the keyboard.
    expect(linkField()).toHaveProperty('selectionStart', 0);
    expect(linkField()).toHaveProperty('selectionEnd', LINK.length);
    expect(describedBy(linkField())).toEqual([
      `Share this link with dorothy@example.com. It's shown only once, and works until ${format(longDate, NEW_EXPIRY)}.`,
    ]);
    // The list has the new invitation, and the form is ready for the next one.
    await waitFor(async () => {
      expect(await emails()).toEqual([
        'dorothy@example.com',
        'katherine@example.com',
        'margaret@example.com',
      ]);
    });
    expect(emailField()).toHaveProperty('value', '');
    expect(screen.getByRole('radio', { name: 'Viewer' }).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await navigator.clipboard.readText()).toBe(LINK);
    expect(screen.getByText('Copied.').getAttribute('role')).toBe('status');
  });

  it("selects the link to copy by hand when the clipboard can't be used", async () => {
    const { user } = await renderInvitations();
    await user.type(emailField(), 'dorothy@example.com');
    await user.click(inviteButton());
    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Not allowed'));

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(
      await screen.findByText(
        "Couldn't copy it. The link is selected: copy it with Ctrl+C, or ⌘C on a Mac.",
      ),
    ).toBeDefined();
    expect(document.activeElement).toBe(linkField());
    expect(linkField()).toHaveProperty('selectionEnd', LINK.length);
  });

  it('says the invitation was emailed when myli emails it', async () => {
    const { user } = await renderInvitations({ emails: true });
    await table();

    await user.type(emailField(), 'dorothy@example.com');
    await user.click(inviteButton());

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Invitation emailed to dorothy@example.com.');
    });
    expect(notice().getAttribute('role')).toBe('status');
    expect(screen.queryByRole('textbox', { name: 'Invitation link' })).toBeNull();
    expect(document.activeElement).toBe(inviteButton());
  });

  it('checks the email on submit, sends nothing, and moves focus to it', async () => {
    const { user, sent } = await renderInvitations();

    await user.click(inviteButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(describedBy(emailField())).toEqual(['Enter a valid email address.']);
    expect(sent.invites).toEqual([]);
  });

  it('shows next to the email when it already has an account or an invitation', async () => {
    const { user } = await renderInvitations({
      invite: () => problemResponse(409, 'This email already has an open invitation.'),
    });

    await user.type(emailField(), 'katherine@example.com');
    await user.click(inviteButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(describedBy(emailField())).toEqual(['This email already has an open invitation.']);
    expect(screen.queryByRole('textbox', { name: 'Invitation link' })).toBeNull();
  });

  it("shows the API's field errors next to their fields", async () => {
    const { user } = await renderInvitations({
      invite: () =>
        problemResponse(422, 'The request is invalid.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors: [{ in: 'body', pointer: '#/email', detail: 'That domain is not allowed.' }],
        }),
    });

    await user.type(emailField(), 'dorothy@example.com');
    await user.click(inviteButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(emailField());
    });
    expect(describedBy(emailField())).toEqual(['That domain is not allowed.']);
  });

  it('says so after a server error, keeping what was typed', async () => {
    const { user } = await renderInvitations({
      invite: () => problemResponse(500, 'Internal Server Error'),
    });

    await user.type(emailField(), 'dorothy@example.com');
    await user.click(inviteButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(emailField()).toHaveProperty('value', 'dorothy@example.com');
  });

  it('sends one invitation at a time, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderInvitations({
      invite: async () => {
        await answered.promise;
        return problemResponse(500, 'Not now.');
      },
    });
    await user.type(emailField(), 'dorothy@example.com');

    await user.dblClick(inviteButton());
    await settle();
    answered.resolve(undefined);

    await screen.findByRole('alert');
    expect(sent.invites).toHaveLength(1);
  });
});

describe('resending an invitation', () => {
  it('shows the new link when myli does not email it, and updates the list', async () => {
    const { user, sent } = await renderInvitations();
    await table();

    await user.click(resendButton('margaret@example.com'));

    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    expect(sent.resends).toEqual(['invitation-1']);
    expect(linkField()).toHaveProperty('value', LINK);
    expect(describedBy(linkField())[0]).toMatch(
      /^Here's the new link for margaret@example\.com\. Their earlier link no longer works\./,
    );
    await waitFor(async () => {
      expect((await tableText())[2]).toEqual([
        'margaret@example.com',
        'Editor',
        'Pending',
        format(shortDate, NEW_EXPIRY),
      ]);
    });
  });

  it('says it was sent again when myli emails it, leaving focus on the button', async () => {
    const { user } = await renderInvitations({ emails: true });
    await table();

    await user.click(resendButton('margaret@example.com'));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Invitation sent again to margaret@example.com.');
    });
    expect(document.activeElement).toBe(resendButton('margaret@example.com'));
  });

  it('says so when the invitation is no longer open, and takes it off the list', async () => {
    const { user } = await renderInvitations({
      resend: (store, id) => {
        // Accepted a moment ago.
        store.splice(
          store.findIndex((candidate) => candidate.id === id),
          1,
        );
        return problemResponse(404, NOT_OPEN);
      },
    });
    await table();

    await user.click(resendButton('margaret@example.com'));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(NOT_OPEN);
    expect(await emails()).toEqual(['katherine@example.com']);
    // The button they pressed went with its row.
    await waitFor(() => {
      expect(document.activeElement).toBe(listHeading());
    });
  });

  it('resends once, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderInvitations({
      resend: async () => {
        await answered.promise;
        return problemResponse(500, 'Not now.');
      },
    });
    await table();

    await user.dblClick(resendButton('margaret@example.com'));
    await settle();
    answered.resolve(undefined);

    await screen.findByRole('alert');
    expect(sent.resends).toHaveLength(1);
  });
});

describe('revoking an invitation', () => {
  it('asks first, then takes it off the list', async () => {
    const { user, sent } = await renderInvitations();
    await table();

    await user.click(revokeButton('katherine@example.com'));

    const confirm = await dialog();
    expect(confirm.textContent).toContain(
      'Their link stops working. You can invite this email again later.',
    );
    expect(sent.revokes).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Revoked the invitation for katherine@example.com.');
    });
    expect(sent.revokes).toEqual(['invitation-2']);
    expect(await emails()).toEqual(['margaret@example.com']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The button they pressed went with its row.
    await waitFor(() => {
      expect(document.activeElement).toBe(listHeading());
    });
  });

  it('does nothing when they cancel, and goes back to the button', async () => {
    const { user, sent } = await renderInvitations();
    await table();

    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(document.activeElement).toBe(revokeButton('katherine@example.com'));
    expect(sent.revokes).toEqual([]);
  });

  it('removes the link shown for that invitation, which no longer works', async () => {
    const { user } = await renderInvitations();
    await table();
    await user.click(resendButton('katherine@example.com'));
    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });

    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Invitation link' })).toBeNull();
    });
  });

  it('keeps a link shown for another invitation', async () => {
    const { user } = await renderInvitations();
    await table();
    await user.click(resendButton('margaret@example.com'));
    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });

    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Revoked the invitation for katherine@example.com.');
    });
    expect(linkField()).toHaveProperty('value', LINK);
  });

  it('says so when revoking failed, leaving the invitation listed', async () => {
    const { user } = await renderInvitations({
      revoke: () => problemResponse(500, 'Internal Server Error'),
    });
    await table();

    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(await emails()).toEqual(['katherine@example.com', 'margaret@example.com']);
    expect(document.activeElement).toBe(revokeButton('katherine@example.com'));
  });

  it('revokes once, even when confirmed again while the first is under way', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderInvitations({
      revoke: async () => {
        await answered.promise;
        return undefined;
      },
    });
    await table();

    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));
    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));
    await settle();
    answered.resolve(undefined);

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Revoked the invitation for katherine@example.com.');
    });
    expect(sent.revokes).toHaveLength(1);
  });
});

describe('what the page says after a change', () => {
  it('replaces a link with the notice when the next one was emailed', async () => {
    const options: FakeApiOptions = {};
    const { user } = await renderInvitations(options);
    await table();
    await user.click(resendButton('margaret@example.com'));
    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    // SMTP was set up meanwhile, and the API restarted.
    options.emails = true;

    await user.click(resendButton('katherine@example.com'));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Invitation sent again to katherine@example.com.');
    });
    expect(screen.queryByRole('textbox', { name: 'Invitation link' })).toBeNull();
  });

  it('replaces a notice with the next link', async () => {
    const { user } = await renderInvitations();
    await table();
    await user.click(revokeButton('katherine@example.com'));
    await user.click(within(await dialog()).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Revoked the invitation for katherine@example.com.');
    });

    await user.click(resendButton('margaret@example.com'));

    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    expect(screen.queryByText(/^Revoked/)).toBeNull();
  });

  /** Fails a resend, does `change`, and checks the failure is gone. */
  async function failThen(
    change: (user: Awaited<ReturnType<typeof renderInvitations>>['user']) => Promise<void>,
  ) {
    let resends = 0;
    const { user } = await renderInvitations({
      resend: () => {
        resends += 1;
        return resends === 1 ? problemResponse(500, 'Internal Server Error') : undefined;
      },
    });
    await table();
    await user.click(resendButton('margaret@example.com'));
    await screen.findByRole('alert');

    await change(user);

    await waitFor(() => {
      expect(document.activeElement).toBe(linkField());
    });
    expect(screen.queryByRole('alert')).toBeNull();
  }

  it('drops the last failure once resending works', async () => {
    await failThen(async (user) => {
      await user.click(resendButton('margaret@example.com'));
    });
  });

  it('drops the last failure once inviting works', async () => {
    await failThen(async (user) => {
      await user.type(emailField(), 'dorothy@example.com');
      await user.click(inviteButton());
    });
  });
});
