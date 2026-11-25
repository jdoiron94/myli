import { screen } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { revisionContent, sampleImage, sampleRecipe } from '@/recipes/testing.ts';
import { documentTitle } from '@/router.ts';
import { apiServer, problemResponse, renderApp } from '@/testing.ts';

describe('a public link’s page', () => {
  it('shows its recipe to someone not signed in, its photos by the link, in units they choose there', async () => {
    const recipe = revisionContent(
      sampleRecipe({ images: [sampleImage('cover', 'The loaf')], coverImageId: 'cover' }),
    );
    apiServer.use(http.get('/api/v1/public/recipes/abc', () => HttpResponse.json({ recipe })));
    // Nothing else is answered: a request for the reader's preferences, or any other, fails the test.
    const { user } = await renderApp('/p/abc', { signedInAs: null });

    expect(await screen.findByRole('heading', { level: 1, name: recipe.title })).toBeDefined();
    expect(document.title).toBe(documentTitle(recipe.title));
    expect(screen.getByRole('img', { name: 'The loaf' }).getAttribute('src')).toBe(
      '/api/v1/public/recipes/abc/images/cover/1280',
    );
    const metric = screen.getByRole('radio', { name: 'Metric' });
    await user.click(metric);
    expect(metric.getAttribute('aria-checked')).toBe('true');
  });

  it('says so for a link that doesn’t work', async () => {
    apiServer.use(
      http.get('/api/v1/public/recipes/gone', () => problemResponse(404, 'Public link not found.')),
    );
    await renderApp('/p/gone', { signedInAs: null });
    expect(await screen.findByRole('heading', { level: 1, name: 'Link not found' })).toBeDefined();
    expect(
      screen.getByText(
        "This link doesn't work. It may have been revoked, or the recipe may no longer be shared.",
      ),
    ).toBeDefined();
  });
});
