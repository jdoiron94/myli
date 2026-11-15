import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { accessibilityViolations, apiServer, problemResponse, renderApp } from '@/testing.ts';

const INVITATIONS = [
  {
    id: 'invitation-2',
    email: 'katherine@example.com',
    role: 'viewer',
    status: 'pending',
    expiresAt: '2026-11-22T15:30:00.000Z',
    createdAt: '2026-11-15T15:30:00.000Z',
  },
  {
    id: 'invitation-1',
    email: 'margaret@example.com',
    role: 'editor',
    status: 'expired',
    expiresAt: '2026-11-08T09:00:00.000Z',
    createdAt: '2026-11-01T09:00:00.000Z',
  },
] as const;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The invitations page, as an admin, with the API answering `GET /invitations` with `answer`. */
async function renderInvitations(
  answer: () => Response | Promise<Response> = () =>
    HttpResponse.json({ invitations: INVITATIONS }),
) {
  const requests = { count: 0 };
  apiServer.use(
    http.get('/api/v1/invitations', () => {
      requests.count += 1;
      return answer();
    }),
  );
  const rendered = await renderApp('/admin/invitations', { signedInAs: 'admin' });
  return { ...rendered, requests };
}

/** The text of each cell, row by row, header row included. */
function tableText() {
  return within(screen.getByRole('table', { name: 'Open invitations' }))
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim()));
}

describe('the invitations page', () => {
  it('lists the open invitations as the API gives them, newest first', async () => {
    await renderInvitations();

    await screen.findByRole('table', { name: 'Open invitations' });
    expect(document.title).toBe('Invitations · myli');
    expect(tableText()).toEqual([
      ['Email', 'Role', 'Status', 'Expires'],
      [
        'katherine@example.com',
        'Viewer',
        'Pending',
        dateFormat.format(new Date('2026-11-22T15:30:00.000Z')),
      ],
      [
        'margaret@example.com',
        'Editor',
        'Expired',
        dateFormat.format(new Date('2026-11-08T09:00:00.000Z')),
      ],
    ]);
    const expiry = screen.getByText(dateFormat.format(new Date('2026-11-22T15:30:00.000Z')));
    expect(expiry.tagName).toBe('TIME');
    expect(expiry.getAttribute('datetime')).toBe('2026-11-22T15:30:00.000Z');
  });

  it('says when there are none', async () => {
    await renderInvitations(() => HttpResponse.json({ invitations: [] }));

    expect(await screen.findByText('No open invitations.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says it is loading them while it is', async () => {
    const answered = Promise.withResolvers<undefined>();
    await renderInvitations(async () => {
      await answered.promise;
      return HttpResponse.json({ invitations: [] });
    });

    expect(screen.getByRole('status').textContent.trim()).toBe('Loading invitations…');
    answered.resolve(undefined);
    await screen.findByText('No open invitations.');
  });

  it('says so when they could not be loaded, and tries again when asked', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { user, requests } = await renderInvitations(() => answer());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    // Retried twice before giving up, as every query is.
    expect(requests.count).toBe(3);
    expect(await accessibilityViolations()).toEqual([]);

    // Still failing: they're told the new try happened, and stay on the button.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent.trim()).toBe(
        'Still not working. Try again in a moment.',
      );
    });
    expect(requests.count).toBe(6);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));

    answer = () => HttpResponse.json({ invitations: INVITATIONS });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('table', { name: 'Open invitations' });
    // The button they pressed is gone, so focus starts on the page again.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Invitations' }),
      );
    });
  });

  it('leaves focus alone when the failure clears up without them pressing the button', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { queryClient } = await renderInvitations(() => answer());
    await screen.findByRole('alert');
    const themeButton = screen.getByRole('button', { name: 'Theme' });
    themeButton.focus();

    answer = () => HttpResponse.json({ invitations: INVITATIONS });
    await queryClient.refetchQueries({ queryKey: ['invitations'] });

    await screen.findByRole('table', { name: 'Open invitations' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(themeButton);
  });

  it("shows the API's reason when it refuses", async () => {
    const { router } = await renderInvitations(() =>
      problemResponse(403, "You don't have permission to do that."),
    );

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "You don't have permission to do that.",
    );
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations');
  });

  it('has no accessibility violations', async () => {
    await renderInvitations();
    await screen.findByRole('table', { name: 'Open invitations' });

    expect(await accessibilityViolations()).toEqual([]);
  });
});
