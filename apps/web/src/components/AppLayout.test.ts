import { AUTH_BASE_PATH } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { accessibilityViolations, apiServer, renderApp, testUsers } from '../testing.ts';

describe('the layout', () => {
  it('starts keyboard users at a skip link that moves focus to the main content', async () => {
    const { router, user } = await renderApp('/');

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }));

    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it("moves focus to the new page's heading after navigating, but not on the first load", async () => {
    const { user } = await renderApp('/no-such-page');
    expect(document.activeElement).toBe(document.body);

    await user.click(screen.getByRole('link', { name: 'Go to the home page' }));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('leaves focus alone when only the query changes', async () => {
    const { router, user } = await renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.keyboard('{Escape}');
    const trigger = screen.getByRole('button', { name: 'Theme' });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    await router.push('/?sort=newest');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(trigger);
  });

  it('has no accessibility violations, with the theme menu closed or open', async () => {
    const { user } = await renderApp('/');
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await screen.findByRole('menu');

    // `region` (a best practice, not a WCAG rule) wants all content inside landmarks. Popups are
    // rendered at the end of <body>, outside them, and reached by moving focus into them.
    expect(await accessibilityViolations({ skip: ['region'] })).toEqual([]);
  });
});

describe('the account menu', () => {
  const accountButton = () => screen.getByRole('button', { name: 'Account: Ada Lovelace' });

  it("shows who's signed in, with their email and role", async () => {
    const { user } = await renderApp('/');

    await user.click(accountButton());

    const menu = await screen.findByRole('menu');
    expect(menu.textContent).toContain('Ada Lovelace');
    expect(menu.textContent).toContain('ada@example.com');
    expect(menu.textContent).toContain('Editor');
    // See the theme menu's test for `region`.
    expect(await accessibilityViolations({ skip: ['region'] })).toEqual([]);
  });

  it("isn't there when no one is signed in", async () => {
    await renderApp('/login', { signedInAs: null });

    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
  });

  it('signs out, goes to the sign-in page and forgets what was fetched', async () => {
    let signedOut = false;
    apiServer.use(
      http.post(`${AUTH_BASE_PATH}/sign-out`, () => {
        signedOut = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const { router, queryClient, user } = await renderApp('/no-such-page/1');
    queryClient.setQueryData(['recipes', '1'], { title: 'Soup' });

    await user.click(accountButton());
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    await screen.findByRole('heading', { level: 1, name: 'Sign in' });
    expect(signedOut).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
    expect(queryClient.getQueryData(['recipes', '1'])).toBeUndefined();
    expect(queryClient.getQueryData(['session'])).toBeNull();
  });

  it("says so when signing out didn't work, and stays signed in", async () => {
    apiServer.use(
      http.post(`${AUTH_BASE_PATH}/sign-out`, () => new HttpResponse(null, { status: 500 })),
    );
    const { router, user } = await renderApp('/');

    await user.click(accountButton());
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Couldn't sign out. Check your connection, then try again.",
    );
    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(accountButton()).toBeDefined();

    await router.push('/no-such-page/1');

    await screen.findByRole('heading', { level: 1, name: 'Page not found' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the main navigation', () => {
  it('links admins to the invitations, marking the link of the page they are on', async () => {
    apiServer.use(http.get('/api/v1/invitations', () => HttpResponse.json({ invitations: [] })));
    const { router, user } = await renderApp('/', { signedInAs: 'admin' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const link = within(nav).getByRole('link', { name: 'Invitations' });
    expect(link.getAttribute('aria-current')).toBeNull();

    await user.click(link);

    await screen.findByText('No open invitations.');
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('links admins to the users too, after the invitations', async () => {
    apiServer.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          users: [
            { ...testUsers.admin, deactivated: false, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      ),
    );
    const { router, user } = await renderApp('/', { signedInAs: 'admin' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent.trim())).toEqual(['Invitations', 'Users']);

    await user.click(within(nav).getByRole('link', { name: 'Users' }));

    await screen.findByText(testUsers.admin.email);
    expect(router.currentRoute.value.fullPath).toBe('/admin/users');
    expect(within(nav).getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(nav).getByRole('link', { name: 'Invitations' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it.each([
    ['an editor', 'editor'],
    ['a viewer', 'viewer'],
    ['no one signed in', null],
  ] as const)("isn't there for %s, who has no page to go to yet", async (_, role) => {
    await renderApp(role ? '/' : '/login', { signedInAs: role });

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Invitations' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });
});
