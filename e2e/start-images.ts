/**
 * Starts the images for one browser's run against them (playwright.containers.config.ts): the API,
 * on an empty database inside its container, and the web server in front of it on WEB_PORT.
 * build-images.ts builds them first.
 *
 * The API gets only the variables below, as with start-api.ts: no first admin, no SMTP, and no
 * Meilisearch, so it logs one warning that search is unavailable. When Playwright stops this
 * launcher, it removes the containers. If the launcher dies instead, Testcontainers' reaper does.
 */
import { randomBytes } from 'node:crypto';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { API_IMAGE, WEB_IMAGE } from './images.ts';

const { WEB_PORT, PUBLIC_URL } = process.env;
if (!WEB_PORT || !PUBLIC_URL) throw new Error('WEB_PORT and PUBLIC_URL must be set');

const network = await new Network().start();
const api = await new GenericContainer(API_IMAGE)
  .withNetwork(network)
  // The web server's default address for the API (apps/web/Caddyfile).
  .withNetworkAliases('api')
  .withEnvironment({
    // Turns off Better Auth's rate limiter: the journey signs in more often than it allows.
    NODE_ENV: 'development',
    PUBLIC_URL,
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    // Nothing listens there.
    MEILI_URL: 'http://127.0.0.1:7700',
    MEILI_MASTER_KEY: randomBytes(32).toString('base64'),
    LOG_LEVEL: 'warn',
  })
  .withLogConsumer((stream) => stream.pipe(process.stdout))
  .withWaitStrategy(Wait.forHealthCheck())
  .start();
const web = await new GenericContainer(WEB_IMAGE)
  .withNetwork(network)
  .withExposedPorts({ container: 80, host: Number(WEB_PORT) })
  .withWaitStrategy(Wait.forHealthCheck())
  .start();

// Testcontainers doesn't keep the process alive, and its reaper removes the containers once the
// process has gone, so this waits for Playwright's signal.
const keepAlive = setInterval(() => undefined, 60_000);

async function stop() {
  clearInterval(keepAlive);
  await web.stop();
  await api.stop();
  await network.stop();
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void stop());
}
