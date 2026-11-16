import { randomBytes } from 'node:crypto';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/** The Meilisearch the container tests run against: the one compose.yaml runs (a test checks). */
export const MEILISEARCH_IMAGE =
  'getmeili/meilisearch:v1.56.1@sha256:b7ba431bf6f9b26cc86132798f3640964147a699cf23f026b74c6c05dbb1d60d';

/** The master key every test Meilisearch starts with. */
export const MEILI_MASTER_KEY = randomBytes(24).toString('base64url');

/** Meilisearch as production runs it, on a random host port unless given one. */
export function meilisearchContainer(hostPort?: number) {
  return new GenericContainer(MEILISEARCH_IMAGE)
    .withEnvironment({
      MEILI_MASTER_KEY,
      MEILI_ENV: 'production',
      MEILI_NO_ANALYTICS: 'true',
    })
    .withExposedPorts(hostPort === undefined ? 7700 : { container: 7700, host: hostPort })
    .withWaitStrategy(Wait.forHttp('/health', 7700).forStatusCode(200));
}

/** Its address from the host running the tests. */
export const meilisearchUrl = (container: StartedTestContainer) =>
  `http://${container.getHost()}:${String(container.getMappedPort(7700))}`;
