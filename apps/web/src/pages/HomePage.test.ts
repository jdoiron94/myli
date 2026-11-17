import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { SearchHit, SearchResult } from '@/search/search.ts';
import {
  accessibilityViolations,
  apiServer,
  NO_SEARCH_RESULTS,
  problemResponse,
  renderApp,
} from '@/testing.ts';

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
  id: 'curry',
  title: 'Green Curry',
  difficulty: 'medium',
  totalMinutes: 40,
  cuisine: ['Thai'],
  mealType: ['Dinner'],
  diet: ['Vegan'],
  tags: ['Weeknight'],
  allergens: [],
  visibility: 'shared',
  ...overrides,
});

const found = (hits: SearchHit[], overrides: Partial<SearchResult> = {}): SearchResult => ({
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

/** What a result card says: its title, the line of facts under it, and its tags. */
function cardParts(card: HTMLElement) {
  const text = (element: Element | null | undefined) =>
    element?.textContent.replace(/\s+/g, ' ').trim();
  const tags = within(card).queryByRole('list', { name: 'Tags' });
  return {
    title: text(within(card).getByRole('heading', { level: 2 })),
    facts: [...card.querySelectorAll('p span')].map((span) => text(span)).join(' '),
    tags: tags
      ? within(tags)
          .getAllByRole('listitem')
          .map((item) => text(item))
      : [],
  };
}
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

describe('home', () => {
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
        }),
      ]),
    );
    await renderApp('/');

    const cards = within(await recipeList()).getAllByRole('article');
    expect(await countText()).toBe('2 recipes');
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
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('searches for what the address says, and says how many it found', async () => {
    const asked = answerSearches(() => found([hit()], { totalHits: 30, totalPages: 2, page: 2 }));
    await renderApp('/?q=curry&cuisine=Thai&cuisine=Italian&page=2&sort=rating');

    await recipeList();
    expect(await countText()).toBe('30 recipes');
    expect(asked.map((params) => [...params.entries()])).toEqual([
      [
        ['q', 'curry'],
        ['in', 'all'],
        ['cuisine', 'Thai'],
        ['cuisine', 'Italian'],
        ['page', '2'],
      ],
    ]);
    expect(screen.getByRole('searchbox', { name: 'Search recipes' })).toHaveProperty(
      'value',
      'curry',
    );
  });

  it('searches when asked, from the first page, keeping the rest of the search', async () => {
    const asked = answerSearches(() => found([hit()]));
    const { router, user } = await renderApp('/?diet=Vegan&page=3');
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
    const { router, user } = await renderApp('/');
    await recipeList();
    const sortBy = () => screen.getByRole('combobox', { name: 'Sort by' });
    const options = () =>
      within(sortBy())
        .getAllByRole('option')
        .map((option) => option.textContent.trim());

    expect(options()).toEqual(['Newest', 'Quickest', 'Longest']);
    await user.selectOptions(sortBy(), 'Quickest');
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ sort: 'quickest' });
    });

    await router.push('/?q=curry');
    await waitFor(() => {
      expect(asked.at(-1)?.get('q')).toBe('curry');
    });
    expect(options()).toEqual(['Best match', 'Newest', 'Quickest', 'Longest']);
    expect(sortBy()).toHaveProperty('value', 'relevance');

    // Without words, there's nothing to match: the newest come first, as the API sorts them.
    await router.push('/?diet=Vegan&sort=relevance');
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
    const { router, user } = await renderApp('/?q=curry');
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
      '/?q=curry',
    );
  });

  it('offers editors to write the first recipe, when there are none yet', async () => {
    await renderApp('/');

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.getByRole('link', { name: 'Write the first one' }).getAttribute('href')).toBe(
      '/recipes/new',
    );
  });

  it('doesn’t offer viewers to write one, since they can’t', async () => {
    await renderApp('/', { signedInAs: 'viewer' });

    expect(await countText()).toBe('No recipes yet.');
    expect(screen.queryByRole('link', { name: 'Write the first one' })).toBeNull();
  });

  it('says when nothing matches', async () => {
    await renderApp('/?q=nothing');

    expect(await countText()).toBe('No recipes match.');
    expect(screen.getByText('Try other words, or fewer of them.')).toBeDefined();
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
    const { user } = await renderApp('/');

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      'Search is unavailable right now.',
    );
    available = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await recipeList();
  });
});
