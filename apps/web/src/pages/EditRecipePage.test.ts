import { AUTH_BASE_PATH, type User } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import type { Recipe } from '@/recipes/recipe.ts';
import { answerRecipe, sampleRecipe } from '@/recipes/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  focusedMarkdownEditor,
  problemResponse,
  renderApp,
  sessionResponse,
  testUsers,
} from '@/testing.ts';

const field = (name: string) => screen.getByRole('textbox', { name });
const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
const checked = (name: string) =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';

/**
 * Stands in for the API's copy of one recipe: GET answers what's stored, and PUT stores the content
 * it's sent, or answers `refuse()` instead when given. Keeps each PUT's body.
 */
function storeRecipe(recipe: Recipe, refuse?: () => Response) {
  answerPreferences();
  let stored = recipe;
  const saved: unknown[] = [];
  const reads: string[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', ({ params }) => {
      reads.push(String(params.id));
      return HttpResponse.json({ recipe: stored });
    }),
    http.put('/api/v1/recipes/:id', async ({ request }) => {
      const body = (await request.json()) as Partial<Recipe>;
      saved.push(body);
      if (refuse) return refuse();
      stored = { ...stored, ...body, updatedAt: '2026-11-17T09:00:00.000Z' };
      return HttpResponse.json({ recipe: stored });
    }),
  );
  return { saved, reads };
}

async function openEditor(path = '/recipes/recipe-bread/edit', role?: User['role']) {
  const app = await renderApp(path, role ? { signedInAs: role } : {});
  await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });
  await screen.findByRole('textbox', { name: 'Title' });
  return app;
}

describe('the edit recipe page', () => {
  it('fills the form in with the recipe as it is', async () => {
    storeRecipe(sampleRecipe());
    await openEditor();

    expect(document.title).toBe('Edit recipe · myli');
    expect(field('Title')).toHaveProperty('value', 'Weeknight Bread');
    // Shown as the recipe shows it, until it's edited.
    expect(within(field('Description')).getByText('simple').tagName).toBe('EM');
    expect(field('Servings')).toHaveProperty('value', '8');
    expect(field('Makes')).toHaveProperty('value', '1');
    expect(field('What it makes')).toHaveProperty('value', 'loaf');
    expect(field('Prep time (minutes)')).toHaveProperty('value', '20');
    expect(field('Cook time (minutes)')).toHaveProperty('value', '40');
    expect(field('Total time (minutes)')).toHaveProperty('value', '180');
    expect(checked('Easy')).toBe(true);
    expect(field('Web address')).toHaveProperty('value', 'https://example.com/bread');
    expect(field('Book or site')).toHaveProperty('value', 'Example Bakes');
    expect(field('Author')).toHaveProperty('value', 'A. Baker');
    expect(field('Equipment')).toHaveProperty('value', 'Loaf pan\nStand mixer');
    expect(field('Calories')).toHaveProperty('value', '210');
    expect(field('Fat (grams)')).toHaveProperty('value', '2.5');
    expect(field('Fiber (grams)')).toHaveProperty('value', '');
    // Its visibility is changed on its own, by its owner.
    expect(screen.queryByRole('radio', { name: 'Private' })).toBeNull();
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('saves the changes over the whole recipe, keeping what the form has no fields for', async () => {
    const recipe = sampleRecipe({
      tags: [{ id: 3, type: 'cuisine', name: 'Italian' }],
    });
    const { saved, reads } = storeRecipe(recipe);
    const { router, user } = await openEditor();

    await user.clear(field('Title'));
    await user.type(field('Title'), 'Sunday Bread');
    await user.clear(field('Total time (minutes)'));
    await user.click(screen.getByRole('radio', { name: 'Not set' }));
    await user.clear(field('Makes'));
    await user.clear(field('What it makes'));
    await user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: 'Sunday Bread' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
    expect(saved).toEqual([
      {
        title: 'Sunday Bread',
        description: recipe.description,
        source: recipe.source,
        equipment: recipe.equipment,
        yield: null,
        servings: 8,
        prepMinutes: 20,
        cookMinutes: 40,
        totalMinutes: null,
        difficulty: null,
        nutrition: recipe.nutrition,
        ingredientGroups: [
          {
            label: null,
            ingredients: [
              {
                rawText: '3 cups all-purpose flour',
                qty: 3,
                qtyMax: null,
                unit: 'cup',
                name: 'all-purpose flour',
                note: null,
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
        steps: recipe.steps,
        tagIds: [3],
      },
    ]);
    // The recipe's page loads it again, as it does each time it opens.
    await screen.findByRole('radio', { name: 'US customary' });
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
  });

  it('saves the description as edited, keeping how it was written', async () => {
    const { saved } = storeRecipe(sampleRecipe());
    const { user } = await openEditor();

    await user.click(field('Description'));
    await focusedMarkdownEditor('Description');
    await user.keyboard(' Best the next day.');
    await user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toMatchObject([{ description: 'A *simple* loaf. Best the next day.' }]);
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('shows the recipe as saved straight away, while its page loads it again', async () => {
    const { reads } = storeRecipe(sampleRecipe());
    const { user } = await openEditor();
    const reloaded = Promise.withResolvers<undefined>();
    apiServer.use(
      http.get('/api/v1/recipes/:id', async () => {
        reads.push('held');
        await reloaded.promise;
        return HttpResponse.json({ recipe: sampleRecipe({ title: 'Sunday Bread' }) });
      }),
    );

    await user.clear(field('Title'));
    await user.type(field('Title'), 'Sunday Bread');
    await user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: 'Sunday Bread' });
    expect(screen.queryByText('Loading the recipe…')).toBeNull();
    await waitFor(() => {
      expect(reads).toContain('held');
    });
    reloaded.resolve(undefined);
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('goes back to the recipe on cancel, saving nothing', async () => {
    const { saved } = storeRecipe(sampleRecipe());
    const { router, user } = await openEditor();

    await user.type(field('Title'), ' (draft)');
    await user.click(screen.getByRole('link', { name: 'Cancel' }));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    await screen.findByRole('radio', { name: 'US customary' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
    expect(saved).toEqual([]);
  });

  it("lets editors edit someone else's shared recipe", async () => {
    storeRecipe(sampleRecipe({ owner: { id: testUsers.admin.id, name: testUsers.admin.name } }));
    await openEditor();

    expect(saveButton()).toBeDefined();
  });

  it("tells viewers they can't edit it, and links back", async () => {
    answerRecipe(sampleRecipe());
    const { user } = await renderApp('/recipes/recipe-bread/edit', { signedInAs: 'viewer' });

    await screen.findByRole('heading', { level: 1, name: "You can't edit this recipe" });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Back to the recipe' }));
    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it("says a recipe they can't see isn't found", async () => {
    answerRecipe(sampleRecipe());
    await renderApp('/recipes/someone-elses/edit');

    await screen.findByRole('heading', { level: 1, name: 'Recipe not found' });
    expect(
      screen.getByText("This recipe doesn't exist, was deleted, or isn't shared with you."),
    ).toBeDefined();
  });

  it('takes the form away when saving finds their role was', async () => {
    let user: User = testUsers.editor;
    apiServer.use(http.get(`${AUTH_BASE_PATH}/get-session`, () => sessionResponse(user)));
    storeRecipe(sampleRecipe(), () =>
      problemResponse(403, "You don't have permission to do this."),
    );
    const app = await openEditor();
    // An admin made them a viewer after the page opened.
    user = { ...testUsers.editor, role: 'viewer' };

    await app.user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: "You can't edit this recipe" });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  });
});
