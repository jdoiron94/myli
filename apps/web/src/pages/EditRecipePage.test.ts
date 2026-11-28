import { AUTH_BASE_PATH, type User, versionETag } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import type { Recipe, RecipeContent, RecipeDraft, UpdateRecipeRequest } from '@/recipes/recipe.ts';
import { recipeContent } from '@/recipes/recipe-form.ts';
import {
  answerRecipe,
  answerTags,
  sampleDraft,
  sampleImage,
  sampleRecipe,
  staleRecipeResponse,
} from '@/recipes/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  focusedMarkdownEditor,
  listItems,
  problemResponse,
  renderApp,
  sessionResponse,
  testUsers,
} from '@/testing.ts';

const field = (name: string) => screen.getByRole('textbox', { name });
const saveButton = () => screen.getByRole('button', { name: 'Publish' });
const button = (name: string) => screen.getByRole('button', { name });
const checked = (name: string) =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true';

/**
 * Stands in for the API's copy of one recipe and its draft: GET answers what's stored, and PUT
 * publishes the content it's sent, or answers `refuse()` instead when given. Saving the draft or
 * discarding it moves the version on, and publishing discards it. As the API does, a change based
 * on another version than the stored one gets 412. Keeps each PUT's body. `saveElsewhere()`
 * publishes changes as someone else would, and `saveDraftElsewhere()` saves them as their draft.
 */
function storeRecipe(
  recipe: Recipe,
  { refuse, draft = null }: { refuse?: () => Response; draft?: RecipeDraft | null } = {},
) {
  answerPreferences();
  let stored = recipe;
  let storedDraft = draft;
  const saved: unknown[] = [];
  const reads: string[] = [];
  const current = (request: Request) =>
    request.headers.get('if-match') === versionETag(stored.version);
  apiServer.use(
    http.get('/api/v1/recipes/:id/draft', () => HttpResponse.json({ draft: storedDraft })),
    http.put('/api/v1/recipes/:id/draft', async ({ request }) => {
      const content = (await request.json()) as RecipeContent;
      if (!current(request)) return staleRecipeResponse(stored);
      stored = { ...stored, version: stored.version + 1 };
      storedDraft = {
        content,
        photos: [],
        author: { id: testUsers.editor.id, name: testUsers.editor.name, avatar: null },
        updatedAt: '2026-11-17T09:00:00.000Z',
        revision: storedDraft?.revision ?? stored.revision,
        version: stored.version,
      };
      return HttpResponse.json({ draft: storedDraft });
    }),
    http.delete('/api/v1/recipes/:id/draft', ({ request }) => {
      if (!current(request)) return staleRecipeResponse(stored);
      if (storedDraft) stored = { ...stored, version: stored.version + 1 };
      storedDraft = null;
      return new HttpResponse(null, {
        status: 204,
        headers: { etag: versionETag(stored.version) },
      });
    }),
    http.get('/api/v1/recipes/:id', ({ params }) => {
      reads.push(String(params.id));
      return HttpResponse.json({ recipe: stored });
    }),
    http.put('/api/v1/recipes/:id', async ({ request }) => {
      const json: unknown = await request.json();
      const body = json as UpdateRecipeRequest;
      saved.push(body);
      if (refuse) return refuse();
      if (!current(request)) return staleRecipeResponse(stored);
      storedDraft = null;
      // As the API answers: each photo whole, with the alt text it was sent.
      const photo = ({ id, alt }: { id: string; alt: string }) => sampleImage(id, alt);
      stored = {
        ...stored,
        ...(json as Partial<Recipe>),
        images: body.images.map(photo),
        steps: body.steps.map((step) => ({
          body: step.body,
          image: step.image && photo(step.image),
        })),
        revision: stored.revision + 1,
        version: stored.version + 1,
        updatedAt: '2026-11-17T09:00:00.000Z',
      };
      return HttpResponse.json({ recipe: stored });
    }),
  );
  const saveElsewhere = (changes: Partial<Recipe>) => {
    stored = { ...stored, ...changes, version: stored.version + 1 };
  };
  const saveDraftElsewhere = (changes: Partial<RecipeContent>) => {
    stored = { ...stored, version: stored.version + 1 };
    storedDraft = sampleDraft({
      content: { ...recipeContent(stored), ...changes },
      revision: stored.revision,
      version: stored.version,
    });
  };
  return { saved, reads, saveElsewhere, saveDraftElsewhere };
}

async function openEditor(path = '/recipes/recipe-bread/edit', role?: User['role']) {
  const app = await renderApp(path, role ? { signedInAs: role } : {});
  await screen.findByRole('heading', { level: 1, name: 'Edit recipe' });
  await screen.findByRole('textbox', { name: 'Title' });
  return app;
}

