import { defineConfig } from '@playwright/test';
import { BROWSERS, COMMON_CONFIG, devDataDir, type WebServer } from './browsers.ts';

/**
 * Each browser gets its own API, database and Vite dev server, because first-run setup happens
 * once per database. The ports differ from `pnpm dev`'s (3000 and 5173), so both can run at once.
 */
const stacks = BROWSERS.map((browser, index) => ({
  ...browser,
  apiPort: 3100 + index,
  webUrl: `http://localhost:${String(5180 + index)}`,
}));

export default defineConfig({
  ...COMMON_CONFIG,
  // The web server's headers and Content Security Policy come from Caddy, which only the run
  // against the Compose stack has (playwright.containers.config.ts).
  testIgnore: ['web-server.spec.ts', 'compose.spec.ts'],
  projects: stacks.map(({ name, device, webUrl }) => ({
    name,
    use: { ...device, baseURL: webUrl },
  })),
  webServer: stacks.flatMap(({ name, apiPort, webUrl }): WebServer[] => [
    {
      name: `${name} API`,
      command: 'node start-api.ts',
      env: { PORT: String(apiPort), PUBLIC_URL: webUrl, DATA_DIR: devDataDir(name) },
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
