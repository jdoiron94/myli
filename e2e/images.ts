/**
 * The images build-images.ts builds, with compose.yaml's build settings, and start-compose.ts runs.
 * Each build replaces the last.
 */
export const IMAGE_TAG = 'e2e';
export const API_IMAGE = `myli-api:${IMAGE_TAG}`;
export const WEB_IMAGE = `myli-web:${IMAGE_TAG}`;

/**
 * The variables the docker CLI needs to find the daemon and its settings: the only ones of this
 * process's that the runs against the images pass to Docker Compose, which would otherwise fill in
 * compose.yaml from the rest.
 */
export function dockerClientEnvironment(): Record<string, string> {
  const names = [
    'PATH',
    'HOME',
    'XDG_RUNTIME_DIR',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
  ];
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * What start-compose.ts prints once its stack can be tested, which Playwright waits for
 * (playwright.containers.config.ts).
 */
export const STACK_READY = 'Stack ready: its services are healthy and the host network has settled';

/** The Compose project of one browser's stack in the run against the images. */
export const composeProject = (browserName: string) => `myli-e2e-${browserName}`;

/**
 * In the run against the images, the port the web server redirects from HTTP on, for the stack
 * whose HTTPS address is `webUrl`: 100 above its HTTPS port.
 */
export function redirectPortFor(webUrl: string) {
  return Number(new URL(webUrl).port) + 100;
}
