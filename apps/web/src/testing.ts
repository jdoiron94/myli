import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/vue';
import axe from 'axe-core';
import { vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppRouter } from './router.ts';

/**
 * Renders the whole app at `path`, once the page there has loaded. As in main.ts, the app mounts
 * while the router is still making its first navigation.
 */
export async function renderApp(path: string) {
  // As index.html does: jsdom's blank document has no language.
  document.documentElement.lang = 'en';
  const history = createMemoryHistory();
  history.replace(path);
  const router = createAppRouter(history);
  render(App, { global: { plugins: [router] } });
  await router.isReady();
  await screen.findByRole('heading', { level: 1 });
  return { router, user: userEvent.setup() };
}

/**
 * Stands in for the device's light or dark setting, which jsdom doesn't have. `change` switches it
 * the way the device would, telling every listener.
 */
export function fakeDeviceScheme(initial: 'light' | 'dark') {
  const query = '(prefers-color-scheme: dark)';
  let dark = initial === 'dark';
  const listeners = new Set<(event: { matches: boolean }) => void>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return media === query && dark;
    },
    addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  }));
  return {
    change(scheme: 'light' | 'dark') {
      dark = scheme === 'dark';
      for (const listener of listeners) listener({ matches: dark });
    },
  };
}

/** The classes on `<html>`, where the theme is applied. */
export const htmlClasses = () => [...document.documentElement.classList];

/**
 * What axe finds wrong with the page as it is now: each rule broken, with the elements breaking it.
 * Pass rule IDs in `skip` to leave them out, with a reason where it's called.
 */
export async function accessibilityViolations({ skip = [] }: { skip?: string[] } = {}) {
  const { violations } = await axe.run(document, {
    rules: Object.fromEntries(
      // jsdom has no layout, so color contrast can't be measured here (Playwright checks it).
      ['color-contrast', ...skip].map((id) => [id, { enabled: false }]),
    ),
  });
  return violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
}
