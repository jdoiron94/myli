import { screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { renderApp } from './testing.ts';

const pageHeading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('the router', () => {
  it('shows the home page at /, titled with the app name', async () => {
    await renderApp('/');

    await pageHeading('Recipes');
    expect(document.title).toBe('myli');
  });

  it('shows a page-not-found page at any other address, with a link home', async () => {
    const { router, user } = await renderApp('/recipes/no-such-recipe');

    await pageHeading('Page not found');
    expect(document.title).toBe('Page not found · myli');

    await user.click(screen.getByRole('link', { name: 'Go to the home page' }));

    await pageHeading('Recipes');
    expect(router.currentRoute.value.path).toBe('/');
    expect(document.title).toBe('myli');
  });
});
