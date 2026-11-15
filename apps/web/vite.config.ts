import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The dev server's port. `PUBLIC_URL` must be `http://localhost:5173` in development: the browser
 * reaches the API through this server's proxy, and Better Auth only accepts that origin.
 */
const DEV_PORT = 5173;

export default defineConfig(({ mode }) => {
  // The API's dev script reads PORT from the repo root's .env, so the proxy reads it there too.
  // An empty `PORT=` means the default, as it does for the API (see apps/api/src/env.ts).
  const { PORT } = loadEnv(mode, repoRoot, 'PORT');
  const apiPort = PORT === undefined || PORT === '' ? '3000' : PORT;

  return {
    plugins: [vue()],
    server: {
      port: DEV_PORT,
      strictPort: true,
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
