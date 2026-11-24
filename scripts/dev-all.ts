// `pnpm dev:all`: the whole app on this machine. Starts Meilisearch from compose.yaml, with
// compose.dev.yaml on top, waits until it's healthy, then runs `pnpm dev` against it. Once the dev
// servers stop, it stops Meilisearch too, keeping its index for next time.
import { type SpawnSyncOptions, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
/** Where compose.dev.yaml publishes Meilisearch. */
const MEILI_URL = 'http://127.0.0.1:7700';

function fail(message: string): never {
  process.stderr.write(`dev:all: ${message}\n`);
  process.exit(1);
}

/** Runs a Docker Compose command on the dev project, and exits if it fails. */
function compose(...args: string[]) {
  const options: SpawnSyncOptions = { cwd: root, stdio: 'inherit' };
  const files = ['--file', 'compose.yaml', '--file', 'compose.dev.yaml'];
  const { error, status } = spawnSync('docker', ['compose', ...files, ...args], options);
  if (error) fail(`couldn't run docker (${error.message}). Meilisearch runs in Docker.`);
  if (status !== 0) fail(`docker compose ${args.join(' ')} failed.`);
}

// Compose reads .env too, and gives Meilisearch the same master key the API reads from it.
const envFile = `${root}.env`;
if (!existsSync(envFile)) {
  fail('copy .env.example to .env and set what it says is required (README, "Development").');
}
if (!(process.env.MEILI_MASTER_KEY ?? parseEnv(readFileSync(envFile, 'utf8')).MEILI_MASTER_KEY)) {
  fail('set MEILI_MASTER_KEY in .env: Meilisearch starts with it, and the API uses it.');
}

compose('up', '--detach', '--wait', 'meilisearch');

// The API reads .env too, but the address it reaches Meilisearch at is the one published here.
const dev = spawn('pnpm', ['dev'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MEILI_URL },
});
// Ctrl-C reaches the dev servers straight from the terminal: wait for them to stop. Anything else
// that stops this process stops them first.
process.on('SIGINT', () => undefined);
process.on('SIGTERM', () => dev.kill('SIGTERM'));

dev.on('error', (error) => {
  compose('stop', 'meilisearch');
  fail(`couldn't run pnpm dev (${error.message}).`);
});
dev.on('exit', (code) => {
  compose('stop', 'meilisearch');
  process.exit(code ?? 0);
});
