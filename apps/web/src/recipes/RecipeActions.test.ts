import type { Role, Visibility } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import type { SearchHit } from '@/search/search.ts';
import {
  accessibilityViolations,
  apiServer,
  NO_SEARCH_RESULTS,
  problemResponse,
  renderApp,
  testUsers,
} from '@/testing.ts';
import type { Recipe } from './recipe.ts';
import { recipeQuery } from './recipe.ts';
import { sampleRecipe } from './testing.ts';

const ACTIONS = ['Edit recipe', 'Share with everyone', 'Make private', 'Delete recipe'];
/** The actions the page offers, in order. */
const actions = () =>
  ACTIONS.filter(
    (name) =>
      screen.queryByRole('link', { name }) !== null ||
      screen.queryByRole('button', { name }) !== null,
  );
const button = (name: string) => screen.getByRole('button', { name });
const status = () =>
  screen
    .getAllByRole('status')
    .map((element) => element.textContent.trim())
    .filter(Boolean);

/**
 * Stands in for the API's copy of the recipe: GET answers it, or 404 once it's deleted, and PUT
 * /visibility and DELETE change it, unless `refuse()` gives an answer instead. Keeps what each sends.
 */
function storeRecipe(
  recipe: Recipe,
  refuse: () => Response | undefined | Promise<Response | undefined> = () => undefined,
) {
  answerPreferences();
  let stored: Recipe | undefined = recipe;
  const sent: { method: string; visibility?: Visibility }[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', () =>
      stored
        ? HttpResponse.json({ recipe: stored })
        : problemResponse(404, 'There is no recipe with this ID.'),
    ),
    http.put('/api/v1/recipes/:id/visibility', async ({ request }) => {
      const { visibility } = (await request.json()) as { visibility: Visibility };
      sent.push({ method: 'PUT', visibility });
      const refused = await refuse();
      if (refused) return refused;
      stored = { ...recipe, ...stored, visibility };
      return HttpResponse.json({ recipe: stored });
    }),
    http.delete('/api/v1/recipes/:id', async () => {
      sent.push({ method: 'DELETE' });
      const refused = await refuse();
      if (refused) return refused;
      stored = undefined;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}

async function openRecipe(role: Role = 'editor') {
  const app = await renderApp('/recipes/recipe-bread', { signedInAs: role });
  await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
  await screen.findByRole('radio', { name: 'US customary' });
  return app;
}

describe('what a reader can do with a recipe', () => {
  it.each([
    [
      'their own private recipe',
      'editor',
      testUsers.editor,
      'private',
      ['Edit recipe', 'Share with everyone', 'Delete recipe'],
    ],
    [
      'their own shared recipe',
      'editor',
      testUsers.editor,
      'shared',
      ['Edit recipe', 'Make private', 'Delete recipe'],
    ],
    [
      "someone else's shared recipe, as an editor",
      'editor',
      testUsers.admin,
      'shared',
      ['Edit recipe'],
    ],
    [
      "someone else's shared recipe, as an admin",
      'admin',
      testUsers.editor,
      'shared',
      ['Edit recipe', 'Delete recipe'],
    ],
    ['a shared recipe, as a viewer', 'viewer', testUsers.editor, 'shared', []],
  ] as const)(
    'offers what the policy allows for %s',
    async (_, role, owner, visibility, offered) => {
      storeRecipe(sampleRecipe({ owner: { id: owner.id, name: owner.name }, visibility }));
      await openRecipe(role);

      expect(actions()).toEqual(offered);
    },
  );

  it.each([
    [
      'private',
      { 'Edit recipe': 'pencil', 'Share with everyone': 'users', 'Delete recipe': 'trash' },
    ],
    ['shared', { 'Edit recipe': 'pencil', 'Make private': 'lock', 'Delete recipe': 'trash' }],
  ] as const)(
    'marks each action on a %s recipe with an icon, hidden from screen readers',
    async (visibility, icons) => {
      storeRecipe(sampleRecipe({ visibility }));
      await openRecipe();

      const shown = Object.fromEntries(
        actions().map((name) => {
          const action = screen.queryByRole('link', { name }) ?? button(name);
          const icon = action.querySelector('svg');
          expect(icon?.getAttribute('aria-hidden')).toBe('true');
          return [
            name,
            icon?.getAttribute('class')?.match(/\blucide-([a-z0-9-]+?)(?:-icon)?(?=\s|$)/)?.[1],
          ];
        }),
      );
      expect(shown).toEqual(icons);
    },
  );

  it('shares a private recipe once asked, and makes it private again', async () => {
    const sent = storeRecipe(sampleRecipe({ visibility: 'private' }));
    const { user } = await openRecipe();
    expect(screen.getByText('Private')).toBeDefined();

    await user.click(button('Share with everyone'));
    const sharing = screen.getByRole('alertdialog', { name: 'Share “Weeknight Bread”?' });
    expect(
      within(sharing).getByText(
        'Everyone on myli will see it, and editors will be able to change it. You can make it private again later.',
      ),
    ).toBeDefined();
    await user.click(within(sharing).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);

    await user.click(button('Share with everyone'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Share' }),
    );

    await waitFor(() => {
      expect(status()).toEqual(['Shared: everyone on myli can see it now.']);
    });
    expect(screen.queryByText('Private')).toBeNull();
    expect(document.activeElement).toBe(button('Make private'));

    await user.click(button('Make private'));
    const hiding = screen.getByRole('alertdialog', { name: 'Make “Weeknight Bread” private?' });
    expect(
      within(hiding).getByText(
        'Nobody but you will see it, not even admins. You can share it again later.',
      ),
    ).toBeDefined();
    await user.click(within(hiding).getByRole('button', { name: 'Make private' }));

    await waitFor(() => {
      expect(status()).toEqual(['Private: only you can see it now.']);
    });
    expect(screen.getByText('Private')).toBeDefined();
    expect(sent).toEqual([
      { method: 'PUT', visibility: 'shared' },
      { method: 'PUT', visibility: 'private' },
    ]);
  });

  it('says why changing who sees it failed, until it works', async () => {
    let refusing = true;
    storeRecipe(sampleRecipe({ visibility: 'private' }), () =>
      refusing
        ? problemResponse(403, 'Only the recipe’s owner can change who sees it.')
        : undefined,
    );
    const { user } = await openRecipe();

    await user.click(button('Share with everyone'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Share' }),
    );

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      'Only the recipe’s owner can change who sees it.',
    );
    expect(status()).toEqual([]);
    expect(screen.getByText('Private')).toBeDefined();

    refusing = false;
    await user.click(button('Share with everyone'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Share' }),
    );

    await waitFor(() => {
      expect(status()).toEqual(['Shared: everyone on myli can see it now.']);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['Share with everyone', 'Share'],
    ['Delete recipe', 'Delete recipe'],
  ])('asked to “%s” again while it’s under way, sends one request', async (open, confirm) => {
    const held = Promise.withResolvers<undefined>();
    const sent = storeRecipe(sampleRecipe({ visibility: 'private' }), async () => {
      await held.promise;
      return undefined;
    });
    const { user } = await openRecipe();

    const ask = async () => {
      await user.click(button(open));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: confirm }),
      );
    };
    await ask();
    await ask();
    held.resolve(undefined);

    await waitFor(() => {
      expect(status()).not.toEqual([]);
    });
    expect(sent).toHaveLength(1);
  });

  it('deletes a recipe once asked, then goes home, saying so', async () => {
    const sent = storeRecipe(sampleRecipe());
    const { user, router, queryClient } = await openRecipe();

    await user.click(button('Delete recipe'));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete “Weeknight Bread”?' });
    expect(within(dialog).getByText("It's gone for everyone straight away.")).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent).toEqual([]);

    await user.click(button('Delete recipe'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );

    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(status()).toContain('Deleted “Weeknight Bread”.');
    expect(sent).toEqual([{ method: 'DELETE' }]);
    expect(queryClient.getQueryData(recipeQuery('recipe-bread').queryKey)).toBeUndefined();
    // Back doesn't return to the recipe: home took its place in the history.
    router.options.history.go(-1, false);
    expect(router.options.history.location).toBe('/');

    await router.push('/recipes/recipe-bread');
    await screen.findByRole('heading', { level: 1, name: 'Recipe not found' });
  });

  it('forgets searches from before, so home never shows the recipe deleted', async () => {
    storeRecipe(sampleRecipe());
    const bread: SearchHit = {
      id: 'recipe-bread',
      title: 'Weeknight Bread',
      difficulty: 'easy',
      totalMinutes: 180,
      cuisine: [],
      mealType: [],
      diet: [],
      tags: [],
      allergens: [],
      visibility: 'shared',
    };
    const searchedAgain = Promise.withResolvers<undefined>();
    let searches = 0;
    apiServer.use(
      http.get('/api/v1/search/recipes', async () => {
        searches += 1;
        if (searches === 1) {
          return HttpResponse.json({
            ...NO_SEARCH_RESULTS,
            hits: [bread],
            totalHits: 1,
            totalPages: 1,
          });
        }
        await searchedAgain.promise;
        return HttpResponse.json(NO_SEARCH_RESULTS);
      }),
    );
    const { user } = await renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Weeknight Bread' }));
    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    await screen.findByRole('radio', { name: 'US customary' });

    await user.click(button('Delete recipe'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );

    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(screen.queryByRole('link', { name: 'Weeknight Bread' })).toBeNull();
    expect(screen.getByText('Searching…')).toBeDefined();
    searchedAgain.resolve(undefined);
    await screen.findByText('No recipes yet.');
  });

  it('says why deleting failed, staying on the recipe', async () => {
    storeRecipe(sampleRecipe(), () => problemResponse(500, 'Boom.'));
    const { user, router } = await openRecipe();

    await user.click(button('Delete recipe'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
  });

  it('has nothing for axe to find, with a dialog open or not', async () => {
    storeRecipe(sampleRecipe({ visibility: 'private' }));
    const { user } = await openRecipe();
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(button('Delete recipe'));
    await screen.findByRole('alertdialog');

    expect(await accessibilityViolations()).toEqual([]);
  });
});
