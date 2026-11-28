import { screen, waitFor, within } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { storeCollections } from '@/collections/testing.ts';
import { cardParts, sampleSummary } from '@/recipes/testing.ts';
import { renderApp } from '@/testing.ts';

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
  it('moves recipes earlier and later, focus going with them, and takes one out once confirmed', async () => {
    const sent = storeCollections([
      { id: 'weeknight', name: 'Weeknight', recipes: [bread, curry, tacos] },
    ]);
    const { user } = await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Weeknight' })).toBeDefined();
    expect(titles()).toEqual(['Bread', 'Curry', 'Tacos']);

    await user.click(screen.getByRole('button', { name: 'Move later: Bread' }));
    // The list first: focus is on that button from the click, before the list has moved.
    await waitFor(() => {
      expect(titles()).toEqual(['Curry', 'Bread', 'Tacos']);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Move later: Bread' }),
      );
    });
    // Already first: nothing to send, and focus stays.
    const first = screen.getByRole('button', { name: 'Move earlier: Curry' });
    await user.click(first);
    expect(document.activeElement).toBe(first);

    const takeOut = screen.getByRole('button', { name: 'Take out: Tacos' });
    await user.click(takeOut);
    const asked = await screen.findByRole('alertdialog', {
      name: 'Take “Tacos” out of this collection?',
    });
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(takeOut);
    await user.click(takeOut);
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Take “Tacos” out of this collection?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Take out' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    expect(titles()).toEqual(['Curry', 'Bread']);
    expect(screen.getByText('Took “Tacos” out of this collection.')).toBeDefined();
    expect(sent.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['POST', '/collections/weeknight/recipes/bread/move', { direction: 'later' }],
      ['DELETE', '/collections/weeknight/recipes/tacos', undefined],
    ]);
  });

  it('pages its recipes, moving one from the end of a page onto the next, focus going with it', async () => {
    storeCollections([{ id: 'weeknight', name: 'Weeknight', recipes: [bread, curry, tacos] }], 2);
    const { user, router } = await open();
    expect(screen.getByText('3 recipes')).toBeDefined();
    expect(titles()).toEqual(['Bread', 'Curry']);

    await user.click(screen.getByRole('button', { name: 'Move later: Curry' }));
    await waitFor(() => {
      expect([router.currentRoute.value.fullPath, titles()]).toEqual([
        '/collections/weeknight?page=2',
        ['Curry'],
      ]);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Move later: Curry' }),
      );
    });

    // Last of all now.
    expect(
      screen.getByRole('button', { name: 'Move later: Curry' }).getAttribute('aria-disabled'),
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Move earlier: Curry' }));
    await waitFor(() => {
      expect([router.currentRoute.value.fullPath, titles()]).toEqual([
        '/collections/weeknight',
        ['Bread', 'Curry'],
      ]);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Move earlier: Curry' }),
      );
    });
  });

  it('goes back a page once the last recipe on one is taken out', async () => {
    storeCollections([{ id: 'weeknight', name: 'Weeknight', recipes: [bread, curry, tacos] }], 2);
    const { user, router } = await open('/collections/weeknight?page=2');
    await user.click(await screen.findByRole('button', { name: 'Take out: Tacos' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Take out' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    expect([router.currentRoute.value.fullPath, titles()]).toEqual([
      '/collections/weeknight',
      ['Bread', 'Curry'],
    ]);
  });

  it('is renamed, and deleted once confirmed', async () => {
    storeCollections([
      { id: 'weeknight', name: 'Weeknight', recipes: [] },
      { id: 'baking', name: 'Baking', recipes: [] },
    ]);
    const { user, router } = await open();
    expect(screen.getByText('Choose Collections on a recipe’s page to add it here.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Name' });
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

  it('takes every recipe out at once, once confirmed, going back to its first page', async () => {
    const sent = storeCollections(
      [{ id: 'weeknight', name: 'Weeknight', recipes: [bread, curry, tacos] }],
      2,
    );
    const { router, user } = await open('/collections/weeknight?page=2');
    await user.click(screen.getByRole('button', { name: 'Remove all' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Take every recipe out of “Weeknight”?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Remove all' }));
    await screen.findByText('Took every recipe out of “Weeknight”.');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    expect(router.currentRoute.value.fullPath).toBe('/collections/weeknight');
    expect(screen.getByText('0 recipes')).toBeDefined();
    expect(sent.map(({ method, path }) => [method, path])).toEqual([
      ['DELETE', '/collections/weeknight/recipes'],
    ]);
  });

  it('says so for one the reader doesn’t have', async () => {
    storeCollections([]);
    await open('/collections/someone-elses');
    expect(screen.getByRole('heading', { level: 1, name: 'Collection not found' })).toBeDefined();
    expect(screen.getByText("This collection doesn't exist, or was deleted.")).toBeDefined();
  });
});
