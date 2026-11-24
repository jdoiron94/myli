import type { Role } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiServer, describedBy, focusedMarkdownEditor, renderApp, testUsers } from '@/testing.ts';
import type { Comment } from './comments.ts';
import { answerRecipe, sampleRecipe } from './testing.ts';

const comment = (id: string, author: Role, body: string): Comment => ({
  id,
  author: { id: testUsers[author].id, name: testUsers[author].name },
  body,
  createdAt: '2026-11-20T18:30:00.000Z',
  editedAt: null,
});

/**
 * Stands in for the API's copy of the recipe's comments, which the signed-in `role` writes, and
 * keeps what each request sent.
 */
function storeComments(role: Role, initial: Comment[]) {
  let comments = initial;
  const sent: { method: string; id?: string; body?: string }[] = [];
  const bodyOf = async (request: Request) => ((await request.json()) as { body: string }).body;
  apiServer.use(
    http.get('/api/v1/recipes/:id/comments', () => HttpResponse.json({ comments })),
    http.post('/api/v1/recipes/:id/comments', async ({ request }) => {
      const body = await bodyOf(request);
      sent.push({ method: 'POST', body });
      const posted = comment(`comment-${String(comments.length + 1)}`, role, body);
      comments = [...comments, posted];
      return HttpResponse.json(posted, { status: 201 });
    }),
    http.put('/api/v1/comments/:id', async ({ request, params }) => {
      const body = await bodyOf(request);
      sent.push({ method: 'PUT', id: String(params.id), body });
      comments = comments.map((c) =>
        c.id === params.id ? { ...c, body, editedAt: '2026-11-21T09:00:00.000Z' } : c,
      );
      return HttpResponse.json(comments.find((c) => c.id === params.id));
    }),
    http.delete('/api/v1/comments/:id', ({ params }) => {
      sent.push({ method: 'DELETE', id: String(params.id) });
      comments = comments.filter((c) => c.id !== params.id);
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
    expect(screen.queryByText('Loading comments…')).toBeNull();
  });
  return app;
}

/** The comments shown, each by what it says. */
const listed = () =>
  screen.queryAllByRole('listitem').filter((item) => item.id.startsWith('comment-'));
const commentSaying = (text: string) => {
  const item = listed().find((element) => element.textContent.includes(text));
  if (!item) throw new Error(`no comment says “${text}”`);
  return item;
};
const buttonsOf = (item: HTMLElement) =>
  within(item)
    .queryAllByRole('button')
    .map((button) => button.textContent.trim());

describe('a recipe’s comments', () => {
  it('posts one written in the editor, says what’s missing first, and focuses it once posted', async () => {
    const sent = storeComments('editor', []);
    const { user } = await openRecipe('editor');
    expect(screen.getByText('No comments yet.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    const field = await focusedMarkdownEditor('Add a comment');
    expect(describedBy(field)).toEqual(['Write the comment.']);

    await user.keyboard('Lovely bread.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(commentSaying('Lovely bread.'));
    });
    expect(sent).toEqual([{ method: 'POST', body: 'Lovely bread.' }]);
    expect(screen.getByRole('textbox', { name: 'Add a comment' }).textContent).toBe('');
  });

  it('changes the reader’s own, which then says it’s edited, and offers nothing on others’', async () => {
    const sent = storeComments('editor', [
      comment('mine', 'editor', 'Made this twice.'),
      comment('theirs', 'admin', 'Try it with rye.'),
    ]);
    const { user } = await openRecipe('editor');
    expect(buttonsOf(commentSaying('Try it with rye.'))).toEqual([]);
    expect(buttonsOf(commentSaying('Made this twice.'))).toEqual(['Edit', 'Delete']);

    await user.click(
      within(commentSaying('Made this twice.')).getByRole('button', { name: 'Edit' }),
    );
    await user.click(screen.getByRole('textbox', { name: 'Your comment' }));
    await focusedMarkdownEditor('Your comment');
    await user.keyboard(' Again.');
    await user.click(screen.getByRole('button', { name: 'Save comment' }));

    const edited = within(commentSaying('Made this twice. Again.'));
    await waitFor(() => {
      expect(document.activeElement).toBe(edited.getByRole('button', { name: 'Edit' }));
    });
    expect(
      edited
        .getByText(/edited/)
        .textContent.replace(/\s+/g, ' ')
        .trim(),
    ).toMatch(/^Ada Lovelace · .+ · edited$/);
    expect(sent).toEqual([{ method: 'PUT', id: 'mine', body: 'Made this twice. Again.' }]);
  });

  it('lets an admin delete someone else’s once confirmed, but not change it', async () => {
    const sent = storeComments('admin', [comment('theirs', 'editor', 'Made this twice.')]);
    const { user } = await openRecipe('admin');
    expect(buttonsOf(commentSaying('Made this twice.'))).toEqual(['Delete']);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete Ada Lovelace’s comment?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete comment' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Comments' }),
      );
    });
    expect(screen.getByText('No comments yet.')).toBeDefined();
    expect(screen.getByText('Comment deleted.')).toBeDefined();
    expect(sent).toEqual([{ method: 'DELETE', id: 'theirs' }]);
  });

  it('shows viewers what each says, rendered, and who wrote it, with no way to write or change one', async () => {
    storeComments('viewer', [comment('theirs', 'editor', 'Use **rye**.')]);
    await openRecipe('viewer');

    const theirs = commentSaying('Use rye.');
    expect(within(theirs).getByText('rye').tagName).toBe('STRONG');
    expect(within(theirs).getByText('Ada Lovelace')).toBeDefined();
    expect(buttonsOf(theirs)).toEqual([]);
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
  });
});
