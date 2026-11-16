import { defineConfig } from '@playwright/test';
import { BROWSERS, COMMON_CONFIG, type WebServer } from './browsers.ts';
import { redirectPortFor } from './images.ts';

/**
 * The end-to-end tests against the Docker images, as they're deployed: Caddy in front of the API,
 * with HTTPS, its headers and Content Security Policy. `pnpm test:containers` builds the images
 * first (build-images.ts). Each browser gets its own containers (start-images.ts), on ports that
 * differ from the dev servers' run, so both can run at once.
 *
 * Each run's web server makes a new local CA, which the browsers don't trust, so they ignore
 * certificate errors here. web-server.spec.ts checks the certificate itself.
 */
const stacks = BROWSERS.map((browser, index) => ({
  ...browser,
  webUrl: `https://localhost:${String(5190 + index)}`,
}));

export default defineConfig({
  ...COMMON_CONFIG,
  projects: stacks.map(({ name, device, webUrl }) => ({
    name,
    use: { ...device, baseURL: webUrl, ignoreHTTPSErrors: true },
  })),
  webServer: stacks.map(
    ({ name, webUrl }): WebServer => ({
      name: `${name} containers`,
      command: 'node start-images.ts',
      env: { PUBLIC_URL: webUrl, HTTP_PORT: String(redirectPortFor(webUrl)) },
      url: webUrl,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      // The launcher stops and removes its containers when it's told to stop.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  ),
});
