import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { screen, waitFor } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/recipes/recipe.ts';
import { answerRecipe, sampleRecipe } from '@/recipes/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  describedBy,
  focusedMarkdownEditor,
  problemResponse,
  renderApp,
} from '@/testing.ts';

const field = (name: string) => screen.getByRole('textbox', { name });
const createButton = () => screen.getByRole('button', { name: 'Create recipe' });

const created: Recipe = sampleRecipe({ id: 'recipe-new' });

/**
 * Answers POST /recipes with `answer`, by default the created recipe, and keeps each request's body.
 * The recipe's page, which opens next, gets it too.
 */
function answerCreate(
  answer: () => Response | Promise<Response> = () =>
    HttpResponse.json({ recipe: created }, { status: 201 }),
) {
  const recipeRequests = answerRecipe(created);
  const bodies: unknown[] = [];
  apiServer.use(
    http.post('/api/v1/recipes', async ({ request }) => {
      bodies.push(await request.json());
      return answer();
    }),
  );
  /** Once the recipe's page has opened and loaded everything, which the test waits for. */
  const opened = async () => {
    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    await screen.findByRole('radio', { name: 'US customary' });
    await waitFor(() => {
      expect(recipeRequests).toContain(created.id);
    });
  };
  return { bodies, opened };
}

async function openForm() {
  const app = await renderApp('/recipes/new');
  await screen.findByRole('heading', { level: 1, name: 'New recipe' });
  return app;
}

describe('the new recipe page', () => {
  it('creates a recipe from what was filled in, then opens it', async () => {
    const { bodies, opened } = answerCreate();
    const { router, user } = await openForm();
    expect(document.title).toBe('New recipe · myli');

    await user.type(field('Title'), 'Weeknight Bread');
    await user.click(field('Description'));
    await focusedMarkdownEditor('Description');
    await user.keyboard('A **crusty** loaf.');
    await user.type(field('Servings'), '8');
    await user.type(field('Makes'), '1');
    await user.type(field('What it makes'), 'loaf');
    await user.type(field('Prep time (minutes)'), '20');
    await user.type(field('Cook time (minutes)'), '40');
    await user.click(screen.getByRole('radio', { name: 'Easy' }));
    await user.type(field('Web address'), 'https://example.com/bread');
    await user.type(field('Book or site'), 'Example Bakes');
    await user.type(field('Author'), 'A. Baker');
    await user.type(field('Equipment'), 'Loaf pan{Enter}Stand mixer');
    await user.type(field('Calories'), '210');
    await user.type(field('Fat (grams)'), '2.5');
    await user.click(screen.getByRole('radio', { name: 'Shared' }));
    await user.click(createButton());

    await opened();
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-new');
    expect(bodies).toEqual([
      {
        title: 'Weeknight Bread',
        description: 'A **crusty** loaf.',
        source: { url: 'https://example.com/bread', title: 'Example Bakes', author: 'A. Baker' },
        equipment: ['Loaf pan', 'Stand mixer'],
        yield: { qty: 1, unit: 'loaf' },
        servings: 8,
        prepMinutes: 20,
        cookMinutes: 40,
        totalMinutes: null,
        difficulty: 'easy',
        nutrition: {
          calories: 210,
          proteinGrams: null,
          carbsGrams: null,
          fatGrams: 2.5,
          fiberGrams: null,
          sugarGrams: null,
          sodiumMilligrams: null,
        },
        ingredientGroups: [],
        steps: [],
        tagIds: [],
        visibility: 'shared',
      },
    ]);
  });

  it('starts private, with no difficulty, and explains each choice of who can see it', async () => {
    await openForm();

    expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(describedBy(screen.getByRole('radio', { name: 'Private' }))).toEqual([
      'Only you can see it.',
    ]);
    expect(describedBy(screen.getByRole('radio', { name: 'Shared' }))).toEqual([
      'Everyone on myli can see it, and editors can change it.',
    ]);
    expect(screen.getByRole('radio', { name: 'Not set' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    // Phones show a keyboard for what each takes.
    expect(field('Servings').getAttribute('inputmode')).toBe('numeric');
    expect(field('Makes').getAttribute('inputmode')).toBe('decimal');
    expect(field('Calories').getAttribute('inputmode')).toBe('decimal');
    expect(field('Web address').getAttribute('inputmode')).toBe('url');
    expect(field('Title').getAttribute('inputmode')).toBeNull();
    expect(describedBy(field('Total time (minutes)'))).toEqual([
      "Only when it isn't prep plus cook, like dough that rises overnight.",
    ]);
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('says what needs fixing, at the first field that does, and sends nothing', async () => {
    const { user } = await openForm();

    await user.type(field('Prep time (minutes)'), 'twenty');
    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(field('Title'));
    });
    expect(describedBy(field('Title'))).toEqual(['Give the recipe a title.']);
    expect(describedBy(field('Servings'))).toEqual([
      'Enter a whole number of servings.',
      'How many it serves. Scaling starts from this.',
    ]);
    expect(describedBy(field('Prep time (minutes)'))).toEqual(['Enter a whole number of minutes.']);
    expect(await accessibilityViolations()).toEqual([]);

    // Checked as they type from then on, until it's right.
    await user.type(field('Title'), 'Bread');
    await waitFor(() => {
      expect(describedBy(field('Title'))).toEqual([]);
    });
  });

  it("shows the API's field errors next to their fields", async () => {
    answerCreate(() =>
      problemResponse(422, 'The request is invalid.', {
        type: VALIDATION_PROBLEM_TYPE,
        errors: [{ in: 'body', pointer: '#/nutrition/calories', detail: 'That is a lot.' }],
      }),
    );
    const { user } = await openForm();

    await user.type(field('Title'), 'Weeknight Bread');
    await user.type(field('Servings'), '8');
    await user.type(field('Calories'), '99999');
    await user.click(createButton());

    await waitFor(() => {
      expect(document.activeElement).toBe(field('Calories'));
    });
    expect(describedBy(field('Calories'))).toEqual(['That is a lot.']);
  });

  it('says so when it fails otherwise, keeping what was typed', async () => {
    answerCreate(() => problemResponse(500, 'Internal Server Error'));
    const { user } = await openForm();

    await user.type(field('Title'), 'Weeknight Bread');
    await user.type(field('Servings'), '8');
    await user.click(createButton());

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(field('Title')).toHaveProperty('value', 'Weeknight Bread');
  });

  it('creates it once, however often the button is pressed while it does', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { bodies, opened } = answerCreate(async () => {
      await answered.promise;
      return HttpResponse.json({ recipe: created }, { status: 201 });
    });
    const { user } = await openForm();
    await user.type(field('Title'), 'Weeknight Bread');
    await user.type(field('Servings'), '8');

    await user.click(createButton());
    await waitFor(() => {
      expect(createButton().getAttribute('aria-disabled')).toBe('true');
    });
    await user.click(createButton());
    // Time for a second request to arrive, if one was sent, before the first is answered.
    await new Promise((resolve) => setTimeout(resolve, 100));
    answered.resolve(undefined);

    await opened();
    expect(bodies).toHaveLength(1);
  });

  it('goes back home on cancel', async () => {
    const { router, user } = await openForm();

    await user.click(screen.getByRole('link', { name: 'Cancel' }));

    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('home');
    });
  });

  it("isn't for viewers, who can't create recipes", async () => {
    const { router } = await renderApp('/recipes/new', { signedInAs: 'viewer' });

    await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/new');
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  });
});
