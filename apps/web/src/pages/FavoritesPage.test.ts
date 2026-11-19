import { screen, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { type RecipeList, recipeListQuery } from '@/recipes/recipe.ts';
import { answerRecipe, cardParts, sampleRecipe, sampleSummary } from '@/recipes/testing.ts';
import { apiServer, NO_RECIPES, renderApp } from '@/testing.ts';

const bread = sampleSummary({ id: 'recipe-bread', title: 'Weeknight Bread' });
const listOf = (...recipes: RecipeList['recipes']): RecipeList => ({
  ...NO_RECIPES,
  recipes,
  total: recipes.length,
  totalPages: recipes.length > 0 ? 1 : 0,
});

describe('favorites', () => {
  it('lists the reader’s favorites, and says how to keep one when there are none', async () => {
    apiServer.use(http.get('/api/v1/me/favorites', () => HttpResponse.json(listOf(bread))));
    const { queryClient } = await renderApp('/favorites');

    const list = await screen.findByRole('list', { name: 'Favorites' });
    expect(within(list).getAllByRole('article').map(cardParts)).toEqual([
      {
        title: 'Weeknight Bread',
        facts: '40 min · Medium',
        tags: ['Thai', 'Dinner', 'Vegan', 'Weeknight'],
      },
    ]);
    expect(screen.getByText('1 recipe')).toBeDefined();

    queryClient.setQueryData(recipeListQuery('favorites', 1).queryKey, NO_RECIPES);

    await screen.findByText('No favorites yet.');
    expect(screen.getByText('Choose Favorite on a recipe’s page to keep it here.')).toBeDefined();
  });

  it('never shows the list from before a recipe was kept as a favorite', async () => {
    answerRecipe(sampleRecipe());
    answerPreferences();
    const askedAgain = Promise.withResolvers<undefined>();
    let asked = 0;
    apiServer.use(
      http.get('/api/v1/me/favorites', async () => {
        asked += 1;
        if (asked === 1) return HttpResponse.json(NO_RECIPES);
        await askedAgain.promise;
        return HttpResponse.json(listOf(bread));
      }),
      http.put('/api/v1/recipes/:id/favorite', () => HttpResponse.json({ favorite: true })),
    );
    const { router, user } = await renderApp('/favorites');
    await screen.findByText('No favorites yet.');

    await router.push('/recipes/recipe-bread');
    const favorite = await screen.findByRole('button', { name: 'Favorite' });
    await user.click(favorite);
    await screen.findByRole('button', { name: 'Favorite', pressed: true });
    await router.push('/favorites');

    await screen.findByRole('heading', { level: 1, name: 'Favorites' });
    expect(screen.queryByText('No favorites yet.')).toBeNull();
    expect(screen.getByText('Loading recipes…')).toBeDefined();
    askedAgain.resolve(undefined);
    await screen.findByRole('link', { name: 'Weeknight Bread' });
  });
});
