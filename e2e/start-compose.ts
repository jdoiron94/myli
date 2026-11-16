/**
 * Starts the Compose stack (compose.yaml, with compose.e2e.yaml on top) for one browser's run
 * against the images (playwright.containers.config.ts), as its own Compose project: Caddy at
 * PUBLIC_URL with its redirect from HTTP on HTTP_PORT, the API and Meilisearch. build-images.ts
 * builds the images first.
 *
 * Compose gets only the variables below, never the shell's or the repo's `.env`, which it would
 * otherwise read: no first admin, so the run starts at first-run setup, and no SMTP, so invitation
 * links are shown. The API's log goes to Playwright's output.
 *
 * When Playwright stops this launcher, it removes the stack, volumes included. If it's killed, or
 * stopped while still starting the stack, the stack is left running; build-images.ts removes it
 * before the next run, and this launcher before starting its own.
 */
import { type SpawnSyncOptions, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { dockerClientEnvironment, IMAGE_TAG } from './images.ts';

const { PROJECT, PUBLIC_URL, HTTP_PORT, PROXY_SUBNET } = process.env;
if (!PROJECT || !PUBLIC_URL || !HTTP_PORT || !PROXY_SUBNET) {
  throw new Error('PROJECT, PUBLIC_URL, HTTP_PORT and PROXY_SUBNET must be set');
}

const repoRoot = join(import.meta.dirname, '..');

const variables = {
  ...dockerClientEnvironment(),
  PUBLIC_URL,
  // Caddy listens on PUBLIC_URL's port inside the container too.
  MYLI_HTTPS_PORT: new URL(PUBLIC_URL).port,
  MYLI_HTTP_PORT: HTTP_PORT,
  // Each browser's stack has its own, since two networks can't share a subnet.
  MYLI_PROXY_SUBNET: PROXY_SUBNET,
  MYLI_VERSION: IMAGE_TAG,
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  MEILI_MASTER_KEY: randomBytes(32).toString('base64'),
  // Listed, as compose.yaml requires, and empty: no first admin, no SMTP.
  ADMIN_PASSWORD: '',
  SMTP_PASSWORD: '',
  LOG_LEVEL: 'warn',
};

const composeArgs = [
  'compose',
  '--project-name',
  PROJECT,
  '--project-directory',
  repoRoot,
  '--file',
  join(repoRoot, 'compose.yaml'),
  '--file',
  join(import.meta.dirname, 'compose.e2e.yaml'),
  // Instead of the repo's .env.
  '--env-file',
  '/dev/null',
  // Errors only.
  '--progress',
  'quiet',
];
const options = { cwd: repoRoot, env: variables } satisfies SpawnSyncOptions;

/** Runs a Compose command to the end, failing if it fails. Its output goes to Playwright's. */
function compose(...args: string[]) {
  const { status } = spawnSync('docker', [...composeArgs, ...args], {
    ...options,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (status !== 0) throw new Error(`docker compose ${args[0] ?? ''} failed`);
}

const down = () => {
  compose('down', '--volumes', '--remove-orphans', '--timeout', '10');
};

down();
// The images were just built, so nothing is built or pulled here, other than Meilisearch the first
// time.
compose('up', '--detach', '--wait', '--wait-timeout', '120', '--no-build');
// Keeps the process alive until Playwright's signal.
const logs = spawn('docker', [...composeArgs, 'logs', '--follow', '--no-log-prefix', 'api'], {
  ...options,
  stdio: ['ignore', 'inherit', 'inherit'],
});

// Playwright stops web servers by signalling their process group (`gracefulShutdown` in
// playwright.containers.config.ts), which ends `logs` too.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logs.kill();
    down();
    process.exit(0);
  });
}
