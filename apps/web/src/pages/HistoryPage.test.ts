import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  answerRecipe,
  answerRevisions,
  revisionContent,
  sampleImage,
  sampleRecipe,
  sampleRevision,
} from '@/recipes/testing.ts';
import { apiServer, problemResponse, renderApp, testUsers } from '@/testing.ts';

/** What each revision in the history says, line by line. */
const historyLines = () =>
  within(screen.getByRole('list', { name: 'Revisions' }))
    .getAllByRole('listitem')
    .map((item) =>
      [...item.querySelectorAll('p')].map((line) => line.textContent.replace(/\s+/g, ' ').trim()),
    );

describe('a recipe’s history', () => {
  it('lists every revision from the recipe’s page, newest first, with who saved it, when and why', async () => {
    answerRecipe(sampleRecipe({ revision: 3 }));
    answerRevisions([
      sampleRevision(3, {
        author: { id: testUsers.admin.id, name: testUsers.admin.name, avatar: null },
        message: 'Restored from revision #1',
      }),
      sampleRevision(2, { message: 'Less salt' }),
      sampleRevision(1),
    ]);
    const { user } = await renderApp('/recipes/recipe-bread');
    await screen.findByText('Revision 3');

    await user.click(screen.getByRole('link', { name: 'History' }));

    await screen.findByRole('list', { name: 'Revisions' });
    expect(historyLines()).toEqual([
      [
        'Revision 3 Published',
        'Restored from revision #1',
        'Compare with revision 2',
        expect.stringMatching(/^Grace Hopper, /),
      ],
      [
        'Revision 2',
        'Less salt',
        'Compare with revision 1',
        expect.stringMatching(/^Ada Lovelace, /),
      ],
      ['Revision 1', expect.stringMatching(/^Ada Lovelace, /)],
    ]);
    expect(document.title).toBe('History: Weeknight Bread · myli');
  });

  it('shows a revision as it was then, its tags’ names and photos’ alt text too, and that it was published since', async () => {
    answerRecipe(sampleRecipe({ revision: 3 }));
    const then = sampleRecipe({
      title: 'Plain Bread',
      tags: [{ id: 20, type: 'cuisine', name: 'Italiano' }],
      images: [sampleImage('photo-old', 'The first loaf')],
      coverImageId: 'photo-old',
    });
    answerRevisions([
      sampleRevision(3),
      sampleRevision(2, { content: revisionContent(then), message: 'A photo' }),
      sampleRevision(1),
    ]);
    const { user } = await renderApp('/recipes/recipe-bread/history');

    await user.click(await screen.findByRole('link', { name: 'Revision 2' }));

    await screen.findByRole('heading', { level: 1, name: 'Plain Bread' });
    expect(
      within(screen.getByRole('list', { name: 'Tags' }))
        .getAllByRole('listitem')
        .map((tag) => tag.textContent.trim()),
    ).toEqual(['Italiano']);
    expect(screen.getByRole('img', { name: 'The first loaf' })).toBeDefined();
    expect(screen.getByText('What changed: A photo')).toBeDefined();
    expect(
      screen.getByText(/^The recipe was published again since, and is at revision 3 now\./),
    ).toBeDefined();
    expect(document.title).toBe('Revision 2: Plain Bread · myli');
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('says why the history couldn’t load, and loads it once tried again', async () => {
    answerRecipe(sampleRecipe());
    let down = true;
    apiServer.use(
      http.get('/api/v1/recipes/:id/revisions', () =>
        down
          ? problemResponse(500, 'Something went wrong.')
          : HttpResponse.json({ revisions: [sampleRevision(1)] }),
      ),
    );
    const { user } = await renderApp('/recipes/recipe-bread/history');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Something went wrong/);
    down = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(historyLines()).toEqual([['Revision 1 Published', expect.any(String)]]);
    });
  });
});
