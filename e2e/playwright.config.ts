import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/** One web server's settings. Playwright doesn't export the type. */
type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

/**
 * Each browser gets its own API, database and Vite dev server, because first-run setup happens
 * once per database. The ports differ from `pnpm dev`'s (3000 and 5173), so both can run at once.
 */
const BROWSERS = [
  { name: 'chromium', device: devices['Desktop Chrome'] },
  // Firefox lacks some CSS that Chromium has (`text-wrap: pretty`, found in increment 16f).
  { name: 'firefox', device: devices['Desktop Firefox'] },
] as const;

const stacks = BROWSERS.map((browser, index) => ({
  ...browser,
  apiPort: 3100 + index,
  webUrl: `http://localhost:${String(5180 + index)}`,
}));

export default defineConfig({
  testDir: 'tests',
  // One journey per browser, each against its own stack.
  workers: BROWSERS.length,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: stacks.map(({ name, device, webUrl }) => ({
    name,
    use: { ...device, baseURL: webUrl },
  })),
  webServer: stacks.flatMap(({ name, apiPort, webUrl }): WebServer[] => [
    {
      name: `${name} API`,
      command: 'node start-api.ts',
      env: { PORT: String(apiPort), PUBLIC_URL: webUrl },
      url: `http://127.0.0.1:${String(apiPort)}/healthz`,
      reuseExistingServer: false,
      // Playwright kills web servers outright unless told otherwise, which would leave the
      // launcher no chance to delete the database.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: `${name} web`,
      // PORT is the API's port, which the dev server's proxy sends `/api` to (apps/web/vite.config.ts).
      command: `pnpm --filter @myli/web exec vite --port ${new URL(webUrl).port}`,
      env: { PORT: String(apiPort) },
      url: webUrl,
      reuseExistingServer: false,
    },
  ]),
});
