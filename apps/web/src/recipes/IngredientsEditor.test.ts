import { fireEvent, screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { apiServer, describedBy, renderApp } from '@/testing.ts';
import type { Recipe } from './recipe.ts';
import { answerRecipe, answerTags, sampleRecipe } from './testing.ts';

const line = (position: number, group?: number) =>
  within(group === undefined ? document.body : groupList(group)).getByRole('textbox', {
    name: `Ingredient ${String(position)}`,
  });
const lines = () =>
  screen
    .getAllByRole('textbox', { name: /^Ingredient \d+$/ })
    .map((input) => (input as HTMLInputElement).value);
const groupList = (group: number) =>
  screen.getByRole('list', { name: `Group ${String(group)} ingredients` });
const button = (name: string) => screen.getByRole('button', { name });

/** The new recipe page, with a title and servings filled in, ready to save. */
async function newRecipe() {
  const app = await renderApp('/recipes/new');
  await screen.findByRole('heading', { level: 1, name: 'New recipe' });
  await app.user.type(screen.getByRole('textbox', { name: 'Title' }), 'Weeknight Bread');
  await app.user.type(screen.getByRole('textbox', { name: 'Servings' }), '8');
  return app;
}

/** Answers POST /recipes, keeping the ingredient groups sent, and the page that opens next. */
function answerCreate() {
  const created = sampleRecipe({ id: 'recipe-new' });
  const recipeRequests = answerRecipe(created);
  const sent: unknown[] = [];
  apiServer.use(
    http.post('/api/v1/recipes', async ({ request }) => {
      const body = (await request.json()) as Pick<Recipe, 'ingredientGroups'>;
      sent.push(body.ingredientGroups);
      return HttpResponse.json({ recipe: created }, { status: 201 });
    }),
  );
  const opened = async () => {
    await screen.findByRole('radio', { name: 'US customary' });
    await waitFor(() => {
      expect(recipeRequests).toContain(created.id);
    });
  };
  return { sent, opened };
}

// The editor loads every tag.
beforeEach(() => {
  answerTags();
});

describe('the ingredients editor', () => {
  it('shows how myli reads each line as it’s typed', async () => {
    const { user } = await newRecipe();

    expect(describedBy(line(1))).toEqual([]);
    await user.type(line(1), '2 cups flour, sifted');
    expect(describedBy(line(1))).toEqual(['Reads as: 2 cups flour, sifted.']);

    await user.clear(line(1));
    await user.type(line(1), 'salt to taste');
    expect(describedBy(line(1))).toEqual([
      "Reads as: salt, to taste. Doesn't change with servings.",
    ]);

    await user.clear(line(1));
    await user.type(line(1), '2 cups');
    expect(describedBy(line(1))).toEqual(['Reads as: 2 cups no ingredient named.']);
  });

  it('starts the next line on Enter, rather than saving', async () => {
    const { user } = await newRecipe();

    await user.type(line(1), '2 cups flour{Enter}');
    expect(document.activeElement).toBe(line(2));
    await user.type(line(2), '1 tsp salt');
    await user.click(line(1));
    await user.keyboard('{Enter}');

    expect(lines()).toEqual(['2 cups flour', '', '1 tsp salt']);
    expect(document.activeElement).toBe(line(2));
    expect(screen.getByRole('heading', { level: 1, name: 'New recipe' })).toBeDefined();
  });

  it('leaves Enter to an input method composing a character', async () => {
    await newRecipe();

    await fireEvent.keyDown(line(1), { key: 'Enter', isComposing: true });

    expect(lines()).toEqual(['']);
  });

  it('takes a pasted list a line each, into the blank line and after it', async () => {
    const { user } = await newRecipe();

    await user.click(line(1));
    await user.paste('2 cups flour\r\n\n1 tsp salt\n  1 cup water  ');

    expect(lines()).toEqual(['2 cups flour', '1 tsp salt', '1 cup water']);
    expect(document.activeElement).toBe(line(3));

    await user.click(line(1));
    await user.paste('2 eggs\n1 tbsp oil');
    expect(lines()).toEqual(['2 cups flour', '2 eggs', '1 tbsp oil', '1 tsp salt', '1 cup water']);
    expect(document.activeElement).toBe(line(3));

    // A single line pastes as usual.
    await user.click(line(1));
    await user.paste(' (sifted)');
    expect(lines()[0]).toBe('2 cups flour (sifted)');
  });

  it('moves lines up and down, keeping focus on the button pressed', async () => {
    const { user } = await newRecipe();
    await user.click(line(1));
    await user.paste('flour\nsalt\nwater');

    await user.click(button('Move ingredient 1 down'));
    expect(lines()).toEqual(['salt', 'flour', 'water']);
    expect(document.activeElement).toBe(button('Move ingredient 2 down'));

    await user.click(button('Move ingredient 2 down'));
    expect(lines()).toEqual(['salt', 'water', 'flour']);
    expect(document.activeElement).toBe(button('Move ingredient 3 down'));

    // Already last: nothing moves.
    expect(button('Move ingredient 3 down').getAttribute('aria-disabled')).toBe('true');
    await user.click(button('Move ingredient 3 down'));
    expect(lines()).toEqual(['salt', 'water', 'flour']);

    await user.click(button('Move ingredient 3 up'));
    expect(lines()).toEqual(['salt', 'flour', 'water']);
    expect(document.activeElement).toBe(button('Move ingredient 2 up'));
    expect(button('Move ingredient 1 up').getAttribute('aria-disabled')).toBe('true');
  });

  it('removes lines, moving focus to the next, the one before, then the button to add one', async () => {
    const { user } = await newRecipe();
    await user.click(line(1));
    await user.paste('flour\nsalt\nwater');

    await user.click(button('Remove ingredient 2'));
    expect(lines()).toEqual(['flour', 'water']);
    expect(document.activeElement).toBe(line(2));

    await user.click(button('Remove ingredient 2'));
    expect(lines()).toEqual(['flour']);
    expect(document.activeElement).toBe(line(1));

    await user.click(button('Remove ingredient 1'));
    expect(screen.queryAllByRole('textbox', { name: /^Ingredient/ })).toEqual([]);
    expect(document.activeElement).toBe(button('Add an ingredient'));

    await user.click(button('Add an ingredient'));
    expect(document.activeElement).toBe(line(1));
  });

  it('saves the lines as read, leaving out blank ones', async () => {
    const { sent, opened } = answerCreate();
    const { user } = await newRecipe();

    await user.type(line(1), '2–3 cloves garlic, minced{Enter}{Enter}salt to taste');
    await user.click(button('Create recipe'));

    await opened();
    expect(sent).toEqual([
      [
        {
          label: null,
          ingredients: [
            {
              rawText: '2–3 cloves garlic, minced',
              qty: 2,
              qtyMax: 3,
              unit: 'clove',
              name: 'garlic',
              note: 'minced',
              scalable: true,
            },
            {
              rawText: 'salt to taste',
              qty: null,
              qtyMax: null,
              unit: null,
              name: 'salt',
              note: 'to taste',
              scalable: false,
            },
          ],
        },
      ],
    ]);
  });

  it('says what’s wrong with a line, on the line', async () => {
    const { user } = await newRecipe();

    await user.type(line(1), 'flour{Enter}2 cups');
    await user.click(button('Create recipe'));

    await waitFor(() => {
      expect(document.activeElement).toBe(line(2));
    });
    expect(describedBy(line(2))).toEqual([
      "Name the ingredient: myli can't find a name in this line.",
      'Reads as: 2 cups no ingredient named.',
    ]);

    await user.type(line(2), ' milk');
    await waitFor(() => {
      expect(describedBy(line(2))).toEqual(['Reads as: 2 cups milk.']);
    });
  });

  describe('groups', () => {
    it('names and saves each group, once there are several', async () => {
      const { sent, opened } = answerCreate();
      const { user } = await newRecipe();
      await user.type(line(1), '2 cups flour');
      expect(screen.queryByRole('textbox', { name: /^Group/ })).toBeNull();

      await user.click(button('Add a group, like “For the filling”'));

      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Group 2 name' }));
      await user.type(screen.getByRole('textbox', { name: 'Group 1 name' }), 'For the dough');
      await user.type(screen.getByRole('textbox', { name: 'Group 2 name' }), 'For the filling');
      await user.type(line(1, 2), '1 cup jam');
      await user.click(button('Add an ingredient to group 2'));
      expect(document.activeElement).toBe(line(2, 2));
      await user.type(line(2, 2), '2 tbsp butter');
      expect(within(groupList(1)).getAllByRole('textbox').length).toBe(1);

      await user.click(button('Create recipe'));

      await opened();
      expect(sent).toMatchObject([
        [
          { label: 'For the dough', ingredients: [{ name: 'flour' }] },
          { label: 'For the filling', ingredients: [{ name: 'jam' }, { name: 'butter' }] },
        ],
      ]);
    });

    it('removes a group, and its name with it once it’s the only one', async () => {
      const { user } = await newRecipe();
      await user.click(button('Add a group, like “For the filling”'));
      await user.type(line(1, 2), 'jam');

      await user.click(button('Remove group 1'));

      expect(lines()).toEqual(['jam']);
      expect(screen.queryByRole('textbox', { name: /^Group/ })).toBeNull();
      expect(document.activeElement).toBe(button('Add a group, like “For the filling”'));
    });

    it('needs a line in a group with a name', async () => {
      const { user } = await newRecipe();
      await user.type(line(1), 'flour');
      await user.click(button('Add a group, like “For the filling”'));
      await user.type(screen.getByRole('textbox', { name: 'Group 2 name' }), 'For the filling');

      await user.click(button('Create recipe'));

      // Under the group, and said straight away, since there's no field of its own to focus.
      const error = await screen.findByText('Add an ingredient to the group, or remove the group.');
      const group = error.closest<HTMLElement>('[data-ingredient-group]');
      expect(
        group && within(group).queryByRole('textbox', { name: 'Group 2 name' }),
      ).not.toBeNull();
      expect(error.closest('[role="alert"]')).not.toBeNull();
    });
  });

  describe('correcting how a line is read', () => {
    const corrections = (position: number) =>
      within(screen.getByRole('group', { name: `How ingredient ${String(position)} is read` }));
    const part = (name: string, position = 1) =>
      corrections(position).getByRole('textbox', { name });
    const scales = (position = 1) =>
      corrections(position).getByRole('checkbox', { name: 'Changes with servings' });

    it('starts from what myli read, with focus on the amount', async () => {
      const { user } = await newRecipe();
      await user.type(line(1), '1½–2 cups flour, sifted{Enter}salt to taste');
      expect(screen.queryByRole('group', { name: /^How ingredient/ })).toBeNull();

      await user.click(button('Correct how ingredient 1 is read'));
      await user.click(button('Correct how ingredient 2 is read'));

      expect(part('Amount')).toHaveProperty('value', '1½');
      expect(part('Up to')).toHaveProperty('value', '2');
      expect(part('Unit')).toHaveProperty('value', 'cup');
      expect(part('Ingredient')).toHaveProperty('value', 'flour');
      expect(part('Note')).toHaveProperty('value', 'sifted');
      expect(scales().getAttribute('aria-checked')).toBe('true');
      expect(part('Amount', 2)).toHaveProperty('value', '');
      expect(part('Note', 2)).toHaveProperty('value', 'to taste');
      expect(scales(2).getAttribute('aria-checked')).toBe('false');
      expect(document.activeElement).toBe(part('Amount', 2));
      expect(describedBy(part('Amount'))).toEqual(['Like 2 or 1½. Empty for none.']);
    });

    it('reads and saves the line as corrected, keeping what was typed', async () => {
      const { sent, opened } = answerCreate();
      const { user } = await newRecipe();
      await user.type(line(1), 'a few sprigs of thyme');
      expect(button('Correct how ingredient 1 is read')).toBeDefined();

      await user.click(button('Correct how ingredient 1 is read'));
      await user.type(part('Amount'), '3');
      await user.type(part('Unit'), 'sprig');
      await user.clear(part('Ingredient'));
      await user.type(part('Ingredient'), 'thyme');
      await user.click(scales());

      expect(describedBy(line(1))).toEqual([
        "Reads as: 3 sprigs thyme. Doesn't change with servings. Corrected by hand.",
      ]);
      await user.click(button('Create recipe'));

      await opened();
      expect(sent).toEqual([
        [
          {
            label: null,
            ingredients: [
              {
                rawText: 'a few sprigs of thyme',
                qty: 3,
                qtyMax: null,
                unit: 'sprig',
                name: 'thyme',
                note: null,
                scalable: false,
              },
            ],
          },
        ],
      ]);
    });

    it('says what’s wrong with a part, at that part', async () => {
      const { user } = await newRecipe();
      await user.type(line(1), '2 cups flour');
      await user.click(button('Correct how ingredient 1 is read'));
      await user.clear(part('Amount'));
      await user.type(part('Amount'), 'lots');
      await user.clear(part('Ingredient'));

      await user.click(button('Create recipe'));

      await waitFor(() => {
        expect(document.activeElement).toBe(part('Amount'));
      });
      expect(describedBy(part('Amount'))).toEqual([
        'Enter an amount, like 2, 1½ or 0.5.',
        'Like 2 or 1½. Empty for none.',
      ]);
      expect(describedBy(part('Ingredient'))).toEqual(['Name the ingredient.']);
    });

    it('drops the corrections when asked to read the line again, back on the line', async () => {
      const { user } = await newRecipe();
      await user.type(line(1), 'a few sprigs of thyme');
      await user.click(button('Correct how ingredient 1 is read'));
      await user.type(part('Amount'), '3');

      await user.click(button('Read ingredient 1 again'));

      expect(screen.queryByRole('group', { name: /^How ingredient/ })).toBeNull();
      expect(describedBy(line(1))).toEqual(['Reads as: a few sprigs of thyme.']);
      expect(document.activeElement).toBe(line(1));
    });

    it('offers nothing to correct on a blank line', async () => {
      await newRecipe();

      expect(screen.queryByRole('button', { name: /^Correct how/ })).toBeNull();
    });
  });

  describe('editing a recipe', () => {
    const thyme = {
      rawText: 'a few sprigs of thyme',
      qty: 3,
      qtyMax: null,
      unit: 'sprig',
      name: 'thyme',
      normalizedName: 'thyme',
      note: null,
      scalable: true,
    };

    async function editRecipe(recipe: Recipe) {
      answerPreferences();
      const saved: unknown[] = [];
      apiServer.use(
        http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe })),
        http.put('/api/v1/recipes/:id', async ({ request }) => {
          const body = (await request.json()) as Pick<Recipe, 'ingredientGroups'>;
          saved.push(body.ingredientGroups);
          return HttpResponse.json({ recipe });
        }),
      );
      const app = await renderApp(`/recipes/${recipe.id}/edit`);
      await screen.findByRole('textbox', { name: 'Title' });
      return { ...app, saved };
    }

    it('shows its groups and lines, saying which were corrected by hand', async () => {
      const recipe = sampleRecipe();
      const first = recipe.ingredientGroups[0];
      if (!first) throw new Error('no group');
      await editRecipe(
        sampleRecipe({
          ingredientGroups: [
            { label: 'For the dough', ingredients: first.ingredients },
            { label: 'To serve', ingredients: [thyme] },
          ],
        }),
      );

      expect(screen.getByRole('textbox', { name: 'Group 1 name' })).toHaveProperty(
        'value',
        'For the dough',
      );
      expect(describedBy(line(1, 1))).toEqual(['Reads as: 3 cups all-purpose flour.']);
      expect(describedBy(line(1, 2))).toEqual(['Reads as: 3 sprigs thyme. Corrected by hand.']);
      expect(screen.getAllByRole('button', { name: /^Read ingredient/ })).toHaveLength(1);
    });

    it('reads a corrected line again when asked, saving it as read', async () => {
      const { user, saved } = await editRecipe(
        sampleRecipe({ ingredientGroups: [{ label: null, ingredients: [thyme] }] }),
      );
      // Its corrections stay as it's changed.
      await user.type(line(1), ', fresh');
      expect(describedBy(line(1))).toEqual(['Reads as: 3 sprigs thyme. Corrected by hand.']);

      await user.click(button('Read ingredient 1 again'));

      expect(describedBy(line(1))).toEqual(['Reads as: a few sprigs of thyme, fresh.']);
      expect(screen.queryByRole('button', { name: /^Read ingredient/ })).toBeNull();
      await user.click(button('Publish'));
      await waitFor(() => {
        expect(saved).toEqual([
          [
            {
              label: null,
              ingredients: [
                {
                  rawText: 'a few sprigs of thyme, fresh',
                  qty: null,
                  qtyMax: null,
                  unit: null,
                  name: 'a few sprigs of thyme',
                  note: 'fresh',
                  scalable: true,
                },
              ],
            },
          ],
        ]);
      });
      await screen.findByRole('radio', { name: 'US customary' });
    });
  });
});
