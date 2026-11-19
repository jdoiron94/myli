import { versionETag } from '@myli/shared';
import { screen, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import type { Recipe } from '@/recipes/recipe.ts';
import {
  answerRevisions,
  sampleRecipe,
  sampleRevision,
  staleRecipeResponse,
} from '@/recipes/testing.ts';
import { apiServer, renderApp } from '@/testing.ts';

/**
 * Stands in for the API's copy of the recipe: GET answers it, and a restore based on its version
 * publishes the revision as the next one, or else answers 412 with the recipe as it is now. Keeps
 * each restore's revision and `If-Match`. `publishElsewhere()` publishes as someone else would.
 */
function storeRecipe(recipe: Recipe) {
  answerPreferences();
  let stored = recipe;
  const next = () => ({ ...stored, revision: stored.revision + 1, version: stored.version + 1 });
  const sent: { number: string; ifMatch: string | null }[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe: stored })),
    http.post('/api/v1/recipes/:id/revisions/:number/restore', ({ request, params }) => {
      const ifMatch = request.headers.get('if-match');
      sent.push({ number: String(params.number), ifMatch });
      if (ifMatch !== versionETag(stored.version)) return staleRecipeResponse(stored);
      stored = next();
      return HttpResponse.json({ recipe: stored });
    }),
  );
  return {
    sent,
    publishElsewhere: () => {
      stored = next();
    },
  };
}

const restoreButton = () => screen.queryByRole('button', { name: 'Restore this revision' });

describe('restoring a revision', () => {
  it('restores an earlier one once asked, based on the version shown, then shows the recipe', async () => {
    const { sent } = storeRecipe(sampleRecipe({ revision: 3, version: 5 }));
    answerRevisions([sampleRevision(3), sampleRevision(2), sampleRevision(1)]);
    const { user } = await renderApp('/recipes/recipe-bread/history/3');
    await screen.findByText('It’s the one published.');
    // The one published needs no restoring.
    expect(restoreButton()).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Back to history' }));
    await user.click(await screen.findByRole('link', { name: 'Revision 2' }));
    await user.click(await screen.findByRole('button', { name: 'Restore this revision' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore revision 2?' });
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));

    await screen.findByText('Revision 4');
    expect(sent).toEqual([{ number: '2', ifMatch: versionETag(5) }]);
    expect(
      screen.getByText('Restored revision 2. It’s published as revision 4.').getAttribute('role'),
    ).toBe('status');
    await screen.findByRole('radio', { name: 'US customary' });
  });

  it('never offers it to anyone who may not edit the recipe', async () => {
    storeRecipe(sampleRecipe({ revision: 3 }));
    answerRevisions([sampleRevision(3), sampleRevision(2), sampleRevision(1)]);
    await renderApp('/recipes/recipe-bread/history/2', { signedInAs: 'viewer' });

    await screen.findByText(/^The recipe was published again since/);
    expect(restoreButton()).toBeNull();
  });

  it('says when someone changed the recipe meanwhile, and shows it as it is now', async () => {
    const { sent, publishElsewhere } = storeRecipe(sampleRecipe({ revision: 3, version: 5 }));
    answerRevisions([sampleRevision(3), sampleRevision(2), sampleRevision(1)]);
    const { user } = await renderApp('/recipes/recipe-bread/history/2');
    await user.click(await screen.findByRole('button', { name: 'Restore this revision' }));
    publishElsewhere();

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(
      await screen.findByText(/^Someone changed this recipe after this page loaded/),
    ).toBeDefined();
    expect(
      screen.getByText(/^The recipe was published again since, and is at revision 4 now\./),
    ).toBeDefined();
    expect(sent).toEqual([{ number: '2', ifMatch: versionETag(5) }]);
  });
});
