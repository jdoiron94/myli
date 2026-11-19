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

  // The end-to-end tests check every page, but never open this menu.
  it('has no accessibility violations with the theme menu open', async () => {
    const { user } = await renderApp('/');
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
  const answerAdminPages = () => {
    apiServer.use(
      http.get('/api/v1/invitations', () => HttpResponse.json({ invitations: [] })),
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          users: [
            { ...testUsers.admin, deactivated: false, createdAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
      ),
    );
  };
  const nav = () => screen.getByRole('navigation', { name: 'Main' });
  const adminButton = () => within(nav()).getByRole('button', { name: 'Admin' });

  const linkNames = () =>
    within(nav())
      .getAllByRole('link')
      .map((link) => link.textContent.trim());

  it('links admins to search and a new recipe, and gathers the admin pages in one menu', async () => {
    const { user } = await renderApp('/', { signedInAs: 'admin' });
    expect(linkNames()).toEqual(['Search', 'New recipe']);

    await user.click(adminButton());

    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent.trim())).toEqual([
      'Invitations',
      'Users',
      'Search index',
    ]);
  });

  it('goes to the page picked, focusing its heading, and marks it as the current one', async () => {
    answerAdminPages();
    const { router, user } = await renderApp('/', { signedInAs: 'admin' });
    expect(adminButton().hasAttribute('data-current')).toBe(false);

    await user.click(adminButton());
    await user.click(await screen.findByRole('menuitem', { name: 'Invitations' }));

    await screen.findByText('No open invitations.');
    expect(router.currentRoute.value.fullPath).toBe('/admin/invitations');
    const heading = screen.getByRole('heading', { level: 1, name: 'Invitations' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(adminButton().hasAttribute('data-current')).toBe(true);

    await user.click(adminButton());
    const current = await screen.findByRole('menuitem', { name: 'Invitations' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('menuitem', { name: 'Users' }).getAttribute('aria-current')).toBeNull();
  });

  it('works from the keyboard, and leaves focus on the button when the page picked is this one', async () => {
    answerAdminPages();
    const { router, user } = await renderApp('/', { signedInAs: 'admin' });

    adminButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{Enter}');

    await screen.findByText(testUsers.admin.email);
    expect(router.currentRoute.value.fullPath).toBe('/admin/users');
    const heading = screen.getByRole('heading', { level: 1, name: 'Users' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });

    adminButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(adminButton());
    });
  });

  it('links viewers to search only, since they can’t write recipes', async () => {
    const { router, user } = await renderApp('/', { signedInAs: 'viewer' });
    expect(linkNames()).toEqual(['Search']);
    expect(within(nav()).queryByRole('button')).toBeNull();

    await user.click(within(nav()).getByRole('link', { name: 'Search' }));

    await screen.findByRole('heading', { level: 1, name: 'Search' });
    expect(router.currentRoute.value.fullPath).toBe('/search');
    await screen.findByText('No recipes yet.');
  });

  it('isn’t there for no one signed in, nor is the account menu', async () => {
    await renderApp('/login', { signedInAs: null });

    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Account:/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });
});
