/** The images build-images.ts builds and start-images.ts runs. Each build replaces the last. */
export const API_IMAGE = 'myli-api:e2e';
export const WEB_IMAGE = 'myli-web:e2e';

/**
 * In the run against the images, the port the web server redirects from HTTP on, for the stack
 * whose HTTPS address is `webUrl`: 100 above its HTTPS port.
 */
export function redirectPortFor(webUrl: string) {
  return Number(new URL(webUrl).port) + 100;
}
