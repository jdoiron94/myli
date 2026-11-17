import { RECIPE_LIMITS } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { accessibilityViolations, apiServer, focusedMarkdownEditor, renderApp } from '@/testing.ts';
import type { Recipe } from './recipe.ts';
import { answerTags, sampleRecipe } from './testing.ts';

const step = (position: number) =>
  screen.getByRole('textbox', { name: `Step ${String(position)}` });
/** Each step's text, as shown. */
const stepTexts = () =>
  screen.queryAllByRole('textbox', { name: /^Step \d+$/ }).map((box) => box.textContent.trim());
const button = (name: string) => screen.getByRole('button', { name });

/** The edit page for a recipe with steps of these bodies. Keeps the steps each save sends. */
async function editSteps(...bodies: string[]) {
  answerPreferences();
  let stored = sampleRecipe({ steps: bodies.map((body) => ({ body })) });
  const saved: unknown[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe: stored })),
    http.put('/api/v1/recipes/:id', async ({ request }) => {
      const { steps } = (await request.json()) as Pick<Recipe, 'steps'>;
      saved.push(steps);
      stored = { ...stored, steps };
      return HttpResponse.json({ recipe: stored });
    }),
  );
  const app = await renderApp('/recipes/recipe-bread/edit');
  await screen.findByRole('textbox', { name: 'Title' });
  return { ...app, saved };
}

// The editor loads every tag.
beforeEach(() => {
  answerTags();
});

describe('the steps editor', () => {
  it('starts a new recipe with a step to write, and adds the next at the end', async () => {
    const { user } = await renderApp('/recipes/new');
    await screen.findByRole('heading', { level: 1, name: 'New recipe' });
    expect(stepTexts()).toEqual(['']);

    await user.click(step(1));
    await focusedMarkdownEditor('Step 1');
    await user.keyboard('Mix.');
    await user.click(button('Add a step'));
    await focusedMarkdownEditor('Step 2');
    await user.keyboard('Bake.');

    expect(stepTexts()).toEqual(['Mix.', 'Bake.']);
  });

  it('adds a step after any step, with focus in it', async () => {
    const { user } = await editSteps('Mix.', 'Bake.');

    await user.click(button('Add a step after step 1'));
    await focusedMarkdownEditor('Step 2');
    await user.keyboard('Rest.');

    expect(stepTexts()).toEqual(['Mix.', 'Rest.', 'Bake.']);
  });

  it('moves steps up and down, keeping focus on the button pressed', async () => {
    const { user } = await editSteps('Mix.', 'Rest.', 'Bake.');
    expect(button('Move step 1 up').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move step 3 down').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move step 2 up').hasAttribute('aria-disabled')).toBe(false);
    expect(button('Move step 2 down').hasAttribute('aria-disabled')).toBe(false);

    await user.click(button('Move step 1 down'));
    expect(stepTexts()).toEqual(['Rest.', 'Mix.', 'Bake.']);
    expect(document.activeElement).toBe(button('Move step 2 down'));

    await user.keyboard('{Enter}');
    expect(stepTexts()).toEqual(['Rest.', 'Bake.', 'Mix.']);
    expect(document.activeElement).toBe(button('Move step 3 down'));

    await user.click(button('Move step 3 up'));
    expect(stepTexts()).toEqual(['Rest.', 'Mix.', 'Bake.']);
    expect(document.activeElement).toBe(button('Move step 2 up'));

    // Nothing moves past either end.
    await user.click(button('Move step 1 up'));
    await user.click(button('Move step 3 down'));
    expect(stepTexts()).toEqual(['Rest.', 'Mix.', 'Bake.']);
  });

  it('removes steps, moving focus to the next, the one before, then the button to add one', async () => {
    const { user } = await editSteps('Mix.', 'Rest.', 'Bake.');

    await user.click(button('Remove step 2'));
    expect(stepTexts()).toEqual(['Mix.', 'Bake.']);
    expect((await focusedMarkdownEditor('Step 2')).textContent).toBe('Bake.');

    await user.click(button('Remove step 2'));
    expect(stepTexts()).toEqual(['Mix.']);
    expect((await focusedMarkdownEditor('Step 1')).textContent).toBe('Mix.');

    await user.click(button('Remove step 1'));
    expect(stepTexts()).toEqual([]);
    expect(document.activeElement).toBe(button('Add a step'));
  });

  it('keeps what’s written in a step that moves while it’s open', async () => {
    const { user, saved } = await editSteps('Mix.', 'Bake.');
    await user.click(step(2));
    await focusedMarkdownEditor('Step 2');
    await user.keyboard(' Then cool.');

    await user.click(button('Move step 2 up'));

    expect(stepTexts()).toEqual(['Bake. Then cool.', 'Mix.']);
    expect(step(1).getAttribute('contenteditable')).toBe('true');
    await user.click(button('Save changes'));
    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([[{ body: 'Bake. Then cool.' }, { body: 'Mix.' }]]);
  });

  it('saves the steps in order, leaving out blank ones, as the recipe then shows them', async () => {
    const { user, saved } = await editSteps('Mix.', 'Bake **hot**.');

    await user.click(button('Move step 2 up'));
    await user.click(button('Add a step'));
    await focusedMarkdownEditor('Step 3');
    await user.click(button('Save changes'));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([[{ body: 'Bake **hot**.' }, { body: 'Mix.' }]]);
    const steps = screen.getByRole('region', { name: 'Steps' });
    await waitFor(() => {
      expect(
        within(steps)
          .getAllByRole('listitem')
          .map((item) => item.innerHTML),
      ).toEqual([
        expect.stringContaining('<p>Bake <strong>hot</strong>.</p>'),
        expect.stringContaining('<p>Mix.</p>'),
      ]);
    });
  });

  it(`stops adding steps at ${String(RECIPE_LIMITS.steps)}`, async () => {
    const many = Array.from({ length: RECIPE_LIMITS.steps }, (_, index) => `${String(index)}.`);
    const { user } = await editSteps(...many);
    expect(button('Add a step').getAttribute('aria-disabled')).toBe('true');
    expect(button('Add a step after step 1').getAttribute('aria-disabled')).toBe('true');

    await user.click(button('Add a step'));
    await user.click(button('Add a step after step 1'));
    expect(stepTexts()).toHaveLength(RECIPE_LIMITS.steps);

    await user.click(button(`Remove step ${String(RECIPE_LIMITS.steps)}`));
    expect(button('Add a step').hasAttribute('aria-disabled')).toBe(false);
    await focusedMarkdownEditor(`Step ${String(RECIPE_LIMITS.steps - 1)}`);
  });

  it('says when there are more steps than a recipe can have', async () => {
    // As a recipe saved before a lower limit would.
    const many = Array.from({ length: RECIPE_LIMITS.steps + 1 }, (_, index) => `${String(index)}.`);
    const { user, saved } = await editSteps(...many);

    await user.click(button('Save changes'));

    expect(await screen.findByText('A recipe can have up to 100 steps.')).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('has nothing for axe to find', async () => {
    await editSteps('Mix.', 'Bake.');

    expect(await accessibilityViolations()).toEqual([]);
  });
});
