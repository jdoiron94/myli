import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { RecipeSummary } from '@/recipes/recipe.ts';
import { cardParts, sampleSummary as hit } from '@/recipes/testing.ts';
import type { SearchResult } from '@/search/search.ts';
import {
  apiServer,
  describedBy,
  listItems,
  NO_SEARCH_RESULTS,
  problemResponse,
  renderApp,
} from '@/testing.ts';

const found = (hits: RecipeSummary[], overrides: Partial<SearchResult> = {}): SearchResult => ({
  ...NO_SEARCH_RESULTS,
  hits,
  totalHits: hits.length,
  totalPages: hits.length > 0 ? 1 : 0,
  ...overrides,
});

/** Answers each search with `answer`, keeping each one's query parameters. */
function answerSearches(answer: (params: URLSearchParams) => SearchResult) {
  const asked: URLSearchParams[] = [];
  apiServer.use(
    http.get('/api/v1/search/recipes', ({ request }) => {
      const params = new URL(request.url).searchParams;
      asked.push(params);
      return HttpResponse.json(answer(params));
    }),
  );
  return asked;
}

const recipeList = () => screen.findByRole('list', { name: 'Recipes' });

const countText = async () => {
  await recipeListOrEmpty();
  return screen
    .getByText(/recipes?\b|No recipes/, { selector: '[role="status"]' })
    .textContent.trim();
};
async function recipeListOrEmpty() {
  await waitFor(() => {
    expect(screen.queryByText('Searching…')).toBeNull();
  });
}

describe('search', () => {
  it('shows the recipes found, each card going to its recipe', async () => {
    answerSearches(() =>
      found([
        hit(),
        hit({
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
          rating: { average: 4.5, count: 2 },
        }),
      ]),
    );
    await renderApp('/search');

    const cards = within(await recipeList()).getAllByRole('article');
    expect(await countText()).toBe('2 recipes');
    expect(cards.map(cardParts)).toEqual([
      {
        title: 'Green Curry',
        facts: '40 min · Medium',
        tags: ['Thai', 'Dinner', 'Vegan', 'Weeknight'],
      },
      {
        title: 'Cardamom Buns',
        facts: 'Hard 4.5 stars Private',
        tags: ['Contains milk, wheat', 'Swedish'],
      },
    ]);
    const link = within(cards[0] ?? document.body).getByRole('link', { name: 'Green Curry' });
    expect(link.getAttribute('href')).toBe('/recipes/curry');
  });

  it('searches for what the address says, and says how many it found', async () => {
    const asked = answerSearches(() => found([hit()], { totalHits: 30, totalPages: 2, page: 2 }));
    await renderApp('/search?q=curry&cuisine=Thai&cuisine=Italian&page=2&sort=rating');

    await recipeList();
    expect(await countText()).toBe('30 recipes');
    expect(asked.map((params) => [...params.entries()])).toEqual([
      [
        ['q', 'curry'],
        ['in', 'all'],
        ['cuisine', 'Thai'],
        ['cuisine', 'Italian'],
        ['page', '2'],
        ['sort', 'rating'],
      ],
    ]);
    expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toHaveProperty(
      'value',
      'curry',
    );
  });

  it('searches when asked, from the first page, keeping the rest of the search', async () => {
    const asked = answerSearches(() => found([hit()]));
    const { router, user } = await renderApp('/search?diet=Vegan&page=3');
    await recipeList();

    await user.type(screen.getByRole('searchbox', { name: 'Search recipes' }), '  basil {Enter}');

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ q: 'basil', diet: ['Vegan'] });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.get('q')).toBe('basil');
    });

    await user.click(screen.getByRole('checkbox', { name: 'Ingredient names only' }));

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({
        q: 'basil',
        in: 'ingredients',
        diet: ['Vegan'],
      });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.get('in')).toBe('ingredients');
    });
  });

  it('sorts as chosen, offering the best match only for a search with words', async () => {
    const asked = answerSearches(() => found([hit(), hit({ id: 'other', title: 'Pad Thai' })]));
    const { router, user } = await renderApp('/search');
    await recipeList();
    const sortBy = () => screen.getByRole('combobox', { name: 'Sort by' });
    const options = () =>
      within(sortBy())
        .getAllByRole('option')
        .map((option) => option.textContent.trim());

    expect(options()).toEqual(['Newest', 'Top rated', 'Quickest', 'Longest']);
    await user.selectOptions(sortBy(), 'Top rated');
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ sort: 'rating' });
    });

    await router.push('/search?q=curry');
    await waitFor(() => {
      expect(asked.at(-1)?.get('q')).toBe('curry');
    });
    expect(options()).toEqual(['Best match', 'Newest', 'Top rated', 'Quickest', 'Longest']);
    expect(sortBy()).toHaveProperty('value', 'relevance');

    // Without words, there's nothing to match: the newest come first, as the API sorts them.
    await router.push('/search?diet=Vegan&sort=relevance');
    await waitFor(() => {
      expect(asked.at(-1)?.get('diet')).toBe('Vegan');
    });
    expect(asked.at(-1)?.has('sort')).toBe(false);
    expect(sortBy()).toHaveProperty('value', 'newest');
  });

  it('goes from page to page, focusing the count above the new page’s recipes', async () => {
    answerSearches((params) => {
      const page = Number(params.get('page') ?? '1');
      return found([hit({ id: `page-${String(page)}`, title: `Recipe ${String(page)}` })], {
        totalHits: 60,
        totalPages: 3,
        page,
      });
    });
    const { router, user } = await renderApp('/search?q=curry');
    const pages = await screen.findByRole('navigation', { name: 'Pages' });
    expect(pages.textContent).toContain('Page 1 of 3');
    expect(within(pages).queryByRole('link', { name: 'Previous page' })).toBeNull();

    await user.click(within(pages).getByRole('link', { name: 'Next page' }));

    await screen.findByRole('link', { name: 'Recipe 2' });
    expect(router.currentRoute.value.query).toEqual({ q: 'curry', page: '2' });
    await waitFor(() => {
      expect(document.activeElement?.textContent.trim()).toBe('60 recipes');
    });
    expect(within(pages).getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe(
      '/search?q=curry',
    );
  });

  it('offers editors to write the first recipe, when there are none yet', async () => {
    await renderApp('/search');

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.getByRole('link', { name: 'Write the first one' }).getAttribute('href')).toBe(
      '/recipes/new',
    );
  });

  it('doesn’t offer viewers to write one, since they can’t', async () => {
    await renderApp('/search', { signedInAs: 'viewer' });

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.queryByRole('link', { name: 'Write the first one' })).toBeNull();
  });

  it('says when nothing matches', async () => {
    await renderApp('/search?q=nothing');

    expect(await countText()).toBe('No recipes match.');
    expect(screen.getByText('Try other words, or fewer filters.')).toBeDefined();
  });

  it('says when search is unavailable, and tries again when asked', async () => {
    let available = false;
    apiServer.use(
      http.get('/api/v1/search/recipes', () =>
        available
          ? HttpResponse.json(found([hit()]))
          : problemResponse(503, 'Search is unavailable right now.'),
      ),
    );
    const { user } = await renderApp('/search');

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      'Search is unavailable right now.',
    );
    available = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await recipeList();
  });
});

