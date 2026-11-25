import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { apiServer, renderApp, testUsers } from '@/testing.ts';
import { answerRecipe, sampleRecipe } from './testing.ts';

/** Stands in for the API's copy of the recipe's public link, and keeps every request about it. */
function storePublicLink() {
  let token: string | null = null;
  let made = 0;
  const sent: string[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id/public-link', () => {
      sent.push('GET');
      return HttpResponse.json({ publicLink: token === null ? null : { token } });
    }),
    http.put('/api/v1/recipes/:id/public-link', () => {
      sent.push('PUT');
      made += 1;
      token ??= `token-${String(made)}`;
      return HttpResponse.json({ publicLink: { token } });
    }),
    http.delete('/api/v1/recipes/:id/public-link', () => {
      sent.push('DELETE');
      token = null;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}

async function openRecipe(recipe = sampleRecipe()) {
  answerRecipe(recipe);
  answerPreferences();
  const app = await renderApp(`/recipes/${recipe.id}`);
  await screen.findByRole('heading', { level: 1, name: recipe.title });
  return app;
}

describe('a recipe’s public link', () => {
  it('is created and copied, warned of when making the recipe private, and revoked once confirmed', async () => {
    const sent = storePublicLink();
    const { user } = await openRecipe();

    await user.click(await screen.findByRole('button', { name: 'Public link' }));
    let dialog = await screen.findByRole('dialog', { name: 'Public link' });
    await user.click(within(dialog).getByRole('button', { name: 'Create public link' }));
    const link = within(dialog).getByRole('textbox', { name: 'Link' });
    const url = `${window.location.origin}/p/token-1`;
    await waitFor(() => {
      expect(document.activeElement).toBe(link);
    });
    expect((link as HTMLInputElement).value).toBe(url);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(url);
    expect(within(dialog).getByRole('status').textContent.trim()).toBe('Copied the link.');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Make private' }));
    const making = await screen.findByRole('alertdialog', { name: /private\?$/ });
    expect(within(making).getByText(/its public link stops working for good/)).toBeDefined();
    await user.click(within(making).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Public link' }));
    dialog = await screen.findByRole('dialog', { name: 'Public link' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke link' }));
    const revoking = await screen.findByRole('alertdialog', { name: 'Revoke the public link?' });
    await user.click(within(revoking).getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Create public link' }),
      );
    });
    expect(within(dialog).getByRole('status').textContent.trim()).toBe(
      'Revoked the link. No one can open it now.',
    );
    expect(sent).toEqual(['GET', 'PUT', 'DELETE']);
  });

  it('isn’t offered to or asked for by someone who may not share the recipe', async () => {
    // The API refuses them, and a refusal makes the app check the session again.
    const sent = storePublicLink();
    await openRecipe(
      sampleRecipe({ owner: { id: testUsers.admin.id, name: testUsers.admin.name } }),
    );
    expect(screen.queryByRole('button', { name: 'Public link' })).toBeNull();
    expect(sent).toEqual([]);
  });
});
