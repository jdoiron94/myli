import { screen, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import {
  answerRecipe,
  answerRevisions,
  revisionContent,
  sampleRecipe,
  sampleRevision,
} from '@/recipes/testing.ts';
import { renderApp } from '@/testing.ts';

/**
 * Each entry of a compared list: its mark, if any, and its text, with what was taken out and what
 * was put in each in brackets, as screen readers say them.
 */
const entries = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => {
      const copy = item.cloneNode(true) as HTMLElement;
      const mark = [...copy.querySelectorAll('span')].find((span) =>
        /^(Added|Removed|Changed)$/.test(span.textContent.trim()),
      );
      mark?.remove();
      for (const part of copy.querySelectorAll('del, ins'))
        part.replaceWith(`[${part.textContent}]`);
      return [mark?.textContent.trim() ?? '', copy.textContent.trim()];
    });

/** The rows of a table under its column headings, cell by cell. */
const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.children].map((cell) => cell.textContent.trim()));

describe('comparing two revisions', () => {
  it('compares two chosen in the history, the earlier first, part by part', async () => {
    const recipe = sampleRecipe({ revision: 3 });
    answerRecipe(recipe);
    const [flour, salt] = recipe.ingredientGroups[0]?.ingredients ?? [];
    const first = sampleRecipe({
      title: 'Plain Bread',
      servings: 6,
      ingredientGroups: [
        {
          label: null,
          ingredients: [
            ...(flour ? [{ ...flour, rawText: '2 cups all-purpose flour', qty: 2 }] : []),
            ...(salt ? [salt] : []),
          ],
        },
      ],
      equipment: ['Loaf pan'],
      steps: [
        { body: 'Mix it all.', image: null },
        { body: 'Bake at **400°F**.', image: null },
      ],
      nutrition: { ...recipe.nutrition, calories: 200 },
    });
    answerRevisions([
      sampleRevision(3),
      sampleRevision(2),
      sampleRevision(1, { content: revisionContent(first) }),
    ]);
    const { user, router } = await renderApp('/recipes/recipe-bread/history');

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Compare revision' }),
      '3',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'With revision' }), '1');
    await user.click(screen.getByRole('button', { name: 'Compare' }));

    await screen.findByRole('heading', { level: 2, name: 'Details' });
    expect(router.currentRoute.value.path).toBe('/recipes/recipe-bread/history/compare/1/3');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent.trim()),
    ).toEqual(['Details', 'Ingredients', 'Equipment', 'Steps', 'Nutrition']);
    expect(rows('Details')).toEqual([
      ['Title', 'Plain Bread', 'Weeknight Bread'],
      ['Servings', '6', '8'],
    ]);
    expect(entries('Ingredients')).toEqual([
      ['Changed', '[Removed: 2][Added: 3] cups all-purpose flour'],
      ['', 'salt to taste'],
    ]);
    expect(entries('Equipment')).toEqual([
      ['', 'Loaf pan'],
      ['Added', 'Stand mixer'],
    ]);
    expect(entries('Steps')).toEqual([
      ['Changed', 'Mix [Removed: it all][Added: everything].'],
      ['', 'Bake at **400°F**.'],
    ]);
    expect(rows('Nutrition')).toEqual([['Calories', '200', '210']]);
  });

  it('says when nothing changed, as when one restored the other', async () => {
    answerRecipe(sampleRecipe({ revision: 3 }));
    answerRevisions([
      sampleRevision(3, { message: 'Restored from revision #1' }),
      sampleRevision(2, { content: revisionContent(sampleRecipe({ title: 'Plain Bread' })) }),
      sampleRevision(1),
    ]);
    await renderApp('/recipes/recipe-bread/history/compare/1/3');

    expect(await screen.findByText('Nothing changed between these two revisions.')).toBeDefined();
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
  });
});
