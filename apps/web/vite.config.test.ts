// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The dev server and the build each start and stop within their own `describe`, one after the
// other: @vitejs/plugin-vue caches compiled components for the whole process, so a build running
// next to a dev server can pick up the dev server's copy and fail.

describe('the dev server', () => {
  let api: Server;
  let vite: ViteDevServer;
  let origin: string;
  const get = (path: string) => fetch(origin + path, { redirect: 'manual' });

  beforeAll(async () => {
    // Stands in for the API: answers every request with the path it reached.
    api = createHttpServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ reachedApi: req.url }));
    });
    await new Promise<void>((resolve) => api.listen(0, resolve));
    vi.stubEnv('PORT', String((api.address() as AddressInfo).port));

    vite = await createServer({
      // As `pnpm dev` runs it, from apps/web.
      root: import.meta.dirname,
      configFile: join(import.meta.dirname, 'vite.config.ts'),
      // No compiling ahead of requests: only the HTML pages are fetched here.
      server: { port: 0, ws: false, preTransformRequests: false },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    });
    await vite.listen();
    origin = `http://localhost:${String((vite.httpServer?.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await vite.close();
    await new Promise((resolve) => api.close(resolve));
    vi.unstubAllEnvs();
  });

  it('sends the API’s routes to the API', async () => {
    const paths = ['/api/v1/setup', '/api/v1/openapi.json', '/api/auth/get-session'];
    const reached = await Promise.all(paths.map(async (path) => (await get(path)).json()));

    expect(reached).toEqual(paths.map((path) => ({ reachedApi: path })));
  });

  it('serves the API docs page itself, at /api/docs/', async () => {
    const response = await get('/api/docs/');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<script type="module" src="/src/api-docs/main.ts">');
  });

  it('redirects /api/docs to /api/docs/, keeping the query, as Caddy does', async () => {
    const response = await get('/api/docs?x=1');

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/api/docs/?x=1');
  });

  it('serves the app everywhere else', async () => {
    const html = await (await get('/recipes/1')).text();

    expect(html).toContain('<script type="module" src="/src/main.ts">');
  });
});

describe('the build', () => {
  let outDir: string;
  const read = (path: string) => readFileSync(join(outDir, path), 'utf8');

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'myli-web-build-'));
    await build({
      root: import.meta.dirname,
      configFile: join(import.meta.dirname, 'vite.config.ts'),
      // The manifest says which chunks each one imports.
      build: { outDir, emptyOutDir: true, manifest: true },
      logLevel: 'silent',
    });
  }, 60_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('makes the API docs a page of its own, at api/docs/', () => {
    expect(read('api/docs/index.html')).toContain('<title>API docs · myli</title>');
  });

  it('keeps Scalar out of everything the app loads (ADR 0011)', () => {
    const appHtml = read('index.html');
    const files = [...appHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(
      ([, file]) => file,
    );

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(read(file ?? ''), file).not.toMatch(/scalar/i);
  });

  describe('the markdown editor (ADR 0014)', () => {
    interface Chunk {
      file: string;
      imports?: string[];
      dynamicImports?: string[];
      isDynamicEntry?: boolean;
    }
    const manifest = () => JSON.parse(read('.vite/manifest.json')) as Record<string, Chunk>;

    /** The files loading `entry` loads: its own, then its imports', all the way down. */
    function filesLoadedWith(entry: string, chunks: Record<string, Chunk>): string[] {
      const seen = new Set<string>();
      const visit = (key: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        for (const imported of chunks[key]?.imports ?? []) visit(imported);
      };
      visit(entry);
      return [...seen].map((key) => chunks[key]?.file ?? key);
    }

    // Cook mode joins these once it exists.
    it('is left out of what the app and the pages that only show recipes load', () => {
      const chunks = manifest();
      const loaded = ['index.html', 'src/pages/HomePage.vue', 'src/pages/RecipePage.vue'].map(
        (entry) => filesLoadedWith(entry, chunks),
      );

      expect(loaded.every((files) => files.length > 0)).toBe(true);
      expect(loaded.flat().filter((file) => /prosemirror/i.test(read(file)))).toEqual([]);
    });

    it('is loaded by the pages that edit a recipe, when they ask for it', () => {
      const chunks = manifest();

      expect(chunks['src/components/MarkdownEditor.vue']?.isDynamicEntry).toBe(true);
      expect(
        filesLoadedWith('src/components/MarkdownEditor.vue', chunks).some((file) =>
          /prosemirror/i.test(read(file)),
        ),
      ).toBe(true);
      for (const page of ['src/pages/NewRecipePage.vue', 'src/pages/EditRecipePage.vue']) {
        const loaded = filesLoadedWith(page, chunks);
        for (const file of loaded) expect(read(file), file).not.toMatch(/prosemirror/i);
        const asked = Object.entries(chunks)
          .filter(([, chunk]) => loaded.includes(chunk.file))
          .flatMap(([, chunk]) => chunk.dynamicImports ?? []);
        expect(asked, page).toContain('src/components/MarkdownEditor.vue');
      }
    });
  });
});
