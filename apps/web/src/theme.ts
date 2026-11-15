import { createSharedComposable, useColorMode } from '@vueuse/core';

/**
 * The localStorage key for the theme choice. `public/theme.js` reads it too, to apply the theme
 * before the first paint.
 */
export const THEME_STORAGE_KEY = 'myli-theme';

/** `auto` follows the device's light or dark setting. */
export const THEME_CHOICES = ['auto', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

/**
 * The theme the user chose (`choice`), and the one in effect (`active`). Keeps the `light` or
 * `dark` class on `<html>` in step with both, following the device while the choice is `auto`.
 * Shared, so every component that calls it sees the same state. It only runs while one is mounted:
 * the theme menu, which every page's layout has.
 */
export const useTheme = createSharedComposable(() => {
  const { store, state } = useColorMode({
    storageKey: THEME_STORAGE_KEY,
    // Otherwise it adds a <style> element while switching, which a strict CSP would block.
    disableTransition: false,
  });
  return { choice: store, active: state };
});
