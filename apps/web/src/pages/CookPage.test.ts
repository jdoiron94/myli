import { screen, waitFor, within } from '@testing-library/vue';
import { describe, expect, it, onTestFinished } from 'vitest';
import { answerRecipe, sampleRecipe } from '@/recipes/testing.ts';
import { renderApp } from '@/testing.ts';

const SCREEN_ON = 'Your screen stays on while cook mode is open.';
const recipeHeading = () => screen.findByRole('heading', { level: 1, name: 'Weeknight Bread' });
const servingsField = () => screen.getByRole('textbox', { name: 'Servings' });

class FakeLock extends EventTarget {
  readonly type = 'screen';
  released = false;

  release() {
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
    return Promise.resolve();
  }
}

/**
 * Stands in for the Screen Wake Lock API, which jsdom doesn't have. Each request waits for `answer`,
 * and is granted unless it throws. `hide()` and `show()` do what a browser does as the page is
 * hidden (letting go of every lock) and shown again.
 */
function fakeWakeLock(answer: () => Promise<unknown> = () => Promise.resolve()) {
  let asked = 0;
  const granted: FakeLock[] = [];
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        asked += 1;
        await answer();
        const lock = new FakeLock();
        granted.push(lock);
        return lock;
      },
    },
  });
  const visibility = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
  });
  return {
    counts: () => ({
      asked,
      granted: granted.length,
      held: granted.filter((lock) => !lock.released).length,
    }),
    hide: () => {
      for (const lock of granted) void lock.release();
      visibility('hidden');
    },
    show: () => {
      visibility('visible');
    },
  };
}

describe('cook mode', () => {
  it('carries the servings chosen to cook mode and back, keeping each page’s title', async () => {
    answerRecipe(sampleRecipe());
    const { router, user } = await renderApp('/recipes/recipe-bread');
    await recipeHeading();
    await screen.findByRole('radio', { name: 'US customary' });

    await user.clear(servingsField());
    await user.type(servingsField(), '16');
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread?servings=16');
    });
    expect(document.title).toBe('Weeknight Bread · myli');
    await user.click(screen.getByRole('link', { name: 'Cook mode' }));

    await screen.findByRole('link', { name: 'Back to recipe' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread/cook?servings=16');
    expect(document.title).toBe('Cook mode: Weeknight Bread · myli');
    expect(servingsField()).toHaveProperty('value', '16');
    const items = (name: string) =>
      within(screen.getByRole('region', { name }))
        .getAllByRole('listitem')
        .map((item) => item.textContent.trim());
    await waitFor(() => {
      expect(items('Ingredients')).toEqual(['1½ quarts all-purpose flour', 'salt, to taste']);
    });
    expect(items('Steps')).toEqual(['Mix everything.', 'Bake at 400°F.']);

    await user.click(screen.getByRole('button', { name: 'Fewer servings' }));
    await waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread/cook?servings=15');
    });
    expect(document.title).toBe('Cook mode: Weeknight Bread · myli');
    await user.click(screen.getByRole('link', { name: 'Back to recipe' }));

    await screen.findByRole('link', { name: 'Cook mode' });
    expect(router.currentRoute.value.fullPath).toBe('/recipes/recipe-bread?servings=15');
    expect(servingsField()).toHaveProperty('value', '15');
  });

  it('keeps the screen on while open, asks again each time it shows, and lets go when left', async () => {
    answerRecipe(sampleRecipe());
    const wakeLock = fakeWakeLock();
    const { router } = await renderApp('/recipes/recipe-bread/cook');

    await screen.findByText(SCREEN_ON);
    expect(wakeLock.counts()).toEqual({ asked: 1, granted: 1, held: 1 });

    wakeLock.hide();
    wakeLock.show();
    await waitFor(() => {
      expect(wakeLock.counts()).toEqual({ asked: 2, granted: 2, held: 1 });
    });

    await router.push('/recipes/recipe-bread');
    await screen.findByRole('link', { name: 'Cook mode' });
    expect(wakeLock.counts()).toEqual({ asked: 2, granted: 2, held: 0 });
  });

  it('lets go of the lock when it’s granted only after cook mode was left', async () => {
    answerRecipe(sampleRecipe());
    const granting = Promise.withResolvers();
    const wakeLock = fakeWakeLock(() => granting.promise);
    const { router } = await renderApp('/recipes/recipe-bread/cook');
    await recipeHeading();

    await router.push('/recipes/recipe-bread');
    await screen.findByRole('link', { name: 'Cook mode' });
    granting.resolve(undefined);

    await waitFor(() => {
      expect(wakeLock.counts()).toEqual({ asked: 1, granted: 1, held: 0 });
    });
  });

  it('says plainly when the screen can’t be kept on, whether the browser can’t or won’t', async () => {
    answerRecipe(sampleRecipe());
    const { router } = await renderApp('/recipes/recipe-bread/cook');
    await recipeHeading();
    // Nothing else is affected.
    expect(screen.getByRole('region', { name: 'Steps' })).toBeDefined();
    expect(
      screen.getByText(
        "This browser can't keep your screen on, so it may turn off while you cook.",
      ),
    ).toBeDefined();

    fakeWakeLock(() => Promise.reject(new DOMException('Battery saver is on.', 'NotAllowedError')));
    await router.push('/recipes/recipe-bread');
    await screen.findByRole('link', { name: 'Cook mode' });
    await router.push('/recipes/recipe-bread/cook');

    await screen.findByText("Your screen couldn't be kept on, so it may turn off while you cook.");
  });

  it('says the same thing as the recipe’s page for a recipe it can’t show', async () => {
    answerRecipe(sampleRecipe());
    await renderApp('/recipes/someone-elses/cook');

    await screen.findByRole('heading', { level: 1, name: 'Recipe not found' });
    expect(
      screen.getByText("This recipe doesn't exist, was deleted, or isn't shared with you."),
    ).toBeDefined();
    expect(document.title).toBe('Recipe not found · myli');
  });
});