// The editor loads every tag.
beforeEach(() => {
  answerTags();
});

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
      images: [sampleImage('photo-a', 'A loaf on a board.'), sampleImage('photo-b')],
      coverImageId: 'photo-b',
      steps: [
        { body: 'Mix everything.', image: sampleImage('photo-c') },
        { body: 'Bake at **400°F**.', image: null },
      ],
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
        steps: [
          { body: 'Mix everything.', image: { id: 'photo-c', alt: '' } },
          { body: 'Bake at **400°F**.', image: null },
        ],
        tagIds: [3],
        images: [
          { id: 'photo-a', alt: 'A loaf on a board.' },
          { id: 'photo-b', alt: '' },
        ],
        coverImageId: 'photo-b',
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

  it('says what someone published since it opened, even once the page has it, and publishes anyway', async () => {
    const { saved, saveElsewhere } = storeRecipe(sampleRecipe());
    const { user, queryClient } = await openEditor();
    saveElsewhere({ title: 'Their Bread', servings: 6 });
    await queryClient.refetchQueries({ queryKey: ['recipes', 'recipe-bread'] });

    await user.type(field('Title'), ' (mine)');
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(listItems(alert)).toEqual(['They published changes to: Title, Servings.']);
    expect(field('Title')).toHaveProperty('value', 'Weeknight Bread (mine)');
    expect(saved).toHaveLength(1);
    expect(await accessibilityViolations()).toEqual([]);

    await user.click(within(alert).getByRole('button', { name: 'Publish anyway' }));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread (mine)' });
    expect(saved).toHaveLength(2);
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('says when someone saved a draft since it opened, and loads theirs instead when asked', async () => {
    const { saveDraftElsewhere } = storeRecipe(sampleRecipe());
    const { user } = await openEditor();
    saveDraftElsewhere({ title: 'Their Draft' });

    await user.type(field('Title'), ' (mine)');
    await user.click(button('Save draft'));

    const alert = await screen.findByRole('alert');
    expect(listItems(alert)).toEqual([
      expect.stringMatching(/^Grace Hopper saved a draft on .+\.$/),
    ]);
    await user.click(
      within(alert).getByRole('button', { name: 'Drop my changes and load theirs' }),
    );

    await waitFor(() => {
      expect(field('Title')).toHaveProperty('value', 'Their Draft');
    });
    expect(screen.getByText(/^You're continuing the draft Grace Hopper saved on /)).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    await screen.findByRole('checkbox', { name: 'Italian' });
  });

  it('saves a draft, then publishes it with what changed, each based on the version before', async () => {
    const { saved } = storeRecipe(sampleRecipe());
    const { user, router } = await openEditor();

    await user.clear(field('Title'));
    await user.type(field('Title'), 'Sunday Bread');
    await user.click(button('Save draft'));

    await screen.findByText('Draft saved. Publish it when it’s ready, or come back to it later.');
    expect(screen.getByText(/^You're continuing the draft you saved on /)).toBeDefined();
    expect(router.currentRoute.value.name).toBe('edit-recipe');
    expect(saved).toEqual([]);

    // Saving the draft moved the version on: publishing is based on that one, not the one opened.
    await user.type(field('What changed'), 'A better name');
    await user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: 'Sunday Bread' });
    expect(saved).toMatchObject([{ title: 'Sunday Bread', message: 'A better name' }]);
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('continues the draft someone saved, saying when the recipe was published since', async () => {
    const photo = sampleImage('photo-new', 'Sliced, on a board.');
    storeRecipe(sampleRecipe({ revision: 3, version: 6 }), {
      draft: sampleDraft({
        content: {
          ...sampleDraft().content,
          title: 'Work in Progress',
          images: [{ id: photo.id, alt: photo.alt }],
          coverImageId: photo.id,
        },
        photos: [photo],
        revision: 2,
        version: 6,
      }),
    });
    await openEditor();

    expect(field('Title')).toHaveProperty('value', 'Work in Progress');
    expect(field('Alt text for photo 1')).toHaveProperty('value', 'Sliced, on a board.');
    expect(document.querySelector('img[src*="/images/photo-new/"]')).not.toBeNull();
    expect(screen.getByText(/^You're continuing the draft Grace Hopper saved on /)).toBeDefined();
    expect(
      screen.getByText(
        'It started from revision 2, and the recipe was published again since, as revision 3. ' +
          'Publishing the draft replaces what that revision changed.',
      ),
    ).toBeDefined();
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('discards the draft, going back to the recipe as it was published', async () => {
    // At the version saving the draft moved it on to.
    storeRecipe(sampleRecipe({ version: 2 }), {
      draft: sampleDraft({ content: { ...sampleDraft().content, title: 'Work in Progress' } }),
    });
    const { user, router } = await openEditor();

    await user.click(button('Discard draft'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' });
    expect(await accessibilityViolations()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread');
    expect(
      screen.getByText('Draft discarded. The recipe is as it was published.').getAttribute('role'),
    ).toBe('status');
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
    storeRecipe(
      sampleRecipe({ owner: { id: testUsers.admin.id, name: testUsers.admin.name, avatar: null } }),
    );
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
    storeRecipe(sampleRecipe(), {
      refuse: () => problemResponse(403, "You don't have permission to do this."),
    });
    const app = await openEditor();
    // An admin made them a viewer after the page opened.
    user = { ...testUsers.editor, role: 'viewer' };

    await app.user.click(saveButton());

    await screen.findByRole('heading', { level: 1, name: "You can't edit this recipe" });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  });
});
