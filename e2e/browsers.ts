import { devices, type PlaywrightTestConfig } from '@playwright/test';

/** The browsers every run uses, against the dev servers and against the images. */
export const BROWSERS = [
  { name: 'chromium', device: devices['Desktop Chrome'] },
  // Firefox lacks some CSS that Chromium has (`text-wrap: pretty`, found in increment 16f).
  { name: 'firefox', device: devices['Desktop Firefox'] },
] as const;

/** One web server's settings. Playwright doesn't export the type. */
export type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

/** What both configurations share. */
export const COMMON_CONFIG = {
  testDir: 'tests',
  // Each browser runs against its own stack, so the browsers run side by side.
  workers: BROWSERS.length,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
} satisfies PlaywrightTestConfig;
