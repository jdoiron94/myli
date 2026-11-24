import { screen, waitFor, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { storeCollections } from '@/collections/testing.ts';
import { sampleSummary } from '@/recipes/testing.ts';
import { describedBy, renderApp } from '@/testing.ts';

describe('the collections page', () => {
  it('creates one named, saying at the field what’s wrong first, and focuses it in the list', async () => {
    const sent = storeCollections([
      { id: 'weeknight', name: 'Weeknight', recipes: [sampleSummary()] },
    ]);
    const { user } = await renderApp('/collections');
    const item = within(await screen.findByRole('list', { name: 'Collections' })).getByRole(
      'listitem',
    );
    expect(within(item).getByRole('link', { name: 'Weeknight' })).toBeDefined();
    expect(within(item).getByText('1 recipe')).toBeDefined();

    const field = screen.getByRole('textbox', { name: 'Name' });
    const create = screen.getByRole('button', { name: 'Create collection' });
    await user.click(create);
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect(describedBy(field)).toEqual(['Name the collection.']);

    await user.type(field, 'weeknight');
    await user.click(create);
    await waitFor(() => {
      expect(describedBy(field)).toEqual(['You already have a collection called “Weeknight”.']);
    });
    expect(document.activeElement).toBe(field);

    await user.clear(field);
    await user.type(field, 'Baking');
    await user.click(create);
    const created = await screen.findByRole('link', { name: 'Baking' });
    await waitFor(() => {
      expect(document.activeElement).toBe(created);
    });
    expect(screen.getByText('Created “Baking”.')).toBeDefined();
    expect((field as HTMLInputElement).value).toBe('');
    expect(sent.map(({ body }) => body)).toEqual([{ name: 'weeknight' }, { name: 'Baking' }]);
  });
});
