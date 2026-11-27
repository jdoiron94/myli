/**
 * Takes the README's screenshots, into docs/screenshots: `pnpm screenshots`. Run it again when the
 * pages they show change.
 *
 * It seeds the demo accounts and recipes into a database of its own, deleted afterwards, then
 * starts the API and the web app's dev server on free ports, signs in as the demo admin, and opens
 * each page in Chromium. Like the end-to-end runs, it passes the API only its own variables, never
 * the shell's or the repo's `.env`, and touches no other database. Search isn't running, so no page
 * shown needs it.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type APIRequestContext,
  type Browser,
  chromium,
  devices,
  type Page,
} from '@playwright/test';

const root = join(import.meta.dirname, '..');
const out = join(root, 'docs/screenshots');

/** A port nothing listens on: opened, then closed again. */
async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Resolves once `url` answers 200, or throws after a minute. */
async function ready(url: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await fetch(url).then(
      (res) => res.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} didn't answer within a minute`);
}

interface Running {
  child: ChildProcess;
  exited: Promise<unknown>;
}

/** Starts `command` in a process group of its own, so stopping it stops what it starts too. */
function start(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = root): Running {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  return { child, exited: once(child, 'exit') };
}

function stop({ child }: Running) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // The group is gone already.
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'myli-screenshots-'));
const [apiPort, webPort, noMeilisearch] = await Promise.all([freePort(), freePort(), freePort()]);
const publicUrl = `http://localhost:${String(webPort)}`;
const apiEnv = {
  PATH: process.env.PATH,
  // Turns off Better Auth's rate limiter, which counts every sign-in below.
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(apiPort),
  PUBLIC_URL: publicUrl,
  DATABASE_PATH: join(dataDir, 'myli.db'),
  BLOB_DIR: join(dataDir, 'blobs'),
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  MEILI_URL: `http://127.0.0.1:${String(noMeilisearch)}`,
  MEILI_MASTER_KEY: randomBytes(32).toString('base64'),
  LOG_LEVEL: 'error',
};

const running: Running[] = [];
let browser: Browser | undefined;
try {
  const seeded = execFileSync(process.execPath, [join(root, 'apps/api/src/seed-demo.ts')], {
    env: apiEnv,
    encoding: 'utf8',
  });
  const [, email = '', password = ''] = /^\s+admin\s+(\S+)\s+(\S+)$/m.exec(seeded) ?? [];

  running.push(start(process.execPath, [join(root, 'apps/api/src/main.ts')], apiEnv));
  // The dev server sends /api to the API on PORT (apps/web/vite.config.ts).
  const web = join(root, 'apps/web');
  running.push(
    start(
      join(web, 'node_modules/.bin/vite'),
      ['--port', String(webPort), '--strictPort'],
      { ...process.env, PORT: String(apiPort) },
      web,
    ),
  );
  await Promise.all([ready(`http://127.0.0.1:${String(apiPort)}/healthz`), ready(publicUrl)]);

  const launched = await chromium.launch();
  browser = launched;
  /** A browser context signed in as the demo admin, as `device` and in `colorScheme`. */
  const signedIn = async (
    device: (typeof devices)[string],
    colorScheme: 'light' | 'dark',
  ): Promise<{ page: Page; api: APIRequestContext }> => {
    const context = await launched.newContext({
      ...device,
      colorScheme,
      baseURL: publicUrl,
    });
    // Headless Chromium refuses to keep the screen on, which cook mode would say: as on a phone,
    // the lock is granted.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: () =>
            Promise.resolve(
              Object.assign(new EventTarget(), {
                released: false,
                type: 'screen',
                onrelease: null,
                release: () => Promise.resolve(),
              }),
            ),
        },
      });
    });
    const signIn = await context.request.post('/api/auth/sign-in/email', {
      headers: { Origin: publicUrl },
      data: { email, password },
    });
    if (!signIn.ok()) throw new Error(`signing in failed: ${String(signIn.status())}`);
    return { page: await context.newPage(), api: context.request };
  };
  const desktop = await signedIn(
    { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    'light',
  );

  const recipes: { id: string; title: string }[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const list = (await (await desktop.api.get(`/api/v1/recipes?page=${String(page)}`)).json()) as {
      recipes: { id: string; title: string }[];
      totalPages: number;
    };
    recipes.push(...list.recipes);
    pages = list.totalPages;
  }
  const idOf = (title: string) => {
    const found = recipes.find((recipe) => recipe.title === title);
    if (!found) throw new Error(`no demo recipe called ${title}`);
    return found.id;
  };

  // A collection for its grocery list, as someone would make it.
  const collection = (await (
    await desktop.api.post('/api/v1/collections', { data: { name: 'Weeknight dinners' } })
  ).json()) as { id: string };
  for (const title of ['Weeknight Chickpea Curry', 'Black Bean Tacos', 'Thai Peanut Noodles']) {
    const added = await desktop.api.put(
      `/api/v1/collections/${collection.id}/recipes/${idOf(title)}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!added.ok()) throw new Error(`adding ${title} failed: ${String(added.status())}`);
  }

  /** Opens `path`, waits for its heading and for what it loads, and saves the screenshot. */
  const take = async ({ page }: { page: Page }, path: string, heading: string, name: string) => {
    await page.goto(path);
    await page.getByRole('heading', { level: 1, name: heading }).waitFor();
    await page.waitForLoadState('networkidle');
    // The layout moves focus to the heading, whose outline would show.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({ path: join(out, `${name}.png`) });
    process.stdout.write(`Saved docs/screenshots/${name}.png\n`);
  };

  mkdirSync(out, { recursive: true });
  await take(desktop, '/', 'Recipes', 'home');
  await take(desktop, `/recipes/${idOf('Grandma’s Apple Pie')}`, 'Grandma’s Apple Pie', 'recipe');
  await take(desktop, `/collections/${collection.id}/groceries`, 'Grocery list', 'grocery-list');
  const phone = await signedIn(devices['Pixel 7'], 'dark');
  await take(
    phone,
    `/recipes/${idOf('Weeknight Chickpea Curry')}/cook`,
    'Weeknight Chickpea Curry',
    'cook-mode',
  );
} finally {
  await browser?.close();
  for (const each of running) stop(each);
  await Promise.all(running.map(({ exited }) => exited));
  rmSync(dataDir, { recursive: true, force: true });
}
