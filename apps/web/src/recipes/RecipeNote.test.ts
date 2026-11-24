import type { Role } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiServer, describedBy, focusedMarkdownEditor, renderApp } from '@/testing.ts';
import type { Note } from './notes.ts';
import { answerRecipe, sampleRecipe } from './testing.ts';

/** Stands in for the API's copy of the reader's note, and keeps what each request sent. */
function storeNote(initial: string | null) {
  let note: Note | null =
    initial === null ? null : { body: initial, updatedAt: '2026-11-20T18:30:00.000Z' };
  const sent: { method: string; body?: string }[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id/note', () => {
      sent.push({ method: 'GET' });
      return HttpResponse.json({ note });
    }),
    http.put('/api/v1/recipes/:id/note', async ({ request }) => {
      const { body } = (await request.json()) as { body: string };
      sent.push({ method: 'PUT', body });
      note = { body, updatedAt: '2026-11-21T09:00:00.000Z' };
      return HttpResponse.json({ note });
    }),
    http.delete('/api/v1/recipes/:id/note', () => {
      sent.push({ method: 'DELETE' });
      note = null;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}

async function openRecipe(role: Role) {
  answerRecipe(sampleRecipe());
  const app = await renderApp('/recipes/recipe-bread', { signedInAs: role });
  await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
  await screen.findByRole('radio', { name: 'US customary' });
  await waitFor(() => {
    expect(screen.queryByText(/^Loading/)).toBeNull();
  });
  return app;
}

describe('the reader’s note on a recipe', () => {
  it('is saved once written, after saying what’s missing, and deleted once confirmed', async () => {
    const sent = storeNote(null);
    const { user } = await openRecipe('editor');
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save note' }));
    const field = await focusedMarkdownEditor('Note');
    expect(describedBy(field)).toEqual(['Write the note.', 'Only you can see it.']);
    await user.keyboard('Less salt.');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Note saved.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete your note?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete note' }));

    const heading = screen.getByRole('heading', { level: 2, name: 'Your note' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.getByText('Note deleted.')).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Note' }).textContent).toBe('');
    expect(sent).toEqual([
      { method: 'GET' },
      { method: 'PUT', body: 'Less salt.' },
      { method: 'DELETE' },
    ]);
  });

  it('shows the reader’s own, rendered', async () => {
    storeNote('Less **salt**.');
    await openRecipe('editor');
    expect(within(screen.getByRole('textbox', { name: 'Note' })).getByText('salt').tagName).toBe(
      'STRONG',
    );
  });

  it('isn’t asked for or offered to viewers', async () => {
    // The API refuses viewers, and a refusal makes the app check the session again.
    const sent = storeNote(null);
    await openRecipe('viewer');
    expect(screen.queryByRole('heading', { name: 'Your note' })).toBeNull();
    expect(sent).toEqual([]);
  });
});
