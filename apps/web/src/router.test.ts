import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppRouter } from './router.ts';

/** Renders the whole app at `path`, once the page there has loaded. */
async function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  render(App, { global: { plugins: [router] } });
  await router.isReady();
  return router;
}

const pageHeading = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('the app', () => {
  it('shows the home page at /, titled with the app name', async () => {
    await renderAt('/');

    await pageHeading('myli');
    expect(document.title).toBe('myli');
  });

  it('shows a page-not-found page at any other address, with a link home', async () => {
    const router = await renderAt('/recipes/no-such-recipe');

    await pageHeading('Page not found');
    expect(document.title).toBe('Page not found · myli');

    await userEvent.setup().click(screen.getByRole('link', { name: 'Go to the home page' }));

    await pageHeading('myli');
    expect(router.currentRoute.value.path).toBe('/');
    expect(document.title).toBe('myli');
  });
});
