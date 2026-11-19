import { VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { Tag } from '@/recipes/recipe.ts';
import { apiServer, describedBy, problemResponse, renderApp } from '@/testing.ts';

/**
 * The Tags page, as an admin, over a fake API that keeps the tags and their counts, and changes
 * them as asked. Returns what each change sent.
 */
async function renderTags() {
  const tags: Tag[] = [
    { id: 11, type: 'cuisine', name: 'Italian' },
    { id: 10, type: 'cuisine', name: 'Italien' },
    { id: 12, type: 'cuisine', name: 'Thai' },
    { id: 1, type: 'allergen', name: 'milk' },
    { id: 20, type: 'custom', name: 'Weeknight' },
  ];
  const usage = new Map([
    [10, 1],
    [11, 3],
    [20, 1],
  ]);
  const sent = {
    renames: [] as { id: number; name: string }[],
    merges: [] as { id: number; intoId: number }[],
    deletes: [] as number[],
  };
  const find = (id: string) => tags.find((tag) => tag.id === Number(id));
  apiServer.use(
    http.get('/api/v1/tags', () => HttpResponse.json({ tags })),
    http.get('/api/v1/tags/usage', () =>
      HttpResponse.json({ usage: [...usage].map(([tagId, recipes]) => ({ tagId, recipes })) }),
    ),
    http.put<{ id: string }>('/api/v1/tags/:id', async ({ params, request }) => {
      const { name } = (await request.json()) as { name: string };
      const tag = find(params.id);
      if (!tag) return problemResponse(404, 'Tag not found.');
      sent.renames.push({ id: tag.id, name });
      const taken = tags.find(
        (other) => other !== tag && other.type === tag.type && other.name === name,
      );
      if (taken)
        return problemResponse(422, 'The request has invalid fields.', {
          type: VALIDATION_PROBLEM_TYPE,
          errors: [
            {
              in: 'body',
              pointer: '#/name',
              detail: `Another tag of this type is already called “${name}”. Merge into it instead.`,
            },
          ],
        });
      tag.name = name;
      return HttpResponse.json({ tag });
    }),
    http.post<{ id: string }>('/api/v1/tags/:id/merge', async ({ params, request }) => {
      const { intoId } = (await request.json()) as { intoId: number };
      const tag = find(params.id);
      const into = find(String(intoId));
      if (!tag || !into) return problemResponse(404, 'Tag not found.');
      sent.merges.push({ id: tag.id, intoId });
      usage.set(intoId, (usage.get(intoId) ?? 0) + (usage.get(tag.id) ?? 0));
      usage.delete(tag.id);
      tags.splice(tags.indexOf(tag), 1);
      return HttpResponse.json({ tag: into });
    }),
    http.delete<{ id: string }>('/api/v1/tags/:id', ({ params }) => {
      const tag = find(params.id);
      if (!tag) return problemResponse(404, 'Tag not found.');
      sent.deletes.push(tag.id);
      usage.delete(tag.id);
      tags.splice(tags.indexOf(tag), 1);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const rendered = await renderApp('/admin/tags', { signedInAs: 'admin' });
  await screen.findByRole('table', { name: 'Cuisines' });
  return { ...rendered, sent };
}

/** Each row of a type's table: its name and count. */
const rows = (table: string) =>
  within(screen.getByRole('table', { name: table }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 2)
        .map((cell) => cell.textContent.trim())
        .join(' · '),
    );

const status = () => screen.getAllByRole('status').map((element) => element.textContent.trim());

describe('TagsPage', () => {
  it('lists each type’s tags with their counts, offering no changes to the allergens', async () => {
    await renderTags();

    expect({
      cuisines: rows('Cuisines'),
      allergens: rows('Allergens'),
      other: rows('Other tags'),
    }).toEqual({
      cuisines: ['Italian · 3', 'Italien · 1', 'Thai · 0'],
      allergens: ['milk · 0'],
      other: ['Weeknight · 1'],
    });
    expect(screen.getByText('No meal tags yet.')).toBeDefined();
    expect(
      within(screen.getByRole('table', { name: 'Allergens' })).queryAllByRole('button'),
    ).toEqual([]);
    // Nothing to merge the only tag of its type into.
    expect(screen.queryByRole('button', { name: 'Merge Weeknight' })).toBeNull();
  });

  it('renames a tag, showing a name another tag has at the field', async () => {
    const { user, sent } = await renderTags();

    await user.click(screen.getByRole('button', { name: 'Rename Italien' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename “Italien”' });
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, 'Italian');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(describedBy(input)).toEqual([
        'Another tag of this type is already called “Italian”. Merge into it instead.',
      ]);
    });
    expect(document.activeElement).toBe(input);

    await user.clear(input);
    await user.type(input, 'Italiano');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(status()).toContain('Renamed “Italien” to “Italiano”.');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.renames).toEqual([
      { id: 10, name: 'Italian' },
      { id: 10, name: 'Italiano' },
    ]);
    expect(rows('Cuisines')).toEqual(['Italian · 3', 'Italiano · 1', 'Thai · 0']);
  });

  it('merges a tag into the one chosen, then focuses its type’s heading', async () => {
    const { user, sent } = await renderTags();

    await user.click(screen.getByRole('button', { name: 'Merge Italien' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge “Italien” into another tag' });
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    const choices = within(dialog).getByRole('radiogroup');
    await waitFor(() => {
      expect(describedBy(choices)).toEqual(['Choose the tag to merge it into.']);
    });

    await user.click(within(dialog).getByRole('radio', { name: 'Italian' }));
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));

    await waitFor(() => {
      expect(status()).toContain('Merged “Italien” into “Italian”.');
    });
    expect(sent.merges).toEqual([{ id: 10, intoId: 11 }]);
    expect(rows('Cuisines')).toEqual(['Italian · 4', 'Thai · 0']);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Cuisines' }));
  });

  it('deletes a tag once confirmed, saying how many recipes it comes off', async () => {
    const { user, sent } = await renderTags();

    await user.click(screen.getByRole('button', { name: 'Delete Weeknight' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Weeknight”?' });
    expect(within(dialog).getByText(/1 recipe you can see/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(status()).toContain('Deleted “Weeknight”.');
    });
    expect(sent.deletes).toEqual([20]);
    expect(screen.getByText('No other tags yet.')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Other tags' }));
  });
});
