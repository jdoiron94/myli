import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
} from '@playwright/test';
import { devDataDir } from '../browsers.ts';
import { composeProject } from '../images.ts';

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
  /** What the tests run against: the dev servers (start-api.ts) or a Compose stack. */
  stack: 'dev' | 'compose';
}

interface Fixtures {
  /** Opens another browser context, for someone else in their own browser. Closed afterwards. */
  newContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  /** The Content Security Policy violations in the test's pages. The test fails if there are any. */
  cspViolations: string[];
  /**
   * Makes a reset link for the account with this address, as whoever runs the server does without
   * email: with the API's `reset-password.ts`, on the dev servers' database or in the stack's API
   * container. Returns the link it prints.
   */
  operatorResetLink: (email: string) => string;
}

const RESET_SCRIPT = join(import.meta.dirname, '../../apps/api/src/reset-password.ts');

/** Playwright's `test`, failing when a page it opens breaks the Content Security Policy. */
export const test = base.extend<Fixtures & Options>({
  clientAddress: ['127.0.0.1', { option: true }],
  searchAvailable: [false, { option: true }],
  blobStore: ['local', { option: true }],
  stack: ['dev', { option: true }],
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
  operatorResetLink: async ({ stack, browserName, baseURL }, use) => {
    await use((email) => {
      const output =
        stack === 'compose'
          ? execFileSync(
              'docker',
              [
                'compose',
                '--project-name',
                composeProject(browserName),
                'exec',
                '-T',
                'api',
                'node',
                'src/reset-password.ts',
                email,
              ],
              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
            )
          : execFileSync(process.execPath, [RESET_SCRIPT, email], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
              // As start-api.ts runs the API: its database, and nothing from the shell or `.env`.
              env: {
                PATH: process.env.PATH,
                PUBLIC_URL: baseURL,
                DATABASE_PATH: join(devDataDir(browserName), 'myli.db'),
                BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
                MEILI_MASTER_KEY: randomBytes(32).toString('base64'),
              },
            });
      const link = /^https?:\/\/\S+#[\w-]{43}$/m.exec(output)?.[0];
      if (link === undefined) throw new Error(`reset-password.ts printed no link: ${output}`);
      return link;
    });
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
