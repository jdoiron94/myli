import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The dev server's port. `PUBLIC_URL` must be `http://localhost:5173` in development: the browser
 * reaches the API through this server's proxy, and Better Auth only accepts that origin.
 */
const DEV_PORT = 5173;

/**
 * The port the API listens on in development, found the way the API's dev script finds it: the
 * environment first, then the repo root's `.env`. An empty `PORT=` means the default, as it does
 * for the API (see apps/api/src/env.ts). Only `PORT` is read, so the `NODE_ENV` in `.env` can't
 * change how Vite builds.
 */
function apiPort() {
  const envFile = new URL('../../.env', import.meta.url);
  const port =
    process.env.PORT ??
    (existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).PORT : undefined);
  return port === undefined || port === '' ? '3000' : port;
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // `@/` is `src/`, as in src/tsconfig.json. shadcn-vue's components import through it.
  resolve: { alias: { '@': srcDir } },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: { '/api': `http://localhost:${apiPort()}` },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
