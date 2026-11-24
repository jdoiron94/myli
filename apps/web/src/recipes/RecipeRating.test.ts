import type { Role } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { answerRating, apiServer, problemResponse, renderApp } from '@/testing.ts';
import { answerRecipe, sampleRecipe } from './testing.ts';

async function openRecipe(role: Role) {
  answerRecipe(sampleRecipe());
  const app = await renderApp('/recipes/recipe-bread', { signedInAs: role });
  await screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
  await screen.findByRole('radio', { name: 'US customary' });
  await screen.findByText(RATING_LINE);
  return app;
}

const RATING_LINE = /ratings yet|stars from/;
const ratingLine = () => screen.getByText(RATING_LINE).textContent.trim();
const pressed = () =>
  within(screen.getByRole('group', { name: 'Your rating' }))
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent.trim());

describe('rating a recipe', () => {
  it('rates it with the star pressed, says why when it can’t, changes it and takes it back', async () => {
    // Someone else gave it 3 stars.
    let refusing = true;
    let mine: number | null = null;
    const sent: (number | null)[] = [];
    const answer = () =>
      HttpResponse.json({
        average: mine === null ? 3 : (3 + mine) / 2,
        count: mine === null ? 1 : 2,
        mine,
      });
    apiServer.use(
      http.get('/api/v1/recipes/:id/rating', answer),
      http.put('/api/v1/recipes/:id/rating', async ({ request }) => {
        const { stars } = (await request.json()) as { stars: number };
        sent.push(stars);
        if (refusing) return problemResponse(500, 'Boom.');
        mine = stars;
        return answer();
      }),
      http.delete('/api/v1/recipes/:id/rating', () => {
        sent.push(null);
        mine = null;
        return answer();
      }),
    );
    const { user } = await openRecipe('editor');
    expect(ratingLine()).toBe('3.0 stars from 1 rating');
    expect(pressed()).toEqual([]);

    await user.click(screen.getByRole('button', { name: '4 stars' }));
    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(pressed()).toEqual([]);

    refusing = false;
    await user.click(screen.getByRole('button', { name: '4 stars' }));
    await waitFor(() => {
      expect(pressed()).toEqual(['4 stars']);
    });
    expect(ratingLine()).toBe('3.5 stars from 2 ratings');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '4 stars' }));

    await user.click(screen.getByRole('button', { name: '1 star' }));
    await waitFor(() => {
      expect(pressed()).toEqual(['1 star']);
    });

    await user.click(screen.getByRole('button', { name: 'Remove my rating' }));
    await waitFor(() => {
      expect(pressed()).toEqual([]);
    });
    expect(ratingLine()).toBe('3.0 stars from 1 rating');
    // Its button is gone, so focus goes back to the stars.
    expect(screen.queryByRole('button', { name: 'Remove my rating' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '1 star' }));
    expect(sent).toEqual([4, 4, 1, null]);
  });

  it('shows viewers the ratings, with nothing to rate it with', async () => {
    answerRating({ average: 4.5, count: 2, mine: null });
    await openRecipe('viewer');

    expect(ratingLine()).toBe('4.5 stars from 2 ratings');
    expect(screen.queryByRole('group', { name: 'Your rating' })).toBeNull();
  });
});
