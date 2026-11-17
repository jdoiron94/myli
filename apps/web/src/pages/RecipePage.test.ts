import { displayAmount, formatAmount } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { USER_LINK_REL } from '@/lib/markdown.ts';
import { answerRecipe, answerTags, sampleRecipe } from '@/recipes/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  describedBy,
  problemResponse,
  renderApp,
  testUsers,
} from '@/testing.ts';

const URL_ = 'https://www.example.com/a/b';
/** What the page says the ingredients contain, if anything. */
const containsLine = () =>
  screen.queryByText('Contains:')?.parentElement?.textContent.replace(/\s+/g, ' ').trim() ?? null;
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
    expect(screen.getByText('Added by Ada Lovelace')).toBeDefined();
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

  it('numbers the steps, rendering their markdown', async () => {
    answerRecipe(
      sampleRecipe({ steps: [{ body: 'Roll it up.\n# Not a heading' }, { body: 'Bake.' }] }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(within(steps).getByRole('list').tagName).toBe('OL');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
    expect(within(steps).queryByRole('heading', { level: 3 })).toBeNull();
    expect(within(steps).getByText(/# Not a heading/)).toBeDefined();
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
    expect(source.getAttribute('rel')).toBe(USER_LINK_REL);
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

  it.each([
    [{ url: URL_, title: 'Example Bakes', author: 'A. Baker' }, 'From Example Bakes by A. Baker'],
    [{ url: URL_, title: 'Example Bakes', author: null }, 'From Example Bakes'],
    [{ url: URL_, title: null, author: 'A. Baker' }, 'From www.example.com by A. Baker'],
    [{ url: URL_, title: null, author: null }, 'From www.example.com'],
    [{ url: null, title: 'The Bread Book', author: 'A. Baker' }, 'From The Bread Book by A. Baker'],
    [{ url: null, title: 'The Bread Book', author: null }, 'From The Bread Book'],
    [{ url: null, title: null, author: 'A. Baker' }, 'Recipe by A. Baker'],
  ])('says where a recipe is from, given %o', async (source, said) => {
    answerRecipe(sampleRecipe({ source }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    const line = screen.getByText(/^(From|Recipe by)\b/);
    expect(line.textContent.replace(/\s+/g, ' ').trim()).toBe(said);
    const link = within(line).queryByRole('link');
    expect(link?.textContent.trim() ?? null).toBe(
      source.url === null ? null : (source.title ?? 'www.example.com'),
    );
    expect(link?.getAttribute('href') ?? null).toBe(source.url);
  });

  it('says nothing of a source when none is given', async () => {
    answerRecipe(sampleRecipe({ source: { url: null, title: null, author: null } }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.queryByText(/^(From|Recipe by)\b/)).toBeNull();
  });

  it('shows the tags in one list, by type, and what the ingredients contain after them', async () => {
    answerRecipe(
      sampleRecipe({
        tags: [
          { id: 1, type: 'custom', name: 'Weeknight' },
          { id: 2, type: 'allergen', name: 'milk' },
          { id: 3, type: 'cuisine', name: 'Italian' },
          { id: 4, type: 'allergen', name: 'wheat' },
          { id: 5, type: 'diet', name: 'Vegetarian' },
        ],
      }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(
      within(screen.getByRole('list', { name: 'Tags' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim()),
    ).toEqual(['Italian', 'Vegetarian', 'Weeknight']);
    expect(containsLine()).toBe('Contains: milk, wheat');
    // In the ingredients, after the last of them, as on a food label.
    const ingredients = screen.getByRole('region', { name: 'Ingredients' });
    const lines = within(ingredients).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent.trim())).toEqual([
      '3 cups all-purpose flour',
      'salt, to taste',
    ]);
    const contains = within(ingredients).getByText('Contains:');
    expect(
      lines.every(
        (line) => line.compareDocumentPosition(contains) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it('says what the ingredients contain, even when there are none yet', async () => {
    answerRecipe(
      sampleRecipe({ ingredientGroups: [], tags: [{ id: 2, type: 'allergen', name: 'eggs' }] }),
    );
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByText('No ingredients yet.')).toBeDefined();
    expect(containsLine()).toBe('Contains: eggs');
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
  });

  it('shows neither tags nor allergens for a recipe without them', async () => {
    answerRecipe(sampleRecipe({ tags: [] }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
    expect(containsLine()).toBeNull();
  });

  it('says when a recipe is private', async () => {
    answerRecipe(sampleRecipe({ visibility: 'private' }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    expect(screen.getByText('Private: only you can see it')).toBeDefined();
  });

  it.each([
    ['their own recipe', 'editor', testUsers.editor],
    ["someone else's shared recipe", 'editor', testUsers.admin],
  ] as const)('links editors to editing %s', async (_, role, owner) => {
    answerRecipe(sampleRecipe({ owner: { id: owner.id, name: owner.name } }));
    answerTags();
    const { router, user } = await renderApp('/recipes/recipe-bread', { signedInAs: role });
    await heading();
    await screen.findByRole('radio', { name: 'US customary' });

    await user.click(screen.getByRole('link', { name: 'Edit recipe' }));

    await screen.findByRole('textbox', { name: 'Title' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread/edit');
    await screen.findByRole('checkbox', { name: 'Italian' });
  });

  it("doesn't offer viewers to edit", async () => {
    answerRecipe(sampleRecipe());
    await renderApp('/recipes/recipe-bread', { signedInAs: 'viewer' });
    await heading();
    await screen.findByRole('radio', { name: 'US customary' });

    expect(screen.queryByRole('link', { name: 'Edit recipe' })).toBeNull();
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
    answerPreferences();
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

describe('scaling a recipe', () => {
  const ingredients = () =>
    within(screen.getByRole('region', { name: 'Ingredients' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent.trim());
  const servingsField = () => screen.getByRole('textbox', { name: 'Servings' });
  const status = () =>
    within(screen.getByRole('region', { name: 'Ingredients' })).getByRole('status');

  it('scales the amounts to the servings typed in, and back', async () => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();
    expect(servingsField()).toHaveProperty('value', '8');
    expect(status().textContent.trim()).toBe('');

    await user.clear(servingsField());
    await user.type(servingsField(), '16');

    // 6 cups: moved up to the largest unit where it's a fraction cooks use.
    expect(ingredients()).toEqual(['1½ quarts all-purpose flour', 'salt, to taste']);
    expect(status().textContent.replace(/\s+/g, ' ').trim()).toBe(
      "Amounts for 16 servings, scaled from the recipe's 8.",
    );
    // The recipe's own facts don't change.
    expect(
      screen.getByText('Servings', { selector: 'dt' }).nextElementSibling?.textContent.trim(),
    ).toBe('8');

    await user.click(screen.getByRole('button', { name: 'Back to 8 servings' }));

    expect(ingredients()).toEqual(['3 cups all-purpose flour', 'salt, to taste']);
    expect(servingsField()).toHaveProperty('value', '8');
    expect(document.activeElement).toBe(servingsField());
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
    expect(status().textContent.trim()).toBe('');
  });

  it('steps one serving at a time, as fractions cooks use', async () => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    for (let i = 0; i < 4; i++)
      await user.click(screen.getByRole('button', { name: 'Fewer servings' }));

    expect(servingsField()).toHaveProperty('value', '4');
    expect(ingredients()).toEqual(['1½ cups all-purpose flour', 'salt, to taste']);
    expect(status().textContent).toContain('Amounts for 4 servings');
  });

  it('stops at one serving, keeping focus on the button', async () => {
    answerRecipe(sampleRecipe({ servings: 2 }));
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();
    const fewer = screen.getByRole('button', { name: 'Fewer servings' });

    await user.click(fewer);
    expect(fewer.getAttribute('aria-disabled')).toBe('true');
    await user.click(fewer);

    expect(servingsField()).toHaveProperty('value', '1');
    expect(status().textContent).toContain('Amounts for 1 serving,');
    expect(document.activeElement).toBe(fewer);
  });

  it('stops at the most servings a recipe can have', async () => {
    answerRecipe(sampleRecipe({ servings: 1000 }));
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();
    const more = screen.getByRole('button', { name: 'More servings' });
    expect(more.getAttribute('aria-disabled')).toBe('true');

    await user.click(more);
    expect(servingsField()).toHaveProperty('value', '1000');
  });

  // Whole numbers apply as they're typed, so "2.5" applies 2 on the way. Leaving the field shows the
  // number that applies.
  it.each([
    ['0', '8'],
    ['two', '8'],
    ['', '8'],
    ['2.5', '2'],
    ['1001', '100'],
  ])('says what’s wrong with %j, and leaves %s applied', async (typed, kept) => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    await user.clear(servingsField());
    if (typed) await user.type(servingsField(), typed);

    expect(servingsField().getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(servingsField())).toEqual(['Enter a whole number from 1 to 1000.']);

    await user.tab();
    expect(servingsField()).toHaveProperty('value', kept);
    expect(servingsField().getAttribute('aria-invalid')).toBeNull();
    if (kept === '8') expect(ingredients()).toEqual(['3 cups all-purpose flour', 'salt, to taste']);
  });

  it('starts each recipe at its own servings', async () => {
    answerRecipe(sampleRecipe());
    const { router, user } = await renderApp('/recipes/recipe-bread');
    await heading();
    await user.click(screen.getByRole('button', { name: 'More servings' }));
    expect(servingsField()).toHaveProperty('value', '9');

    apiServer.use(
      http.get('/api/v1/recipes/recipe-rolls', () =>
        HttpResponse.json({
          recipe: sampleRecipe({ id: 'recipe-rolls', title: 'Rolls', servings: 12 }),
        }),
      ),
    );
    await router.push('/recipes/recipe-rolls');

    await screen.findByRole('heading', { level: 1, name: 'Rolls' });
    expect(servingsField()).toHaveProperty('value', '12');
    expect(status().textContent.trim()).toBe('');
  });

  it('has no accessibility violations while scaled', async () => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();
    await user.click(screen.getByRole('button', { name: 'More servings' }));

    expect(await accessibilityViolations()).toEqual([]);
  });
});

describe('the reader’s units', () => {
  const ingredients = () =>
    within(screen.getByRole('region', { name: 'Ingredients' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent.trim());
  const inMetric = formatAmount(
    displayAmount(
      { qty: 3, qtyMax: null, unit: 'cup' },
      { system: 'metric', factor: 1, scalable: true },
    ),
  );

  it('shows amounts in the unit system the reader saved', async () => {
    answerRecipe(sampleRecipe());
    answerPreferences('metric');
    await renderApp('/recipes/recipe-bread');
    await heading();

    expect(
      (await screen.findByRole('radio', { name: 'Metric' })).getAttribute('aria-checked'),
    ).toBe('true');
    expect(ingredients()[0]).toBe(`${inMetric} all-purpose flour`);
  });

  it('saves a new choice, showing it at once', async () => {
    answerRecipe(sampleRecipe());
    const saved: unknown[] = [];
    let answer: (() => void) | undefined;
    apiServer.use(
      http.put('/api/v1/me/preferences', async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ preferences: body });
      }),
    );
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    await user.click(await screen.findByRole('radio', { name: 'Metric' }));

    // Shown while it's saved...
    await waitFor(() => {
      expect(saved).toEqual([{ unitSystem: 'metric' }]);
    });
    expect(ingredients()[0]).toBe(`${inMetric} all-purpose flour`);
    answer?.();
    // ...and after.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Metric' }).getAttribute('aria-checked')).toBe(
        'true',
      );
    });
    expect(ingredients()[0]).toBe(`${inMetric} all-purpose flour`);
  });

  it('goes back to the saved choice, and says why, when saving fails', async () => {
    answerRecipe(sampleRecipe());
    apiServer.use(
      http.put('/api/v1/me/preferences', () => problemResponse(503, 'Something went wrong.')),
    );
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    await user.click(await screen.findByRole('radio', { name: 'Metric' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Your choice of units couldn't be saved.");
    expect(ingredients()[0]).toBe('3 cups all-purpose flour');
    expect(screen.getByRole('radio', { name: 'US customary' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('waits for the saved choice before showing amounts, so they don’t change under the reader', async () => {
    answerRecipe(sampleRecipe());
    let answer: (() => void) | undefined;
    apiServer.use(
      http.get('/api/v1/me/preferences', async () => {
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json({ preferences: { unitSystem: 'metric' } });
      }),
    );
    await renderApp('/recipes/recipe-bread');
    await heading();

    const region = screen.getByRole('region', { name: 'Ingredients' });
    expect(within(region).queryAllByRole('listitem')).toEqual([]);
    expect(within(region).queryAllByRole('radio')).toEqual([]);
    await waitFor(() => {
      expect(answer).toBeDefined();
    });
    answer?.();

    await waitFor(() => {
      expect(ingredients()[0]).toBe(`${inMetric} all-purpose flour`);
    });
  });
});
