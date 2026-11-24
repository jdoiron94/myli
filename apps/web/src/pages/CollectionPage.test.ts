import { screen, waitFor, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { storeCollections } from '@/collections/testing.ts';
import { cardParts, sampleSummary } from '@/recipes/testing.ts';
import { describedBy, renderApp } from '@/testing.ts';

const bread = sampleSummary({ id: 'bread', title: 'Bread' });
const curry = sampleSummary({ id: 'curry', title: 'Curry' });
const tacos = sampleSummary({ id: 'tacos', title: 'Tacos' });

/** The titles of the recipes the page shows, in order. */
const titles = () =>
  within(screen.getByRole('list', { name: 'Recipes in this collection' }))
    .getAllByRole('article')
    .map((card) => cardParts(card).title);

async function open(path = '/collections/weeknight') {
  const app = await renderApp(path);
  await waitFor(() => {
    expect(screen.queryByText('Loading the collection…')).toBeNull();
  });
  return app;
}

describe('a collection’s page', () => {
  it('moves recipes earlier and later, focus going with them, and takes one out', async () => {
    const sent = storeCollections([
      { id: 'weeknight', name: 'Weeknight', recipes: [bread, curry, tacos] },
    ]);
    const { user } = await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Weeknight' })).toBeDefined();
    expect(titles()).toEqual(['Bread', 'Curry', 'Tacos']);

    await user.click(screen.getByRole('button', { name: 'Move later: Bread' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Move later: Bread' }),
      );
    });
    expect(titles()).toEqual(['Curry', 'Bread', 'Tacos']);
    // Already first: nothing to send, and focus stays.
    const first = screen.getByRole('button', { name: 'Move earlier: Curry' });
    await user.click(first);
    expect(document.activeElement).toBe(first);

    await user.click(screen.getByRole('button', { name: 'Take out: Tacos' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    expect(titles()).toEqual(['Curry', 'Bread']);
    expect(screen.getByText('Took “Tacos” out of this collection.')).toBeDefined();
    expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['PUT', '/collections/weeknight/order', { recipeIds: ['curry', 'bread', 'tacos'] }],
      ['DELETE', '/collections/weeknight/recipes/tacos', undefined],
    ]);
  });

  it('is renamed, saying at the field when the name is taken, and deleted once confirmed', async () => {
    storeCollections([
      { id: 'weeknight', name: 'Weeknight', recipes: [] },
      { id: 'baking', name: 'Baking', recipes: [] },
    ]);
    const { user, router } = await open();
    expect(screen.getByText('Choose Collections on a recipe’s page to add it here.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(field);
    await user.type(field, 'baking');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await new Promise((r) => setTimeout(r, 300));
    await waitFor(() => {
      expect(describedBy(field)).toEqual(['You already have a collection called “Baking”.']);
    });
    await user.clear(field);
    await user.type(field, 'Weeknight dinners');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename' }));
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Weeknight dinners' })).toBeDefined();
    expect(screen.getByText('Renamed “Weeknight dinners”.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete collection' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete “Weeknight dinners”?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete collection' }));
    await screen.findByText('Deleted “Weeknight dinners”.');
    expect(router.currentRoute.value.fullPath).toBe('/collections');
    expect(await screen.findByRole('link', { name: 'Baking' })).toBeDefined();
    expect(screen.queryByRole('link', { name: /Weeknight/ })).toBeNull();
  });

  it('says so for one the reader doesn’t have', async () => {
    storeCollections([]);
    await open('/collections/someone-elses');
    expect(screen.getByRole('heading', { level: 1, name: 'Collection not found' })).toBeDefined();
    expect(screen.getByText("This collection doesn't exist, or was deleted.")).toBeDefined();
  });
});
