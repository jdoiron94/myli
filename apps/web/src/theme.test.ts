import { screen, waitFor } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import themeScript from '../public/theme.js?raw';
import { fakeDeviceScheme, htmlClasses, renderApp } from './testing.ts';
import { THEME_STORAGE_KEY } from './theme.ts';

/** Runs public/theme.js on a fresh `<html>`, as the browser does before the app loads. */
function runThemeScript() {
  document.documentElement.className = '';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the real file, unchanged
  new Function(themeScript)();
  return htmlClasses();
}

async function openThemeMenu(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  await screen.findByRole('menu');
}

/** Which theme menu item is checked, after opening the menu. */
async function checkedChoice(user: Awaited<ReturnType<typeof renderApp>>['user']) {
  await openThemeMenu(user);
  const checked = screen
    .getAllByRole('menuitemradio')
    .filter((item) => item.getAttribute('aria-checked') === 'true');
  const names = checked.map((item) => item.textContent.trim());
  await user.keyboard('{Escape}');
  return names;
}

describe('the theme menu', () => {
  it('follows the device by default, including when it changes', async () => {
    const device = fakeDeviceScheme('dark');
    const { user } = await renderApp('/');

    expect(htmlClasses()).toEqual(['dark']);
    expect(await checkedChoice(user)).toEqual(['System']);

    device.change('light');
    await waitFor(() => {
      expect(htmlClasses()).toEqual(['light']);
    });
  });

  it.each([
    ['Light', 'light', 'dark'],
    ['Dark', 'dark', 'light'],
  ] as const)(
    'applies %s over the device setting and remembers it',
    async (name, theme, deviceScheme) => {
      const device = fakeDeviceScheme(deviceScheme);
      const { user } = await renderApp('/');

      await openThemeMenu(user);
      await user.click(screen.getByRole('menuitemradio', { name }));

      await waitFor(() => {
        expect(htmlClasses()).toEqual([theme]);
      });
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
      expect(await checkedChoice(user)).toEqual([name]);
      device.change(theme === 'dark' ? 'light' : 'dark');
      expect(htmlClasses()).toEqual([theme]);
      // And the next page load starts with it, before the app runs.
      expect(runThemeScript()).toEqual([theme]);
    },
  );

  it('starts from the remembered choice', async () => {
    fakeDeviceScheme('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const { user } = await renderApp('/');

    expect(htmlClasses()).toEqual(['dark']);
    expect(await checkedChoice(user)).toEqual(['Dark']);
  });

  it('follows the device again after choosing System', async () => {
    fakeDeviceScheme('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { user } = await renderApp('/');

    await openThemeMenu(user);
    await user.click(screen.getByRole('menuitemradio', { name: 'System' }));

    await waitFor(() => {
      expect(htmlClasses()).toEqual(['dark']);
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('auto');
  });
});

describe('public/theme.js, which applies the theme before the app loads', () => {
  it.each([
    [null, 'light', 'light'],
    [null, 'dark', 'dark'],
    ['auto', 'dark', 'dark'],
    ['light', 'dark', 'light'],
    ['dark', 'light', 'dark'],
  ] as const)('with %s saved and a %s device, applies %s', (saved, deviceScheme, theme) => {
    fakeDeviceScheme(deviceScheme);
    if (saved) localStorage.setItem(THEME_STORAGE_KEY, saved);

    expect(runThemeScript()).toEqual([theme]);
  });

  it('follows the device when storage is blocked', () => {
    fakeDeviceScheme('dark');
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    expect(runThemeScript()).toEqual(['dark']);
  });
});
