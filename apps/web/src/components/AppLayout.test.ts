import { screen, waitFor } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { accessibilityViolations, renderApp } from '../testing.ts';

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
