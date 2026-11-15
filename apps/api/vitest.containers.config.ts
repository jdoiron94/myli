import { defineConfig } from 'vitest/config';
import { CONTAINER_TESTS } from './vitest.config.ts';

/** Tests against real services in Docker containers, through Testcontainers. */
export default defineConfig({
  test: {
    include: [`src/${CONTAINER_TESTS}`],
    // The first run pulls the images.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
