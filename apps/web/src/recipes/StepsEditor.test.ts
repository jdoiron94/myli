import { RECIPE_LIMITS, VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import {
  apiServer,
  describedBy,
  focusedMarkdownEditor,
  problemResponse,
  renderApp,
} from '@/testing.ts';
import type { Recipe, UpdateRecipeRequest } from './recipe.ts';
import { answerTags, answerUploads, photoFile, sampleImage, sampleRecipe } from './testing.ts';

const step = (position: number) =>
  screen.getByRole('textbox', { name: `Step ${String(position)}` });
/** Each step's text, as shown. */
const stepTexts = () =>
  screen.queryAllByRole('textbox', { name: /^Step \d+$/ }).map((box) => box.textContent.trim());
const button = (name: string) => screen.getByRole('button', { name });

/** The edit page for a recipe with steps of these bodies. Keeps the steps each save sends. */
async function editSteps(...bodies: string[]) {
  answerPreferences();
  let stored = sampleRecipe({ steps: bodies.map((body) => ({ body, image: null })) });
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
    expect(saved).toEqual([
      [
        { body: 'Bake. Then cool.', image: null },
        { body: 'Mix.', image: null },
      ],
    ]);
  });

  it('saves the steps in order, leaving out blank ones, as the recipe then shows them', async () => {
    const { user, saved } = await editSteps('Mix.', 'Bake **hot**.');

    await user.click(button('Move step 2 up'));
    await user.click(button('Add a step'));
    await focusedMarkdownEditor('Step 3');
    await user.click(button('Save changes'));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([
      [
        { body: 'Bake **hot**.', image: null },
        { body: 'Mix.', image: null },
      ],
    ]);
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
});

describe('a step’s photo', () => {
  /** Each step, as listed in the editor. */
  const stepItems = () => [
    ...screen.getByRole('list', { name: 'Steps' }).querySelectorAll<HTMLElement>(':scope > li'),
  ];
  const stepItem = (position: number) => {
    const item = stepItems()[position - 1];
    if (!item) throw new Error(`no step ${String(position)}`);
    return item;
  };
  /** Each step's photo, by ID, or `null`. */
  const stepPhotos = () =>
    stepItems().map(
      (item) => item.querySelector('img')?.getAttribute('src')?.split('/')[4] ?? null,
    );
  const fileInputOf = (position: number) => {
    const input = stepItem(position).querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error(`no file input for step ${String(position)}`);
    return input;
  };

  /** The edit page for `recipe`. Keeps the steps each save sends. */
  async function editStepPhotos(recipe: Recipe, answerSave?: () => Response) {
    answerPreferences();
    let stored = recipe;
    const saved: UpdateRecipeRequest['steps'][] = [];
    apiServer.use(
      http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe: stored })),
      http.put('/api/v1/recipes/:id', async ({ request }) => {
        const { steps } = (await request.json()) as UpdateRecipeRequest;
        saved.push(steps);
        if (answerSave) return answerSave();
        stored = {
          ...stored,
          steps: steps.map(({ body, image }) => ({
            body,
            image: image && sampleImage(image.id, image.alt),
          })),
        };
        return HttpResponse.json({ recipe: stored });
      }),
    );
    const app = await renderApp('/recipes/recipe-bread/edit');
    await screen.findByRole('textbox', { name: 'Title' });
    return { ...app, saved };
  }

  const twoSteps = (photo: string | null = null) =>
    sampleRecipe({
      steps: [
        { body: 'Mix.', image: null },
        { body: 'Shape.', image: photo === null ? null : sampleImage(photo) },
      ],
    });

  const altField = (position: number) =>
    screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: `Alt text for step ${String(position)}’s photo`,
    });

  it('is uploaded for the step, moves with it, and is saved with it and its alt text', async () => {
    const sent = answerUploads();
    const { user, saved } = await editStepPhotos(twoSteps());

    await user.upload(fileInputOf(2), photoFile('shaped.jpg'));

    await waitFor(() => {
      expect(stepPhotos()).toEqual([null, 'upload-1']);
    });
    expect(sent).toEqual([{ type: 'image/jpeg', size: 1000 }]);
    // One photo a step: removing it is how to change it.
    expect(screen.queryByRole('button', { name: 'Add a photo to step 2' })).toBeNull();
    // Its field says what it shows, so the photo isn't described twice.
    expect(stepItem(2).querySelector('img')?.alt).toBe('');
    await user.type(altField(2), 'Dough shaped into a round.');
    await user.click(button('Move step 2 up'));
    expect(stepPhotos()).toEqual(['upload-1', null]);
    expect(altField(1).value).toBe('Dough shaped into a round.');

    await user.click(button('Save changes'));
    await screen.findByRole('radio', { name: 'US customary' });
    expect(saved).toEqual([
      [
        { body: 'Shape.', image: { id: 'upload-1', alt: 'Dough shaped into a round.' } },
        { body: 'Mix.', image: null },
      ],
    ]);
    const shown = within(screen.getByRole('region', { name: 'Steps' })).getAllByRole('listitem');
    const photo = shown[0]?.querySelector('img');
    expect(photo?.getAttribute('src')).toBe('/api/v1/images/upload-1/1280');
    expect(photo?.alt).toBe('Dough shaped into a round.');
  });

  it('is removed when asked, focusing the button to add one in its place', async () => {
    const { user, saved } = await editStepPhotos(twoSteps('photo'));
    expect(stepPhotos()).toEqual([null, 'photo']);

    await user.click(button('Remove photo from step 2'));

    expect(stepPhotos()).toEqual([null, null]);
    expect(document.activeElement).toBe(button('Add a photo to step 2'));
    await user.click(button('Save changes'));
    await screen.findByRole('radio', { name: 'US customary' });
    expect(saved).toEqual([
      [
        { body: 'Mix.', image: null },
        { body: 'Shape.', image: null },
      ],
    ]);
  });

  it('says on its step why a file can’t be its photo, or why the API refused it', async () => {
    const sent = answerUploads(() => problemResponse(422, 'This image can’t be read.'));
    await editStepPhotos(twoSteps());
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(fileInputOf(1), photoFile('notes.txt', 'text/plain'));
    await user.upload(fileInputOf(2), photoFile('broken.jpg'));

    await waitFor(() => {
      expect(within(stepItem(2)).getByRole('alert').textContent.trim()).toBe(
        'This image can’t be read.',
      );
    });
    expect(within(stepItem(1)).getByRole('alert').textContent.trim()).toBe(
      'Upload a JPEG, PNG or WebP image.',
    );
    expect(sent).toHaveLength(1);
    expect(stepPhotos()).toEqual([null, null]);
  });

  it('shows the API’s refusal of a step’s photo on that step, until the steps change', async () => {
    const detail = 'This photo isn’t available any more. Upload it again.';
    const { user } = await editStepPhotos(twoSteps('photo'), () =>
      problemResponse(422, 'The request is invalid.', {
        type: VALIDATION_PROBLEM_TYPE,
        errors: [{ in: 'body', pointer: '#/steps/1/image/id', detail }],
      }),
    );

    await user.click(button('Save changes'));

    await waitFor(() => {
      expect(describedBy(button('Remove photo from step 2'))).toEqual([detail]);
    });
    expect(within(stepItem(2)).getByRole('alert').textContent.trim()).toBe(detail);

    await user.click(button('Move step 2 up'));
    expect(screen.queryByText(detail)).toBeNull();
  });
});
