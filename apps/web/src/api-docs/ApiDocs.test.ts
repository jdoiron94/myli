import { render, screen } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import openApiDocument from '../../../api/openapi.json?raw';
import { apiServer } from '../testing.ts';
import ApiDocs from './ApiDocs.vue';

/** Renders the docs page with `theme` on `<html>`, as public/theme.js leaves it. */
async function renderApiDocs(theme: 'light' | 'dark' = 'light') {
  document.documentElement.classList.add(theme);
  apiServer.use(
    http.get('/api/v1/openapi.json', () =>
      HttpResponse.text(openApiDocument, { headers: { 'content-type': 'application/json' } }),
    ),
  );
  render(ApiDocs);
  // Scalar takes a moment to load the document and lay it out.
  await screen.findByRole('heading', { level: 1, name: 'myli API' }, { timeout: 5000 });
}

afterEach(() => {
  // Where Scalar puts its light or dark class.
  document.body.className = '';
});

describe('the API docs page', () => {
  it("shows the API's own document, under one h1", async () => {
    await renderApiDocs();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // Each section once it's in view, which everything is here (test-setup.ts).
    expect(await screen.findByRole('heading', { level: 2, name: /Invitations/ })).toBeDefined();
  });

  // jsdom's address is localhost, where Scalar turns on more of its services by default. Any
  // request besides the document's would fail the test (test-setup.ts).
  it("uses none of Scalar's services, even on a local address", async () => {
    await renderApiDocs();

    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Share|Developer Tools/ })).toBeNull();
    // It would open client.scalar.com.
    expect(screen.queryByText('Open API Client')).toBeNull();
    const styles = [...document.querySelectorAll('style')].map((style) => style.textContent);
    expect(styles.filter((css) => css.includes('scalar.com'))).toEqual([]);
  });

  it.each(['light', 'dark'] as const)("follows the app's %s theme", async (theme) => {
    await renderApiDocs(theme);

    expect(document.body.classList).toContain(`${theme}-mode`);
    expect(screen.queryByRole('button', { name: /dark mode|light mode/i })).toBeNull();
  });
});
