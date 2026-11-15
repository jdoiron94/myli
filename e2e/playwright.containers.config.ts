import { defineConfig } from '@playwright/test';
import { BROWSERS, COMMON_CONFIG, type WebServer } from './browsers.ts';

/**
 * The end-to-end tests against the Docker images, as they're deployed: Caddy in front of the API,
 * with its headers and Content Security Policy. `pnpm test:containers` builds the images first
 * (build-images.ts). Each browser gets its own containers (start-images.ts), on ports that differ
 * from the dev servers' run, so both can run at once.
 */
const stacks = BROWSERS.map((browser, index) => ({
  ...browser,
  webUrl: `http://localhost:${String(5190 + index)}`,
}));

export default defineConfig({
  ...COMMON_CONFIG,
  projects: stacks.map(({ name, device, webUrl }) => ({
    name,
    use: { ...device, baseURL: webUrl },
  })),
  webServer: stacks.map(
    ({ name, webUrl }): WebServer => ({
      name: `${name} containers`,
      command: 'node start-images.ts',
      env: { WEB_PORT: new URL(webUrl).port, PUBLIC_URL: webUrl },
      url: webUrl,
      reuseExistingServer: false,
      // The launcher stops and removes its containers when it's told to stop.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  ),
});
