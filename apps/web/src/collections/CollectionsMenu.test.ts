import type { Role } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerRecipe, sampleRecipe } from '@/recipes/testing.ts';
import { apiServer, renderApp } from '@/testing.ts';

/**
 * Stands in for the API's copy of the reader's collections and which hold the recipe, and keeps
 * every request about them.
 */
function storeCollections(holding: string[]) {
  let held = new Set(holding);
  const sent: string[] = [];
  const names = { baking: 'Baking', weeknight: 'Weeknight' };
  apiServer.use(
    http.get('/api/v1/collections', () => {
      sent.push('GET /collections');
      return HttpResponse.json({
        collections: Object.entries(names).map(([id, name]) => ({
          id,
          name,
          recipeCount: held.has(id) ? 1 : 0,
        })),
      });
    }),
    http.get('/api/v1/recipes/:id/collections', () => {
      sent.push('GET holding');
      return HttpResponse.json({ collectionIds: [...held] });
    }),
    http.put('/api/v1/collections/:id/recipes/:recipeId', ({ params }) => {
      sent.push(`PUT ${String(params.id)}`);
      held = new Set([...held, String(params.id)]);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/collections/:id/recipes/:recipeId', ({ params }) => {
      sent.push(`DELETE ${String(params.id)}`);
      held = new Set([...held].filter((id) => id !== params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}

async function openRecipe(role: Role) {
  answerRecipe(sampleRecipe());
  const app = await renderApp('/recipes/recipe-bread', { signedInAs: role });
  await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
  await screen.findByRole('radio', { name: 'US customary' });
  return app;
}

/** Opens the menu, and gives each collection's name and whether it's checked. */
async function openMenu(user: Awaited<ReturnType<typeof openRecipe>>['user']) {
  await user.click(screen.getByRole('button', { name: 'Collections' }));
  const menu = await screen.findByRole('menu');
  await waitFor(() => {
    expect(within(menu).queryByText('Loading…')).toBeNull();
  });
  return Object.fromEntries(
    within(menu)
      .getAllByRole('menuitemcheckbox')
      .map((item) => [item.textContent.trim(), item.getAttribute('aria-checked')]),
  );
}

describe('the recipe’s collections menu', () => {
  it('puts the recipe in a collection once checked, and takes it out once unchecked', async () => {
    const sent = storeCollections(['weeknight']);
    const { user } = await openRecipe('editor');
    expect(await openMenu(user)).toEqual({ Baking: 'false', Weeknight: 'true' });

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Baking' }));
    expect(await screen.findByText('Added to “Baking”.')).toBeDefined();
    expect(await openMenu(user)).toEqual({ Baking: 'true', Weeknight: 'true' });
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Weeknight' }));
    expect(await screen.findByText('Taken out of “Weeknight”.')).toBeDefined();

    expect(sent.filter((request) => !request.startsWith('GET'))).toEqual([
      'PUT baking',
      'DELETE weeknight',
    ]);
  });

  it('isn’t offered to or asked for viewers', async () => {
    // The API refuses viewers, and a refusal makes the app check the session again.
    const sent = storeCollections([]);
    await openRecipe('viewer');
    expect(screen.queryByRole('button', { name: 'Collections' })).toBeNull();
    expect(sent).toEqual([]);
  });
});
