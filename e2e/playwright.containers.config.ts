import { defineConfig } from '@playwright/test';
import { BROWSERS, COMMON_CONFIG, type WebServer } from './browsers.ts';
import { composeProject, redirectPortFor, STACK_READY } from './images.ts';
import type { Options } from './tests/fixtures.ts';

/**
 * The end-to-end tests against the Docker images, as they're deployed with compose.yaml: Caddy in
 * front of the API, with HTTPS, its headers and Content Security Policy, and Meilisearch.
 * `pnpm test:containers` builds the images first (build-images.ts). Each browser gets its own
 * Compose stack (start-compose.ts), on ports that differ from the dev servers' run, so both can run
 * at once.
 *
 * Each run's web server makes a new local CA, which the browsers don't trust, so they ignore
 * certificate errors here. web-server.spec.ts checks the certificate itself.
 *
 * Firefox's stack keeps photos in Garage, with compose.yaml's s3 profile; Chromium's, in the API's
 * volume.
 */
const stacks = BROWSERS.map((browser, index) => {
  const network = `10.89.${String(index + 1)}`;
  return {
    ...browser,
    webUrl: `https://localhost:${String(5190 + index)}`,
    proxySubnet: `${network}.0/29`,
    // Docker forwards connections to published ports from the network's gateway, its first address.
    clientAddress: `${network}.1`,
    blobStore: browser.name === 'firefox' ? ('s3' as const) : ('local' as const),
  };
});

export default defineConfig<Options>({
  ...COMMON_CONFIG,
  projects: stacks.map(({ name, device, webUrl, clientAddress, blobStore }) => ({
    name,
    use: {
      ...device,
      baseURL: webUrl,
      ignoreHTTPSErrors: true,
      clientAddress,
      searchAvailable: true,
      blobStore,
      stack: 'compose',
    },
  })),
  webServer: stacks.map(
    ({ name, webUrl, proxySubnet, blobStore }): WebServer => ({
      name: `${name} stack`,
      command: 'node start-compose.ts',
      env: {
        PROJECT: composeProject(name),
        PUBLIC_URL: webUrl,
        HTTP_PORT: String(redirectPortFor(webUrl)),
        PROXY_SUBNET: proxySubnet,
        BLOB_STORE: blobStore,
      },
      // Not `url`: Caddy answers before the host's network has settled (start-compose.ts), and
      // Playwright would start the tests on whichever came first.
      wait: { stdout: new RegExp(STACK_READY) },
      reuseExistingServer: false,
      // The launcher removes its stack when it's told to stop.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      stdout: 'pipe',
      stderr: 'pipe',
      // Meilisearch's and Garage's images may need pulling first.
      timeout: 180_000,
    }),
  ),
});
