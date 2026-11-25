import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import type { components } from '@/api/schema.ts';
import { apiServer, describedBy, problemResponse, renderApp } from '@/testing.ts';

type GroceryRecipe = components['schemas']['GroceryRecipe'];

/** An ingredient line as the API gives it for a grocery list. */
const line = (qty: number | null, unit: string | null, name: string, scalable = true) => ({
  qty,
  qtyMax: null,
  unit,
  name,
  normalizedName: name.toLowerCase().replace(/s$/, ''),
  scalable,
});

const pancakes: GroceryRecipe = {
  id: 'pancakes',
  title: 'Pancakes',
  servings: 4,
  ingredients: [line(2, 'cup', 'flour'), line(2, null, 'eggs'), line(null, null, 'salt', false)],
};
const waffles: GroceryRecipe = {
  id: 'waffles',
  title: 'Waffles',
  servings: 2,
  ingredients: [line(1, 'cup', 'flour'), line(1, null, 'egg')],
};

function answerIngredients(recipes: GroceryRecipe[]) {
  apiServer.use(
    http.get('/api/v1/collections/weeknight/ingredients', () =>
      HttpResponse.json({ id: 'weeknight', name: 'Weeknight', recipes }),
    ),
  );
}

/** The text of the label that names a checkbox. */
const labelOf = (box: HTMLElement) =>
  document.querySelector(`label[for="${box.id}"]`)?.textContent.trim() ?? '';

/** Each line to buy, as its checkbox is named and described, and whether it's ticked. */
const shownLines = () =>
  within(screen.getByRole('region', { name: 'To buy' }))
    .getAllByRole('checkbox')
    .map((box) => {
      const ticked = box.getAttribute('aria-checked') === 'true' ? ' (ticked)' : '';
      return `${labelOf(box)}${ticked} — ${describedBy(box).join(' ')}`;
    });

describe('a collection’s grocery list', () => {
  it('adds up its recipes at the servings chosen, which the address keeps with what’s ticked', async () => {
    answerPreferences('metric');
    answerIngredients([pancakes, waffles]);
    const { router, user } = await renderApp('/collections/weeknight/groceries');
    await screen.findByRole('checkbox', { name: 'flour: 710 ml' });
    expect(document.title).toBe('Grocery list: Weeknight · myli');
    expect(shownLines()).toEqual([
      'eggs: 3 — Pancakes, Waffles',
      'flour: 710 ml — Pancakes, Waffles',
      'salt — Pancakes',
    ]);

    await user.click(screen.getByRole('button', { name: 'More servings for Waffles' }));
    await user.click(screen.getByRole('checkbox', { name: 'salt' }));
    expect(shownLines()).toEqual([
      'eggs: 3½ — Pancakes, Waffles',
      'flour: 830 ml — Pancakes, Waffles',
      'salt (ticked) — Pancakes',
    ]);
    await waitFor(() => {
      expect(router.currentRoute.value.query).toEqual({ servings: ['waffles:3'], got: ['salt'] });
    });

    // Opened again at that address, as a reload would.
    const address = router.currentRoute.value.fullPath;
    await router.push('/');
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    await router.push(address);
    await screen.findByRole('checkbox', { name: 'flour: 830 ml' });
    expect(shownLines()).toContain('salt (ticked) — Pancakes');
    expect(screen.getByRole('link', { name: 'Waffles' }).getAttribute('href')).toBe(
      '/recipes/waffles?servings=3',
    );
  });

  it('says so when the collection isn’t there', async () => {
    answerPreferences();
    apiServer.use(
      http.get('/api/v1/collections/gone/ingredients', () =>
        problemResponse(404, 'Collection not found.'),
      ),
    );
    await renderApp('/collections/gone/groceries');
    await screen.findByRole('heading', { level: 1, name: 'Collection not found' });
    expect(screen.getByText("This collection doesn't exist, or was deleted.")).toBeDefined();
  });
});
