import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { RecipeList, RecipeSummary } from '@/recipes/recipe.ts';
import { cardParts, sampleSummary } from '@/recipes/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  NO_RECIPES,
  problemResponse,
  renderApp,
} from '@/testing.ts';

const listOf = (recipes: RecipeSummary[], overrides: Partial<RecipeList> = {}): RecipeList => ({
  ...NO_RECIPES,
  recipes,
  total: recipes.length,
  totalPages: recipes.length > 0 ? 1 : 0,
  ...overrides,
});

/** Answers each request for the list with `answer`, keeping the page each one asked for. */
function answerLists(answer: (page: number) => RecipeList) {
  const asked: (string | null)[] = [];
  apiServer.use(
    http.get('/api/v1/recipes', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page');
      asked.push(page);
      return HttpResponse.json(answer(Number(page ?? '1')));
    }),
  );
  return asked;
}

const recipeList = () => screen.findByRole('list', { name: 'Recipes' });
const countText = async () => {
  await waitFor(() => {
    expect(screen.queryByText('Loading recipes…')).toBeNull();
  });
  return screen
    .getByText(/recipes?\b|No recipes/, { selector: '[role="status"]' })
    .textContent.trim();
};

describe('home', () => {
  it('lists the recipes the reader may see, each card going to its recipe', async () => {
    const asked = answerLists(() =>
      listOf([
        sampleSummary(),
        sampleSummary({
          id: 'buns',
          title: 'Cardamom Buns',
          difficulty: 'hard',
          totalMinutes: null,
          cuisine: ['Swedish'],
          mealType: [],
          diet: [],
          tags: [],
          allergens: ['milk', 'wheat'],
          visibility: 'private',
        }),
      ]),
    );
    await renderApp('/');

    const cards = within(await recipeList()).getAllByRole('article');
    expect(await countText()).toBe('2 recipes');
    expect(asked).toEqual(['1']);
    expect(cards.map(cardParts)).toEqual([
      {
        title: 'Green Curry',
        facts: '40 min · Medium',
        tags: ['Thai', 'Dinner', 'Vegan', 'Weeknight'],
      },
      { title: 'Cardamom Buns', facts: 'Hard Private', tags: ['Contains milk, wheat', 'Swedish'] },
    ]);
    const link = within(cards[0] ?? document.body).getByRole('link', { name: 'Green Curry' });
    expect(link.getAttribute('href')).toBe('/recipes/curry');
    expect(screen.queryByRole('search')).toBeNull();
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('lists recipes while search is unavailable, since it doesn’t search', async () => {
    let searched = false;
    answerLists(() => listOf([sampleSummary()]));
    apiServer.use(
      http.get('/api/v1/search/recipes', () => {
        searched = true;
        return problemResponse(503, 'Search is unavailable right now.');
      }),
    );
    await renderApp('/');

    await recipeList();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(searched).toBe(false);
  });

  it('goes from page to page, focusing the count above the new page’s recipes', async () => {
    const asked = answerLists((page) =>
      listOf([sampleSummary({ id: `page-${String(page)}`, title: `Recipe ${String(page)}` })], {
        total: 60,
        totalPages: 3,
        page,
      }),
    );
    const { router, user } = await renderApp('/?page=2');
    const pages = await screen.findByRole('navigation', { name: 'Pages' });
    await screen.findByRole('link', { name: 'Recipe 2' });
    expect(pages.textContent).toContain('Page 2 of 3');
    expect(within(pages).getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe(
      '/',
    );

    await user.click(within(pages).getByRole('link', { name: 'Next page' }));

    await screen.findByRole('link', { name: 'Recipe 3' });
    expect(router.currentRoute.value.query).toEqual({ page: '3' });
    await waitFor(() => {
      expect(document.activeElement?.textContent.trim()).toBe('60 recipes');
    });
    expect(within(pages).queryByRole('link', { name: 'Next page' })).toBeNull();
    expect(asked).toEqual(['2', '3']);
  });

  it('shows the first page for an address that asks for a page that can’t be', async () => {
    const asked = answerLists(() => listOf([sampleSummary()]));
    await renderApp('/?page=two');

    await recipeList();
    expect(asked).toEqual(['1']);
  });

  it('links to the first page from a page past the last', async () => {
    answerLists((page) => listOf([], { total: 3, totalPages: 1, page }));
    await renderApp('/?page=4');

    expect(await countText()).toBe('3 recipes');
    expect(screen.getByText(/There are no recipes on this page/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Go to the first page' }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('offers editors to write the first recipe, when there are none yet', async () => {
    await renderApp('/');

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.getByRole('link', { name: 'Write the first one' }).getAttribute('href')).toBe(
      '/recipes/new',
    );
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('doesn’t offer viewers to write one, since they can’t', async () => {
    await renderApp('/', { signedInAs: 'viewer' });

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.queryByRole('link', { name: 'Write the first one' })).toBeNull();
  });

  it('says when the list can’t be loaded, and tries again when asked', async () => {
    let failing = true;
    apiServer.use(
      http.get('/api/v1/recipes', () =>
        failing ? problemResponse(500, 'Boom.') : HttpResponse.json(listOf([sampleSummary()])),
      ),
    );
    const { user } = await renderApp('/');

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await recipeList();
  });
});