describe('search’s filters', () => {
  const FACETS: SearchResult['facets'] = {
    cuisine: { Thai: 3, Italian: 2 },
    mealType: { Dinner: 4 },
    diet: { Vegan: 2 },
    tag: { Weeknight: 1 },
    allergen: { milk: 2 },
    difficulty: { easy: 3, medium: 1 },
  };
  const answerWithFacets = (facets = FACETS) =>
    answerSearches(() => found([hit()], { totalHits: 5, facets }));
  const filters = () => screen.findByRole('region', { name: 'Filters' });
  const group = async (name: string) => within(await filters()).getByRole('group', { name });

  it('shows each filter’s values, with how many recipes each gives', async () => {
    answerWithFacets();
    await renderApp('/search');

    const cuisine = await group('Cuisine');
    expect(within(cuisine).getByText('Any of those checked.')).toBeDefined();
    expect(describedBy(within(cuisine).getByRole('checkbox', { name: 'Thai' }))).toEqual([
      '3 recipes',
    ]);
    const diet = await group('Diet');
    expect(within(diet).getByText('All of those checked.')).toBeDefined();
    expect(describedBy(within(await group('Other tags')).getByRole('checkbox'))).toEqual([
      '1 recipe',
    ]);
    const difficulty = await group('Difficulty');
    expect(
      within(difficulty)
        .getAllByRole('checkbox')
        .map((box) => [box.getAttribute('aria-checked'), describedBy(box)[0]]),
    ).toEqual([
      ['false', '3 recipes'],
      ['false', '1 recipe'],
      ['false', '0 recipes'],
    ]);
    const allergens = await group('Leave out recipes with');
    expect(within(allergens).getAllByRole('checkbox')).toHaveLength(9);
    expect(describedBy(within(allergens).getByRole('checkbox', { name: 'milk' }))).toEqual([
      '2 recipes',
    ]);
    expect(
      within(await group('Total time')).getByRole('radio', { name: 'Any time' }),
    ).toHaveProperty('ariaChecked', 'true');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('includes and leaves out values, each a new search from the first page', async () => {
    const asked = answerWithFacets();
    const { router, user } = await renderApp('/search?q=curry&page=2');
    const cuisine = await group('Cuisine');

    await user.click(within(cuisine).getByRole('checkbox', { name: 'Thai' }));
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ q: 'curry', cuisine: ['Thai'] });
    });

    await user.click(within(cuisine).getByRole('button', { name: 'Leave out Italian' }));
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({
        q: 'curry',
        cuisine: ['Thai'],
        excludeCuisine: ['Italian'],
      });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.getAll('excludeCuisine')).toEqual(['Italian']);
    });
    const italian = within(cuisine).getByRole('checkbox', { name: 'Italian' });
    expect(italian.getAttribute('aria-checked')).toBe('false');
    // Left out, it's in no result, so it has no count.
    expect(describedBy(italian)).toEqual([]);
    expect(
      within(cuisine)
        .getByRole('button', { name: 'Leave out Italian' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    // Checking a value left out includes it instead.
    await user.click(italian);
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ q: 'curry', cuisine: ['Thai', 'Italian'] });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.getAll('cuisine')).toEqual(['Thai', 'Italian']);
    });
  });

  it('leaves out allergens, and narrows by difficulty and total time', async () => {
    const asked = answerWithFacets();
    const { router, user } = await renderApp('/search');

    await user.click(
      within(await group('Leave out recipes with')).getByRole('checkbox', { name: 'milk' }),
    );
    await user.click(within(await group('Difficulty')).getByRole('checkbox', { name: 'Easy' }));
    await user.click(
      within(await group('Total time')).getByRole('radio', { name: '30 min or less' }),
    );

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({
        excludeAllergen: ['milk'],
        difficulty: ['easy'],
        maxMinutes: '30',
      });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.get('maxMinutes')).toBe('30');
    });

    await user.click(within(await group('Total time')).getByRole('radio', { name: 'Any time' }));
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({
        excludeAllergen: ['milk'],
        difficulty: ['easy'],
      });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.has('maxMinutes')).toBe(false);
    });
  });

  it('shows a time range from the address that isn’t one of those offered', async () => {
    answerWithFacets();
    await renderApp('/search?minMinutes=20&maxMinutes=45');

    expect(
      within(await group('Total time')).getByRole('radio', { name: '20 min to 45 min' }),
    ).toHaveProperty('ariaChecked', 'true');
  });

  it('clears every filter, keeping the words and the order', async () => {
    const asked = answerWithFacets();
    const { router, user } = await renderApp(
      '/search?q=soup&diet=Vegan&excludeAllergen=milk&maxMinutes=30&sort=quickest',
    );

    await user.click(within(await filters()).getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ q: 'soup', sort: 'quickest' });
    });
    await waitFor(() => {
      expect(asked.at(-1)?.has('diet')).toBe(false);
    });
  });

  it('shows the most common values of a long list, until asked for all', async () => {
    const cuisines = [
      'Thai',
      'Italian',
      'Greek',
      'Mexican',
      'Indian',
      'French',
      'Korean',
      'Basque',
    ];
    answerWithFacets({
      ...FACETS,
      cuisine: Object.fromEntries(cuisines.map((name, index) => [name, 10 - index])),
    });
    const { user } = await renderApp('/search?excludeCuisine=Basque');
    const cuisine = await group('Cuisine');
    const names = () =>
      within(cuisine)
        .getAllByRole('checkbox')
        .map(
          (box) => box.id && document.querySelector(`label[for="${box.id}"]`)?.textContent.trim(),
        );

    // The six most common, and the one left out, which stays in sight.
    expect(names()).toEqual(['Thai', 'Italian', 'Greek', 'Mexican', 'Indian', 'French', 'Basque']);
    const more = within(cuisine).getByRole('button', { name: 'Show all 8 cuisines' });
    expect(more.getAttribute('aria-expanded')).toBe('false');

    await user.click(more);

    expect(names()).toEqual(cuisines.slice(0, 7).concat('Basque'));
    expect(more.textContent.trim()).toBe('Show fewer');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the filters behind a button on a phone, which says how many are chosen', async () => {
    answerWithFacets();
    const { user } = await renderApp('/search?diet=Vegan&difficulty=easy');
    const panel = await filters();

    const button = screen.getByRole('button', { name: 'Filters (2)' });
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(panel.classList).toContain('hidden');

    await user.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.classList).not.toContain('hidden');
  });

  it('has none when there are no recipes yet', async () => {
    await renderApp('/search');
    expect(await countText()).toBe('No recipes yet.');
    expect(screen.queryByRole('region', { name: 'Filters' })).toBeNull();
  });

  it('stays when filters find nothing, so they can be taken off again', async () => {
    await renderApp('/search?diet=Vegan');
    expect(await countText()).toBe('No recipes match.');
    expect(await filters()).toBeDefined();
  });
});

