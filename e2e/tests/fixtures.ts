import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
} from '@playwright/test';

export { expect };

declare global {
  interface Window {
    /** Added by `watch()` below to every page of a watched context. */
    reportCspViolation?: (violation: string) => void;
  }
}

/**
 * Collects each Content Security Policy violation in `context`'s pages. Caddy sends the CSP
 * (apps/web/Caddyfile), so only the run against the images can find any: the dev servers send none.
 */
async function watch(context: BrowserContext, violations: string[]) {
  await context.exposeFunction('reportCspViolation', (violation: string) => {
    violations.push(violation);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const blocked = event.blockedURI || 'inline';
      window.reportCspViolation?.(
        `${location.pathname}: ${event.effectiveDirective} blocked ${blocked} (${event.sourceFile}:${String(event.lineNumber)})`,
      );
    });
  });
}

/** Settings a project gives its tests (playwright.config.ts, playwright.containers.config.ts). */
export interface Options {
  /**
   * The address the API should record for the browser's requests. Through the dev server's proxy,
   * it's the loopback address, the default. Through Caddy, the API takes it from X-Forwarded-For.
   */
  clientAddress: string;
  /**
   * Whether the API has Meilisearch. The dev servers' API runs without it (`start-api.ts`), as in
   * degraded mode; the Compose stack has it.
   */
  searchAvailable: boolean;
  /** Where the API keeps photos: in a directory, or, in one Compose stack, in Garage. */
  blobStore: 'local' | 's3';
}

interface Fixtures {
  /** Opens another browser context, for someone else in their own browser. Closed afterwards. */
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  /** The Content Security Policy violations in the test's pages. The test fails if there are any. */
  cspViolations: string[];
}

/** Playwright's `test`, failing when a page it opens breaks the Content Security Policy. */
export const test = base.extend<Fixtures & Options>({
  clientAddress: ['127.0.0.1', { option: true }],
  searchAvailable: [false, { option: true }],
  blobStore: ['local', { option: true }],
  cspViolations: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern.
    async ({}, use) => {
      const violations: string[] = [];
      await use(violations);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
  context: async ({ context, cspViolations }, use) => {
    await watch(context, cspViolations);
    await use(context);
  },
  newContext: async ({ browser, cspViolations }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (options) => {
      const context = await browser.newContext(options);
      opened.push(context);
      await watch(context, cspViolations);
      return context;
    });
    await Promise.all(opened.map((context) => context.close()));
  },
});
