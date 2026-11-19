import { type Role, type Visibility, versionETag } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import {
  apiServer,
  NO_RECIPES,
  NO_SEARCH_RESULTS,
  problemResponse,
  renderApp,
  testUsers,
} from '@/testing.ts';
import type { Recipe, RecipeSummary } from './recipe.ts';
import { recipeQuery } from './recipe.ts';
import { sampleRecipe, staleRecipeResponse } from './testing.ts';

const ACTIONS = ['Favorite', 'Edit recipe', 'Share with everyone', 'Make private', 'Delete recipe'];
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
 * /visibility and DELETE change it, unless `refuse()` gives an answer instead. As the API does, a
 * change based on another version than the stored one gets 412. Keeps what each sends.
 */
function storeRecipe(
  recipe: Recipe,
  refuse: () => Response | undefined | Promise<Response | undefined> = () => undefined,
) {
  answerPreferences();
  let stored: Recipe | undefined = recipe;
  const sent: { method: string; visibility?: Visibility }[] = [];
  const stale = (request: Request) =>
    stored && request.headers.get('if-match') !== versionETag(stored.version)
      ? staleRecipeResponse(stored)
      : undefined;
  apiServer.use(
    http.get('/api/v1/recipes/:id', () =>
      stored
        ? HttpResponse.json({ recipe: stored })
        : problemResponse(404, 'There is no recipe with this ID.'),
    ),
    http.put('/api/v1/recipes/:id/visibility', async ({ request }) => {
      const { visibility } = (await request.json()) as { visibility: Visibility };
      sent.push({ method: 'PUT', visibility });
      const refused = (await refuse()) ?? stale(request);
      if (refused) return refused;
      stored = { ...recipe, ...stored, visibility, version: (stored ?? recipe).version + 1 };
      return HttpResponse.json({ recipe: stored });
    }),
    http.delete('/api/v1/recipes/:id', async ({ request }) => {
      sent.push({ method: 'DELETE' });
      const refused = (await refuse()) ?? stale(request);
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
  // The policy itself is tested in @myli/shared. Each action here asks it about a different one.
  it('offers what the policy allows: an editor may edit someone else’s shared recipe, nothing more', async () => {
    storeRecipe(
      sampleRecipe({
        owner: { id: testUsers.admin.id, name: testUsers.admin.name },
        visibility: 'shared',
      }),
    );
    await openRecipe('editor');
    await screen.findByRole('button', { name: 'Favorite' });

    expect(actions()).toEqual(['Favorite', 'Edit recipe']);
  });

  it('keeps a recipe as a favorite once pressed, says why when it can’t, and lets it go', async () => {
    storeRecipe(sampleRecipe());
    let refusing = true;
    const sent: boolean[] = [];
    apiServer.use(
      http.put('/api/v1/recipes/:id/favorite', async ({ request }) => {
        const { favorite } = (await request.json()) as { favorite: boolean };
        sent.push(favorite);
        return refusing ? problemResponse(500, 'Boom.') : HttpResponse.json({ favorite });
      }),
    );
    const { user } = await openRecipe();
    const favorite = await screen.findByRole('button', { name: 'Favorite' });
    expect(favorite.getAttribute('aria-pressed')).toBe('false');

    await user.click(favorite);
    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(favorite.getAttribute('aria-pressed')).toBe('false');

    refusing = false;
    await user.click(favorite);
    await waitFor(() => {
      expect(favorite.getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(favorite);

    await user.click(favorite);
    await waitFor(() => {
      expect(favorite.getAttribute('aria-pressed')).toBe('false');
    });
    expect(sent).toEqual([true, true, false]);
  });

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

  it('sends one request when asked again while one is under way, to share or to delete', async () => {
    let held = Promise.withResolvers<undefined>();
    const sent = storeRecipe(sampleRecipe({ visibility: 'private' }), async () => {
      await held.promise;
      return undefined;
    });
    const { user } = await openRecipe();
    const askTwice = async (open: string, confirm: string) => {
      for (let time = 0; time < 2; time += 1) {
        await user.click(button(open));
        await user.click(
          within(screen.getByRole('alertdialog')).getByRole('button', { name: confirm }),
        );
      }
    };

    await askTwice('Share with everyone', 'Share');
    held.resolve(undefined);
    await waitFor(() => {
      expect(status()).toEqual(['Shared: everyone on myli can see it now.']);
    });
    held = Promise.withResolvers<undefined>();
    await askTwice('Delete recipe', 'Delete recipe');
    held.resolve(undefined);
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });

    expect(sent).toEqual([{ method: 'PUT', visibility: 'shared' }, { method: 'DELETE' }]);
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

  const bread: RecipeSummary = {
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
    cover: null,
  };

  /** Opens `page`, then the recipe from it, deletes it and goes back to the page. */
  async function deleteFrom({
    path,
    heading,
    api,
    before,
    after,
    loading,
  }: {
    path: string;
    heading: string;
    api: string;
    before: object;
    after: object;
    loading: string;
  }) {
    storeRecipe(sampleRecipe());
    const askedAgain = Promise.withResolvers<undefined>();
    let asked = 0;
    apiServer.use(
      http.get(api, async () => {
        asked += 1;
        if (asked === 1) return HttpResponse.json(before);
        await askedAgain.promise;
        return HttpResponse.json(after);
      }),
    );
    const { user, router } = await renderApp(path);
    await user.click(await screen.findByRole('link', { name: 'Weeknight Bread' }));
    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    await screen.findByRole('radio', { name: 'US customary' });

    await user.click(button('Delete recipe'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    // Deleting goes home; search is a step further.
    await router.push(path);

    await screen.findByRole('heading', { level: 1, name: heading });
    expect(screen.queryByRole('link', { name: 'Weeknight Bread' })).toBeNull();
    expect(screen.getByText(loading)).toBeDefined();
    askedAgain.resolve(undefined);
    await screen.findByText('No recipes yet.');
  }

  it('forgets what home loaded before, so it never shows the recipe deleted', async () => {
    await deleteFrom({
      path: '/',
      heading: 'Recipes',
      api: '/api/v1/recipes',
      before: { ...NO_RECIPES, recipes: [bread], total: 1, totalPages: 1 },
      after: NO_RECIPES,
      loading: 'Loading recipes…',
    });
  });

  it('forgets what search loaded before, so it never shows the recipe deleted', async () => {
    await deleteFrom({
      path: '/search',
      heading: 'Search',
      api: '/api/v1/search/recipes',
      before: { ...NO_SEARCH_RESULTS, hits: [bread], totalHits: 1, totalPages: 1 },
      after: NO_SEARCH_RESULTS,
      loading: 'Searching…',
    });
  });

  it('shows what someone changed meanwhile when deleting finds it, staying on the recipe', async () => {
    storeRecipe(sampleRecipe(), () =>
      staleRecipeResponse(sampleRecipe({ title: 'Their Bread', version: 2 })),
    );
    const { user, router } = await openRecipe();

    await user.click(button('Delete recipe'));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete recipe' }),
    );

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      'Someone changed this recipe meanwhile, and it shows their changes now. Try again if you still want to.',
    );
    await screen.findByRole('heading', { level: 1, name: 'Their Bread' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
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
});
