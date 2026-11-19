import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import { apiServer, describedBy, problemResponse, renderApp } from '@/testing.ts';
import type { Tag } from './recipe.ts';
import { answerRecipe, sampleRecipe, sampleTags } from './testing.ts';

const tag = (id: number) => {
  const found = sampleTags().find((sample) => sample.id === id);
  if (!found) throw new Error(`no sample tag ${String(id)}`);
  return found;
};
const ITALIAN = tag(20);
const WHEAT = tag(7);

const group = (name: string) => screen.getByRole('group', { name });
const checkbox = (name: string) => screen.getByRole('checkbox', { name });
const checked = (name: string) => checkbox(name).getAttribute('aria-checked') === 'true';
const field = (name: string) => screen.getByRole('textbox', { name });
const button = (name: string) => screen.getByRole('button', { name });

/**
 * The edit page for a recipe with these tags. Stands in for the API's tags, which POST /tags adds
 * to unless `create` answers instead, and keeps what each POST /tags and each save sends. A save
 * naming a tag the API no longer has is refused, as the API refuses it; `deleteTag` takes one away
 * there, as an admin would, while the page still has it.
 */
async function editTags(
  recipeTags: Tag[],
  {
    create,
  }: { create?: (body: { type: Tag['type']; name: string }) => Response | Promise<Response> } = {},
) {
  answerPreferences();
  let stored = sampleRecipe({ tags: recipeTags });
  let tags = sampleTags();
  const saved: number[][] = [];
  const created: unknown[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe: stored })),
    http.put('/api/v1/recipes/:id', async ({ request }) => {
      const { tagIds } = (await request.json()) as { tagIds: number[] };
      const missing = tagIds.flatMap((id, index) => (tags.some((t) => t.id === id) ? [] : [index]));
      if (missing.length > 0)
        return problemResponse(422, 'The request has invalid fields.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors: missing.map((index) => ({
            in: 'body',
            pointer: `#/tagIds/${String(index)}`,
            detail: 'This tag no longer exists. Choose another.',
          })),
        });
      saved.push(tagIds);
      stored = { ...stored, tags: tags.filter(({ id }) => tagIds.includes(id)) };
      return HttpResponse.json({ recipe: stored });
    }),
    http.get('/api/v1/tags', () => HttpResponse.json({ tags })),
    http.post('/api/v1/tags', async ({ request }) => {
      const body = (await request.json()) as { type: Tag['type']; name: string };
      created.push(body);
      if (create) return await create(body);
      const tag = { id: 60 + created.length, ...body };
      tags = [...tags, tag];
      return HttpResponse.json({ tag }, { status: 201 });
    }),
  );
  const app = await renderApp('/recipes/recipe-bread/edit');
  await screen.findByRole('checkbox', { name: 'Italian' });
  const deleteTag = (id: number) => {
    tags = tags.filter((t) => t.id !== id);
  };
  return { ...app, saved, created, deleteTag };
}

