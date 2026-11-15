import { configDefaults, defineConfig } from 'vitest/config';

/** Container tests need Docker, so `pnpm test` leaves them out. `pnpm test:containers` runs them. */
export const CONTAINER_TESTS = '**/*.container.test.ts';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, CONTAINER_TESTS],
  },
});
