import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerRecipe, sampleRecipe, staleRecipeResponse } from '@/recipes/testing.ts';
import type { TrashedRecipe } from '@/recipes/trash.ts';
import { apiServer, renderApp, testUsers } from '@/testing.ts';

const trashed = (overrides: Partial<TrashedRecipe> = {}): TrashedRecipe => ({
  id: 'recipe-bread',
  title: 'Weeknight Bread',
  visibility: 'shared',
  owner: { id: testUsers.editor.id, name: testUsers.editor.name, avatar: null },
  deletedAt: '2026-11-16T10:00:00.000Z',
  purgeAt: '2026-12-16T10:00:00.000Z',
  version: 3,
  ...overrides,
});

/**
 * Stands in for the API's trash: GET answers what's in it, and restoring takes a recipe out, unless
 * `refuse` answers instead. Keeps the `If-Match` of each restore.
 */
function storeTrash(
  recipes: TrashedRecipe[],
  refuse: (id: string) => Response | undefined = () => undefined,
) {
  let stored = recipes;
  const restores: { id: string; ifMatch: string | null }[] = [];
  apiServer.use(
    http.get('/api/v1/trash', () => HttpResponse.json({ recipes: stored, retentionDays: 30 })),
    http.post('/api/v1/trash/:id/restore', ({ params, request }) => {
      const id = String(params.id);
      restores.push({ id, ifMatch: request.headers.get('if-match') });
      const refused = refuse(id);
      if (refused) return refused;
      const recipe = stored.find((entry) => entry.id === id);
      stored = stored.filter((entry) => entry.id !== id);
      return HttpResponse.json({
        recipe: sampleRecipe({ id, title: recipe?.title, version: (recipe?.version ?? 0) + 1 }),
      });
    }),
  );
  return {
    restores,
    replace(recipes: TrashedRecipe[]) {
      stored = recipes;
    },
  };
}

const titles = () =>
  screen
    .queryAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent.trim());

async function openTrash() {
  const app = await renderApp('/trash');
  await screen.findByRole('table');
  return app;
}

describe('the trash', () => {
  it('restores a recipe, which leaves the trash, and links to it', async () => {
    const { restores } = storeTrash([
      trashed({ id: 'recipe-soup', title: 'Tomato Soup', version: 2 }),
      trashed(),
    ]);
    const { router, user } = await openTrash();
    expect(titles()).toEqual(['Tomato Soup', 'Weeknight Bread']);

    await user.click(screen.getByRole('button', { name: 'Restore Weeknight Bread' }));

    await waitFor(() => {
      expect(titles()).toEqual(['Tomato Soup']);
    });
    expect(restores).toEqual([{ id: 'recipe-bread', ifMatch: '"3"' }]);
    // Said once the trash is fetched again, which may be after the list shows it gone.
    const status = await waitFor(() => {
      const [said] = screen.getAllByRole('status').filter((element) => element.textContent.trim());
      if (!said) throw new Error('no status says it was restored');
      return said;
    });
    expect(status.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Restored “Weeknight Bread”. Go to the recipe',
    );
    // Its row, and the button in it, are gone.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Trash' }));

    answerRecipe(sampleRecipe({ version: 4 }));
    await user.click(within(status).getByRole('link', { name: 'Go to the recipe' }));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('explains a restore refused because it changed meanwhile, and restores it as it is now', async () => {
    let refusing = true;
    const trash = storeTrash([trashed()], () =>
      refusing ? staleRecipeResponse(sampleRecipe({ version: 5 })) : undefined,
    );
    const { user } = await openTrash();
    // Someone restored it and deleted it again.
    trash.replace([trashed({ version: 5, deletedAt: '2026-11-17T09:00:00.000Z' })]);

    const restore = screen.getByRole('button', { name: 'Restore Weeknight Bread' });
    await user.click(restore);

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      'Someone restored “Weeknight Bread” and deleted it again meanwhile. Try again if you still want it back.',
    );
    expect(document.activeElement).toBe(restore);
    refusing = false;
    await user.click(screen.getByRole('button', { name: 'Restore Weeknight Bread' }));

    await screen.findByText('The trash is empty.');
    expect(trash.restores.map(({ ifMatch }) => ifMatch)).toEqual(['"3"', '"5"']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