describe('the tags editor', () => {
  it('shows each type’s tags to check, with the recipe’s own checked', async () => {
    await editTags([ITALIAN, WHEAT]);

    expect(within(group('Cuisine')).getAllByRole('checkbox')).toHaveLength(2);
    expect(checked('Italian')).toBe(true);
    expect(checked('Mexican')).toBe(false);
    expect(within(group('Contains')).getAllByRole('checkbox')).toHaveLength(9);
    expect(checked('wheat')).toBe(true);
    expect(checked('milk')).toBe(false);
    expect(within(group('Meal')).getByRole('checkbox', { name: 'Dinner' })).toBeDefined();
    expect(within(group('Diet')).getByRole('checkbox', { name: 'Vegetarian' })).toBeDefined();
    expect(within(group('Other tags')).getByRole('checkbox', { name: 'Weeknight' })).toBeDefined();
  });

  it('saves the tags checked', async () => {
    const { user, saved } = await editTags([ITALIAN, WHEAT]);

    await user.click(checkbox('Italian'));
    await user.click(checkbox('Dinner'));
    await user.click(screen.getByText('Vegetarian'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([[WHEAT.id, 30, 40]]);
  });

  it('shows a chosen tag the API no longer has at its checkbox, until the tags chosen change', async () => {
    const { user, saved, deleteTag } = await editTags([ITALIAN, WHEAT]);
    deleteTag(ITALIAN.id);

    await user.click(button('Save changes'));

    await waitFor(() => {
      expect(describedBy(checkbox('Italian'))).toEqual([
        'Italian: This tag no longer exists. Choose another.',
      ]);
    });
    expect(document.activeElement).toBe(checkbox('Italian'));

    await user.click(checkbox('Italian'));
    // Wheat has Italian's place in the list now, but not its refusal.
    expect([describedBy(checkbox('Italian')), describedBy(checkbox('wheat'))]).toEqual([[], []]);
    await user.click(button('Save changes'));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([[WHEAT.id]]);
  });

  it('takes off a chosen tag that’s gone once the tags are fetched again, saying so', async () => {
    const { user, saved, deleteTag, queryClient } = await editTags([ITALIAN, WHEAT]);
    deleteTag(ITALIAN.id);

    await queryClient.invalidateQueries({ queryKey: ['tags'] });

    await screen.findByText("Italian no longer exists, so it's no longer chosen.");
    expect(within(group('Cuisine')).queryByRole('checkbox', { name: 'Italian' })).toBeNull();
    await user.click(button('Save changes'));

    await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
    expect(saved).toEqual([[WHEAT.id]]);
  });

  it('adds a tag of each type but the allergens, checked, with focus on it', async () => {
    const { user, created, saved } = await editTags([]);
    expect(within(group('Contains')).queryByRole('textbox')).toBeNull();

    await user.type(field('New cuisine'), '  Thai  Street {Enter}');
    await waitFor(() => {
      expect(checked('Thai Street')).toBe(true);
    });
    expect(document.activeElement).toBe(checkbox('Thai Street'));
    expect((field('New cuisine') as HTMLInputElement).value).toBe('');
    expect(within(group('Cuisine')).getByRole('checkbox', { name: 'Thai Street' })).toBeDefined();

    await user.type(field('New tag'), 'Holiday');
    await user.click(button('Add tag'));
    await waitFor(() => {
      expect(checked('Holiday')).toBe(true);
    });

    expect(created).toEqual([
      { type: 'cuisine', name: 'Thai Street' },
      { type: 'custom', name: 'Holiday' },
    ]);
    // Enter added the tag, and didn't save the recipe.
    expect(saved).toEqual([]);
  });

  it('checks the tag the type already has, given its name again', async () => {
    const { user } = await editTags([], {
      create: () => HttpResponse.json({ tag: ITALIAN }, { status: 200 }),
    });

    await user.type(field('New cuisine'), 'italian{Enter}');

    await waitFor(() => {
      expect(checked('Italian')).toBe(true);
    });
    expect(document.activeElement).toBe(checkbox('Italian'));
    expect(within(group('Cuisine')).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('says what’s wrong with a new tag’s name, at its field', async () => {
    let answer = () => problemResponse(500, 'Something went wrong.');
    const { user, created } = await editTags([], { create: () => answer() });
    const input = field('New diet');
    expect(describedBy(input)).toEqual(['Like Vegetarian, or Gluten-free.']);

    await user.click(button('Add diet'));
    expect(describedBy(input)).toEqual(['Name the tag.', 'Like Vegetarian, or Gluten-free.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);

    await user.type(input, 'x'.repeat(51));
    await user.keyboard('{Enter}');
    expect(describedBy(input)[0]).toBe('Keep it to 50 characters.');
    expect(created).toEqual([]);

    await user.clear(input);
    await user.type(input, 'Keto');
    await user.click(button('Add diet'));
    await waitFor(() => {
      expect(describedBy(input)[0]).toBe(
        "Something went wrong on myli's server. Try again in a moment.",
      );
    });
    expect(document.activeElement).toBe(input);

    answer = () =>
      problemResponse(422, 'The request has invalid fields.', {
        type: VALIDATION_PROBLEM_TYPE,
        errors: [{ in: 'body', pointer: '#/name', detail: 'Name the tag differently.' }],
      });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(describedBy(input)[0]).toBe('Name the tag differently.');
    });

    answer = () =>
      HttpResponse.json({ tag: { id: 70, type: 'diet', name: 'Keto' } }, { status: 201 });
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(describedBy(input)).toEqual(['Like Vegetarian, or Gluten-free.']);
    });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('adds a tag once, however often it’s asked to while it does', async () => {
    const held = Promise.withResolvers<undefined>();
    const { user, created } = await editTags([], {
      create: async ({ name }) => {
        await held.promise;
        return HttpResponse.json({ tag: { id: 70, type: 'custom', name } }, { status: 201 });
      },
    });

    await user.type(field('New tag'), 'Holiday{Enter}');
    await user.click(button('Add tag'));
    await user.keyboard('{Enter}');
    expect(button('Add tag').getAttribute('aria-disabled')).toBe('true');
    held.resolve(undefined);

    await waitFor(() => {
      expect(button('Add tag').hasAttribute('aria-disabled')).toBe(false);
    });
    expect(created).toEqual([{ type: 'custom', name: 'Holiday' }]);
  });

  it('leaves Enter to an input method composing a character', async () => {
    const { created } = await editTags([]);

    await fireEvent.keyDown(field('New cuisine'), { key: 'Enter', isComposing: true });

    expect(describedBy(field('New cuisine'))).toEqual(['Like Thai, or Southern.']);
    expect(created).toEqual([]);
  });

  it('says when the tags can’t be loaded, and tries again when asked', async () => {
    answerRecipe(sampleRecipe({ tags: [ITALIAN] }));
    let failing = true;
    apiServer.use(
      http.get('/api/v1/tags', () =>
        failing ? problemResponse(503, 'Unavailable.') : HttpResponse.json({ tags: sampleTags() }),
      ),
    );
    const { user } = await renderApp('/recipes/recipe-bread/edit');

    await screen.findByRole('button', { name: 'Try again' });
    // Trying again loads the tags, and doesn't save the recipe, whose form it's in.
    let submitted = 0;
    button('Save changes')
      .closest('form')
      ?.addEventListener('submit', () => {
        submitted += 1;
      });
    failing = false;
    await user.click(button('Try again'));

    await waitFor(() => {
      expect(checked('Italian')).toBe(true);
    });
    expect(submitted).toBe(0);
  });

  it('says when a recipe has more tags than it can', async () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      id: 100 + index,
      type: 'custom' as const,
      name: `Tag ${String(index)}`,
    }));
    const { user, saved } = await editTags(many);

    await user.click(button('Save changes'));

    expect(await screen.findByText('A recipe can have up to 50 tags.')).toBeDefined();
    expect(saved).toEqual([]);
  });
});