describe('search’s ingredient picker', () => {
  const SUGGESTIONS: Record<string, { name: string; recipes: number }[]> = {
    '': [
      { name: 'basil', recipes: 4 },
      { name: 'flour', recipes: 3 },
      { name: 'tofu', recipes: 1 },
    ],
    ba: [
      { name: 'basil', recipes: 4 },
      { name: 'banana', recipes: 1 },
    ],
    fl: [{ name: 'flour', recipes: 3 }],
  };

  /** Answers suggestions from SUGGESTIONS, keeping what each asked for. */
  function answerSuggestions() {
    const asked: string[] = [];
    apiServer.use(
      http.get('/api/v1/search/ingredients', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        asked.push(q);
        return HttpResponse.json({ ingredients: SUGGESTIONS[q] ?? [] });
      }),
    );
    return asked;
  }
  const combobox = () => screen.getByRole('combobox', { name: 'Add an ingredient' });
  /** Each option's name, as screen readers get it, and its description: how many recipes use it. */
  function optionsShown() {
    const names = new Map<Element, string>();
    const options = screen.getAllByRole('option', {
      name: (name, element) => {
        names.set(element, name);
        return true;
      },
    });
    return options.map((option) => [names.get(option), describedBy(option)[0]]);
  }

  it('suggests the ingredients recipes use as it’s typed in, and requires each one picked', async () => {
    const searches = answerSearches(() => found([hit()]));
    const asked = answerSuggestions();
    const { router, user } = await renderApp('/search?q=curry');
    await recipeList();
    expect(asked).toEqual([]);

    await user.click(combobox());
    await waitFor(() => {
      expect(optionsShown()).toEqual([
        ['basil', '4 recipes'],
        ['flour', '3 recipes'],
        ['tofu', '1 recipe'],
      ]);
    });
    await user.type(combobox(), 'ba');
    await waitFor(() => {
      expect(optionsShown()).toEqual([
        ['basil', '4 recipes'],
        ['banana', '1 recipe'],
      ]);
    });
    expect(asked).toEqual(['', 'ba']);

    await user.click(screen.getByRole('option', { name: 'basil' }));

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ q: 'curry', ingredient: ['basil'] });
    });
    await waitFor(() => {
      expect(searches.at(-1)?.getAll('ingredient')).toEqual(['basil']);
    });
    expect(listItems(screen.getByRole('list', { name: 'Ingredients chosen' }))).toEqual(['basil']);
    // Closed, so it doesn't cover them, and ready for the next.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combobox()).toHaveProperty('value', '');
    await user.keyboard('fl');
    await waitFor(() => {
      expect(optionsShown()).toEqual([['flour', '3 recipes']]);
    });
  });

  it('picks the one chosen with the keyboard', async () => {
    answerSearches(() => found([hit()]));
    answerSuggestions();
    const { router, user } = await renderApp('/search?ingredient=tofu');
    await recipeList();

    await user.click(combobox());
    await user.keyboard('ba');
    await waitFor(() => {
      expect(optionsShown()).toEqual([
        ['basil', '4 recipes'],
        ['banana', '1 recipe'],
      ]);
    });
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ ingredient: ['tofu', 'banana'] });
    });
  });

  it('says when no recipe uses anything like what’s typed', async () => {
    answerSearches(() => found([hit()]));
    answerSuggestions();
    const { user } = await renderApp('/search');
    await recipeList();

    await user.click(combobox());
    await user.type(combobox(), 'zzz');

    expect(await screen.findByText('No recipe uses an ingredient like that.')).toBeDefined();
    expect(screen.queryAllByRole('option')).toEqual([]);
  });

  it('takes an ingredient off with its button', async () => {
    const searches = answerSearches(() => found([hit()]));
    const { router, user } = await renderApp('/search?ingredient=basil&ingredient=tofu&page=2');
    const chosen = await screen.findByRole('list', { name: 'Ingredients chosen' });
    expect(listItems(chosen)).toEqual(['basil', 'tofu']);

    await user.click(within(chosen).getByRole('button', { name: 'Remove basil' }));

    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ ingredient: ['tofu'] });
    });
    await waitFor(() => {
      expect(searches.at(-1)?.getAll('ingredient')).toEqual(['tofu']);
    });
  });

  it('adds no <style> element with its suggestions open, which the Content Security Policy refuses', async () => {
    answerSearches(() => found([hit()]));
    answerSuggestions();
    const { user } = await renderApp('/search?ingredient=basil');
    await recipeList();

    await user.click(combobox());
    await screen.findAllByRole('option');

    expect(document.querySelectorAll('main style')).toHaveLength(0);
  });
});
