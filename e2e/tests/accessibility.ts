import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 A and AA, and axe's best practices, as the component tests run. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** A phone's width, the narrowest the app is built for (the iPhone 15's 390 CSS pixels). */
const PHONE = { width: 390, height: 844 };

/** Dialogs and menus, which are modal: while one is open, the rest of the page is hidden. */
const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Axe runs in Chromium only. Its rules read the DOM, ARIA and computed colors, which don't depend
 * on the engine, and in Playwright's Firefox 159 build, running it over the Invitations page
 * crashes the page's process (signal 11), though the page itself runs fine there. Firefox still
 * goes through every step, both themes and the phone width.
 */
const runsAxe = (page: Page) => page.context().browser()?.browserType().name() === 'chromium';

async function violations(page: Page, popup: boolean) {
  if (!runsAxe(page)) return [];
  const axe = new AxeBuilder({ page }).withTags(AXE_TAGS);
  const { violations } = await (popup ? axe.include(POPUPS) : axe).analyze();
  return violations.map(({ id, nodes }) => ({
    id,
    elements: nodes.map(({ html, failureSummary }) => ({ html, failureSummary })),
  }));
}

async function setScheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  // The theme follows the device until someone picks one (src/theme.ts).
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${scheme}\\b`));
  await settle(page);
}

/** Waits for running transitions, such as colors fading to the new theme, so axe sees the end. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
}

/**
 * What can be clicked but doesn't show the pointer: enabled buttons, radios and checkboxes among
 * them, and the labels that toggle those, as they're shown (only in the popup, if one is open).
 */
function withoutPointer(page: Page, popup: boolean) {
  return page.evaluate(
    ({ popup, popups }) => {
      const root = popup ? document.querySelector(popups) : document;
      if (!root) return ['(no popup)'];
      const enabled = (element: Element | null) =>
        element !== null &&
        !element.matches(':disabled') &&
        element.getAttribute('aria-disabled') !== 'true';
      const clickable = [
        ...[...root.querySelectorAll('button, [role="button"]')].filter(enabled),
        ...[...root.querySelectorAll('label[for]')].filter((label) => {
          const control = document.getElementById(label.getAttribute('for') ?? '');
          return (
            control?.matches('button:is([role="checkbox"], [role="radio"])') === true &&
            enabled(control)
          );
        }),
      ];
      return clickable
        .filter(
          (element) => element.checkVisibility() && getComputedStyle(element).cursor !== 'pointer',
        )
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} “${element.getAttribute('aria-label') ?? element.textContent.trim()}”`,
        );
    },
    { popup, popups: POPUPS },
  );
}

/**
 * Checks the page as it is now with axe (in Chromium), in the light and dark themes, color contrast
 * included (which jsdom can't measure), and at a phone's width, where it mustn't scroll sideways.
 * Everything that can be clicked must show the pointer, too.
 *
 * With a dialog or menu open, pass `popup: true` to check only that, having checked the page with
 * it closed. While it's open, reka-ui hides the rest of the page from assistive technology
 * (`aria-hidden`) and keeps focus inside it, so axe would report that the page has no main
 * landmark or heading, and that its controls are hidden but focusable, which the focus trap rules
 * out.
 */
export async function checkPage(page: Page, { popup = false }: { popup?: boolean } = {}) {
  const desktop = page.viewportSize();
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme);
      expect(await violations(page, popup), `axe, ${scheme} theme`).toEqual([]);
    }
    expect(await withoutPointer(page, popup), 'what can be clicked without the pointer').toEqual(
      [],
    );
    await page.setViewportSize(PHONE);
    await setScheme(page, 'light');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'how far the page scrolls sideways at a phone width').toBe(0);
    expect(await violations(page, popup), 'axe, phone width').toEqual([]);
  } finally {
    if (desktop) await page.setViewportSize(desktop);
    await page.emulateMedia({ colorScheme: 'light' });
  }
}
