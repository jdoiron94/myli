import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/recipes/recipe.ts';
import { sampleRecipe } from '@/recipes/testing.ts';
import { accessibilityViolations, apiServer, problemResponse, renderApp } from '@/testing.ts';

/** Answers GET /recipes/{id} with this recipe, and counts the requests. */
function answerRecipe(recipe: Recipe) {
  const requests: string[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', ({ params }) => {
      requests.push(String(params.id));
      return params.id === recipe.id
        ? HttpResponse.json({ recipe })
        : problemResponse(404, 'There is no recipe with this ID.');
    }),
  );
  return requests;
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });

/** What a definition list says for each term, its definitions joined with commas. */
function definitions(list: HTMLElement) {
  const said: Record<string, string> = {};
  let term = '';
  for (const element of list.querySelectorAll('dt, dd')) {
    const text = element.textContent.trim();
    if (element.tagName === 'DT') {
      term = text;
      said[term] = '';
    } else {
      said[term] = said[term] ? `${said[term]}, ${text}` : text;
    }
  }
  return said;
}

describe('the recipe page', () => {
  it('shows the recipe under its title, which is also the tab’s', async () => {
    answerRecipe(sampleRecipe());
    await renderApp('/recipes/recipe-bread');

    await heading();
    await waitFor(() => {
      expect(document.title).toBe('Weeknight Bread · myli');
    });
    expect(screen.getByText('By Ada Lovelace')).toBeDefined();
    expect(screen.getByText(/^Updated /).textContent).toBe(
      `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date('2026-11-12T09:00:00.000Z'))}`,
    );
    expect(screen.queryByText(/Private/)).toBeNull();
    expect(screen.getByText('simple').tagName).toBe('EM');
  });

  it('shows the times, servings, yield and difficulty', async () => {
    answerRecipe(sampleRecipe({ totalMinutes: null }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(definitions(screen.getAllByRole('definition')[0]?.closest('dl') as HTMLElement)).toEqual(
      {
        Prep: '20 min',
        Cook: '40 min',
        Total: '1 hr',
        Servings: '8',
        Makes: '1 loaf',
        Difficulty: 'Easy',
      },
    );
  });

  it('shows a total time set by hand rather than prep plus cook', async () => {
    answerRecipe(sampleRecipe({ totalMinutes: 180 }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByText('Total').nextElementSibling?.textContent.trim()).toBe('3 hr');
  });

  it('leaves out the facts and sections a recipe doesn’t have', async () => {
    answerRecipe(
      sampleRecipe({
        description: '',
        source: { url: null, title: null, author: null },
        equipment: [],
        yield: null,
        prepMinutes: null,
        cookMinutes: null,
        totalMinutes: null,
        difficulty: null,
        nutrition: {
          calories: null,
          proteinGrams: null,
          carbsGrams: null,
          fatGrams: null,
          fiberGrams: null,
          sugarGrams: null,
          sodiumMilligrams: null,
        },
        ingredientGroups: [],
        steps: [],
      }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getAllByRole('term').map((term) => term.textContent.trim())).toEqual([
      'Servings',
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent.trim())).toEqual([
      'Ingredients',
      'Steps',
    ]);
    expect(screen.getByText('No ingredients yet.')).toBeDefined();
    expect(screen.getByText('No steps yet.')).toBeDefined();
    expect(screen.queryByText(/^From/)).toBeNull();
  });

  it('lists the ingredients as written, with no heading for a single group', async () => {
    const [group] = sampleRecipe().ingredientGroups;
    if (!group) throw new Error('the sample has a group');
    answerRecipe(sampleRecipe({ ingredientGroups: [{ ...group, label: 'For the dough' }] }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    const ingredients = screen.getByRole('region', { name: 'Ingredients' });
    expect(within(ingredients).queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(
      within(ingredients)
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim()),
    ).toEqual(['3 cups all-purpose flour', 'salt, to taste']);
  });

  it('heads each labeled group when there are several', async () => {
    const water = sampleRecipe().ingredientGroups[0]?.ingredients[0];
    if (!water) throw new Error('the sample has a first line');
    answerRecipe(
      sampleRecipe({
        ingredientGroups: [
          { label: 'For the dough', ingredients: [water] },
          { label: null, ingredients: [{ ...water, name: 'water', qty: 1 }] },
          { label: 'For the glaze', ingredients: [{ ...water, name: 'sugar', qty: 0.5 }] },
        ],
      }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    const ingredients = screen.getByRole('region', { name: 'Ingredients' });
    expect(
      within(ingredients)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent.trim()),
    ).toEqual(['For the dough', 'For the glaze']);
    expect(
      within(ingredients)
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim()),
    ).toEqual(['3 cups all-purpose flour', '1 cup water', '½ cup sugar']);
  });

  it('numbers the steps, and puts headings written in them below the section’s', async () => {
    answerRecipe(sampleRecipe({ steps: [{ body: '# Shape\nRoll it up.' }, { body: 'Bake.' }] }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(within(steps).getByRole('list').tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
    expect(within(steps).getByRole('heading', { level: 3, name: 'Shape' })).toBeDefined();
  });

  it('shows the equipment, the source and the nutrition per serving', async () => {
    answerRecipe(sampleRecipe());
    await renderApp('/recipes/recipe-bread');

    await heading();
    const equipment = screen.getByRole('region', { name: 'Equipment' });
    expect(
      within(equipment)
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim()),
    ).toEqual(['Loaf pan', 'Stand mixer']);

    const source = screen.getByRole('link', { name: 'Example Bakes' });
    expect(source.getAttribute('href')).toBe('https://example.com/bread');
    expect(source.getAttribute('rel')).toBe('ugc nofollow noreferrer');
    expect(source.parentElement?.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'From Example Bakes by A. Baker',
    );

    const nutrition = screen.getByRole('region', { name: 'Nutrition' });
    expect(
      definitions(within(nutrition).getByText('Calories').closest('dl') as HTMLElement),
    ).toEqual({
      Calories: '210',
      Protein: '6 g',
      Carbohydrates: '40 g',
      Fat: `${(2.5).toLocaleString()} g`,
      Sodium: '380 mg',
    });
  });

  it('names a source by its address when it has no title', async () => {
    answerRecipe(
      sampleRecipe({ source: { url: 'https://www.example.com/a/b', title: null, author: null } }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByRole('link', { name: 'www.example.com' })).toBeDefined();
  });

  it.each([
    ['allergen', 'milk'],
    ['diet', 'Vegan'],
  ] as const)('warns that %s tags aren’t checked', async (type, name) => {
    answerRecipe(sampleRecipe({ tags: [{ id: 1, type, name }] }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByText(/nobody checks them/)).toBeDefined();
  });

  it('groups the tags by type, with a warning next to allergens and diets', async () => {
    answerRecipe(
      sampleRecipe({
        tags: [
          { id: 1, type: 'cuisine', name: 'Italian' },
          { id: 2, type: 'allergen', name: 'milk' },
          { id: 3, type: 'allergen', name: 'wheat' },
          { id: 4, type: 'custom', name: 'Weeknight' },
        ],
      }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    const tags = screen.getByText('Cuisine').closest('dl') as HTMLElement;
    expect(definitions(tags)).toEqual({
      Cuisine: 'Italian',
      Contains: 'milk, wheat',
      Tags: 'Weeknight',
    });
    expect(screen.getByText(/nobody checks them/)).toBeDefined();
  });

  it('leaves the warning out when there are no allergen or diet tags', async () => {
    answerRecipe(sampleRecipe({ tags: [{ id: 1, type: 'cuisine', name: 'Italian' }] }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.queryByText(/nobody checks them/)).toBeNull();
  });

  it('says when a recipe is private', async () => {
    answerRecipe(sampleRecipe({ visibility: 'private' }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByText('Private: only you can see it')).toBeDefined();
  });

  it('says the same thing for a recipe that doesn’t exist and one the reader may not see', async () => {
    const requests = answerRecipe(sampleRecipe());
    await renderApp('/recipes/someone-elses');

    await screen.findByRole('heading', { level: 1, name: 'Recipe not found' });
    expect(
      screen.getByText("This recipe doesn't exist, was deleted, or isn't shared with you."),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => {
      expect(document.title).toBe('Recipe not found · myli');
    });
    // A 404 isn't tried again.
    expect(requests).toEqual(['someone-elses']);
  });

  it('offers to try again when the recipe couldn’t be loaded', async () => {
    let fail = true;
    apiServer.use(
      http.get('/api/v1/recipes/:id', () =>
        fail
          ? problemResponse(503, 'Something went wrong.')
          : HttpResponse.json({ recipe: sampleRecipe() }),
      ),
    );
    const { user } = await renderApp('/recipes/recipe-bread');

    expect(await screen.findByRole('heading', { level: 1, name: 'Recipe' })).toBeDefined();
    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    await user.click(tryAgain);

    await heading();
  });

  it('moves focus to the recipe’s heading after navigating to it', async () => {
    answerRecipe(sampleRecipe());
    const { router } = await renderApp('/');

    await router.push('/recipes/recipe-bread');

    const title = await heading();
    await waitFor(() => {
      expect(document.activeElement).toBe(title);
    });
  });

  it('has no accessibility violations', async () => {
    answerRecipe(
      sampleRecipe({
        visibility: 'private',
        tags: [
          { id: 1, type: 'cuisine', name: 'Italian' },
          { id: 2, type: 'allergen', name: 'milk' },
        ],
      }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(await accessibilityViolations()).toEqual([]);
  });
});
