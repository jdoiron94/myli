import { displayAmount, formatAmount } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { answerPreferences } from '@/account/testing.ts';
import { USER_LINK_REL } from '@/lib/markdown.ts';
import { recipeQuery } from '@/recipes/recipe.ts';
import { answerRecipe, answerTags, sampleImage, sampleRecipe } from '@/recipes/testing.ts';
import { apiServer, describedBy, problemResponse, renderApp, testUsers } from '@/testing.ts';

const URL_ = 'https://www.example.com/a/b';
/** What each of the recipe's tags says, in order. */
const tagChips = () =>
  within(screen.getByRole('list', { name: 'Tags' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent.replace(/\s+/g, ' ').trim());
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

  it('shows its photos at the top in a slideshow, the cover first, and each step’s in its step', async () => {
    answerRecipe(
      sampleRecipe({
        images: [
          sampleImage('a', 'The crumb, up close.'),
          sampleImage('b', 'A crusty loaf on a board.'),
          sampleImage('c'),
        ],
        coverImageId: 'b',
        steps: [
          { body: 'Mix everything.', image: null },
          { body: 'Shape it.', image: sampleImage('d', 'Dough shaped into a round.') },
        ],
      }),
    );
    await renderApp('/recipes/recipe-bread');
    await heading();

    const photos = [...document.querySelectorAll('article img')];
    expect(
      photos.map((photo) => ({
        src: photo.getAttribute('src'),
        loading: photo.getAttribute('loading'),
        alt: photo.getAttribute('alt'),
      })),
    ).toEqual([
      {
        src: '/api/v1/images/b/1280',
        loading: 'eager',
        alt: 'A crusty loaf on a board.',
      },
      {
        src: '/api/v1/images/a/1280',
        loading: 'lazy',
        alt: 'The crumb, up close.',
      },
      // Left out for screen readers, without alt text.
      { src: '/api/v1/images/c/1280', loading: 'lazy', alt: '' },
      {
        src: '/api/v1/images/d/1280',
        loading: 'lazy',
        alt: 'Dough shaped into a round.',
      },
    ]);
    // A slide each, which says where it is, the cover first and showing.
    const slideshow = screen.getByRole('region', { name: 'Photos' });
    expect(slideshow.getAttribute('aria-roledescription')).toBe('carousel');
    const slides = within(slideshow).getAllByRole('group');
    expect(
      slides.map((slide) => [
        slide.getAttribute('aria-label'),
        slide.querySelector('img')?.getAttribute('src'),
      ]),
    ).toEqual([
      ['1 of 3', '/api/v1/images/b/1280'],
      ['2 of 3', '/api/v1/images/a/1280'],
      ['3 of 3', '/api/v1/images/c/1280'],
    ]);
    expect(within(slideshow).getByText('1 of 3', { exact: false }).textContent.trim()).toBe(
      'Photo 1 of 3',
    );
    // There's no going back from the first, but the button stays where it is, for focus.
    const previous = within(slideshow).getByRole('button', { name: 'Previous photo' });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    const next = within(slideshow).getByRole('button', { name: 'Next photo' });
    expect(next.getAttribute('aria-disabled')).toBeNull();
    expect(photos[0]?.getAttribute('srcset')).toBe(
      '/api/v1/images/b/640 640w, /api/v1/images/b/1280 1280w, /api/v1/images/b/1600 1600w',
    );
    // Its place is kept while it loads.
    expect([photos[0]?.getAttribute('width'), photos[0]?.getAttribute('height')]).toEqual([
      '1600',
      '1200',
    ]);
    const steps = within(screen.getByRole('region', { name: 'Steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('img')?.getAttribute('src') ?? null)).toEqual([
      null,
      '/api/v1/images/d/1280',
    ]);
  });

  it('shows a single photo as the cover, without a slideshow, and none without photos', async () => {
    answerRecipe(sampleRecipe({ images: [sampleImage('a', 'A crusty loaf.')], coverImageId: 'a' }));
    const { queryClient } = await renderApp('/recipes/recipe-bread');
    await heading();
    const shown = () => ({
      photos: [...document.querySelectorAll('article img')].map((photo) => [
        photo.getAttribute('src'),
        photo.getAttribute('loading'),
      ]),
      slideshow: screen.queryByRole('region', { name: 'Photos' }) !== null,
    });

    const one = shown();
    queryClient.setQueryData(recipeQuery('recipe-bread').queryKey, sampleRecipe());
    await nextTick();

    expect({ one, none: shown() }).toEqual({
      one: { photos: [['/api/v1/images/a/1280', 'eager']], slideshow: false },
      none: { photos: [], slideshow: false },
    });
  });

  it('numbers the steps, rendering their markdown', async () => {
    answerRecipe(
      sampleRecipe({
        steps: [
          { body: 'Roll it up.\n# Not a heading', image: null },
          { body: 'Bake.', image: null },
        ],
      }),
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

  it('says where a recipe is from: where it was published, linked if it has an address, and who wrote it', async () => {
    answerRecipe(sampleRecipe());
    const { queryClient } = await renderApp('/recipes/recipe-bread');
    await heading();
    const sources = {
      'an address, a title and an author': {
        url: URL_,
        title: 'Example Bakes',
        author: 'A. Baker',
      },
      'an address only': { url: URL_, title: null, author: null },
      'a title only': { url: null, title: 'The Bread Book', author: null },
      'an author only': { url: null, title: null, author: 'A. Baker' },
      nothing: { url: null, title: null, author: null },
    };

    const said: Record<string, { text: string; link: string | null; href: string | null } | null> =
      {};
    for (const [given, source] of Object.entries(sources)) {
      queryClient.setQueryData(recipeQuery('recipe-bread').queryKey, sampleRecipe({ source }));
      await nextTick();
      const line = screen.queryByText(/^(From|Recipe by)\b/);
      const link = line && within(line).queryByRole('link');
      said[given] = line && {
        text: line.textContent.replace(/\s+/g, ' ').trim(),
        link: link?.textContent.trim() ?? null,
        href: link?.getAttribute('href') ?? null,
      };
    }

    expect(said).toEqual({
      'an address, a title and an author': {
        text: 'From Example Bakes by A. Baker',
        link: 'Example Bakes',
        href: URL_,
      },
      'an address only': { text: 'From www.example.com', link: 'www.example.com', href: URL_ },
      'a title only': { text: 'From The Bread Book', link: null, href: null },
      'an author only': { text: 'Recipe by A. Baker', link: null, href: null },
      nothing: null,
    });
  });

  it('shows what a recipe contains first among its tags, then the rest by type, and either alone', async () => {
    answerRecipe(sampleRecipe());
    const { queryClient } = await renderApp('/recipes/recipe-bread');
    await heading();
    const tagSets = {
      'allergens and others': [
        { id: 1, type: 'custom', name: 'Weeknight' },
        { id: 2, type: 'allergen', name: 'milk' },
        { id: 3, type: 'cuisine', name: 'Italian' },
        { id: 4, type: 'allergen', name: 'wheat' },
        { id: 5, type: 'diet', name: 'Vegetarian' },
      ],
      'allergens only': [{ id: 2, type: 'allergen', name: 'eggs' }],
      'no allergens': [{ id: 3, type: 'cuisine', name: 'Italian' }],
      none: [],
    } as const;

    const shown: Record<string, string[] | null> = {};
    for (const [given, tags] of Object.entries(tagSets)) {
      queryClient.setQueryData(
        recipeQuery('recipe-bread').queryKey,
        sampleRecipe({ tags: [...tags] }),
      );
      await nextTick();
      shown[given] = screen.queryByRole('list', { name: 'Tags' }) ? tagChips() : null;
    }

    expect(shown).toEqual({
      'allergens and others': ['Contains milk, wheat', 'Italian', 'Vegetarian', 'Weeknight'],
      'allergens only': ['Contains eggs'],
      'no allergens': ['Italian'],
      none: null,
    });
  });

  it('says when a recipe is private', async () => {
    answerRecipe(sampleRecipe({ visibility: 'private' }));
    await renderApp('/recipes/recipe-bread');

    await heading();
    const label = screen.getByText('Private');
    expect(label.textContent.trim()).toBe('Private');
  });

  it("links editors to editing someone else's shared recipe", async () => {
    answerRecipe(sampleRecipe({ owner: { id: testUsers.admin.id, name: testUsers.admin.name } }));
    answerTags();
    const { router, user } = await renderApp('/recipes/recipe-bread', { signedInAs: 'editor' });
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
  it('says what’s wrong with servings it can’t use, and leaves the last ones it could applied', async () => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    const outcomes: Record<string, { said: string[]; kept: string }> = {};
    // Typed a character at a time, 1001 is 100 before it's too many.
    for (const typed of ['', 'two', '0', '1001']) {
      await user.clear(servingsField());
      if (typed) await user.type(servingsField(), typed);
      const said =
        servingsField().getAttribute('aria-invalid') === 'true' ? describedBy(servingsField()) : [];
      await user.tab();
      expect(servingsField().getAttribute('aria-invalid')).toBeNull();
      outcomes[typed] = { said, kept: (servingsField() as HTMLInputElement).value };
      if (typed === '0') {
        expect(ingredients()).toEqual(['3 cups all-purpose flour', 'salt, to taste']);
      }
    }

    const message = ['Enter a whole number from 1 to 1000.'];
    expect(outcomes).toEqual({
      '': { said: message, kept: '8' },
      two: { said: message, kept: '8' },
      '0': { said: message, kept: '8' },
      '1001': { said: message, kept: '100' },
    });
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

  it('offers the units as one switch, short names shown and full ones read, moved with arrows', async () => {
    answerRecipe(sampleRecipe());
    const saved: unknown[] = [];
    apiServer.use(
      http.put('/api/v1/me/preferences', async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        return HttpResponse.json({ preferences: body });
      }),
    );
    const { user } = await renderApp('/recipes/recipe-bread');
    await heading();

    const units = await screen.findByRole('radiogroup', { name: 'Units' });
    const radios = within(units).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent.trim())).toEqual(['US', 'Metric']);
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'US customary',
      'Metric',
    ]);
    // Tab goes to the chosen one, after the servings; the arrows move between them, choosing.
    screen.getByRole('button', { name: 'More servings' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(radios[0]);
    // Held, then let go: reka-ui chooses the radio it moved focus to only if the arrow key is still
    // down a moment later, as it is when a person presses it, not after an instant press.
    await user.keyboard('{ArrowRight>}');
    await user.keyboard('{/ArrowRight}');

    await waitFor(() => {
      expect(saved).toEqual([{ unitSystem: 'metric' }]);
    });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');
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
