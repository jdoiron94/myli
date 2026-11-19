import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The API docs page, `api/docs/index.html`: a page of its own next to the app (ADR 0011). Its
 * address is under `/api`, but the web server serves it, not the API.
 */
const API_DOCS_PATH = '/api/docs/';

/** What the dev server sends to the API: everything under `/api` except the docs page. */
const API_PROXY_PATHS = '^/api/(?!docs(/|$))';

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

/**
 * Redirects `/api/docs` to `/api/docs/` in development, as Caddy's file server does for a
 * directory. Without the slash, Vite would answer with the app instead.
 */
function apiDocsRedirect(): Plugin {
  return {
    name: 'myli:api-docs-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const { pathname, search } = new URL(req.url ?? '/', 'http://localhost');
        if (pathname !== API_DOCS_PATH.slice(0, -1)) {
          next();
          return;
        }
        res.statusCode = 308;
        res.setHeader('location', API_DOCS_PATH + search);
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), apiDocsRedirect()],
  // `@/` is `src/`, as in src/tsconfig.json. shadcn-vue's components import through it.
  resolve: { alias: { '@': srcDir } },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: { [API_PROXY_PATHS]: `http://localhost:${apiPort()}` },
  },
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        apiDocs: fileURLToPath(new URL('./api/docs/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Tests leave out stylesheets, except the markdown editor's: ProseMirror checks it sets
    // `white-space`, and warns on every editor without it.
    css: { include: [/prosemirror\.css$/] },
  },
});
