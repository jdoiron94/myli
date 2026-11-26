// The Compose stack (compose.yaml), as start-compose.ts runs it for each browser. Only the run
// against the images has it: the dev servers' run skips this file (playwright.config.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { composeProject } from '../images.ts';
import { expect, test } from './fixtures.ts';

/** Runs the docker CLI, returning its output. Its warnings are kept out of the test's output. */
const docker = (args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The ID of a service's container in this browser's stack. */
const container = (browserName: string, service: string) =>
  docker(['compose', '--project-name', composeProject(browserName), 'ps', '--quiet', service]);

interface LogEntry {
  level: string | number;
  msg: string;
}

/**
 * A container's log, as the JSON entries Caddy and the API write. `docker logs` passes on each of
 * the container's streams as its own, and Caddy writes to stderr, the API to stdout.
 */
function logEntries(id: string) {
  const { stdout, stderr } = spawnSync('docker', ['logs', id], { encoding: 'utf8' });
  return `${stdout}\n${stderr}`
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as LogEntry);
}

/** Caddy's errors, and pino's (level 50 and above). */
const isError = ({ level }: LogEntry) =>
  level === 'error' || (typeof level === 'number' && level >= 50);

test('starts Caddy and the API without errors, with search ready', async ({ browserName }) => {
  const api = container(browserName, 'api');

  // The API set up search with the master key from its file, so Meilisearch has the same one.
  await expect
    .poll(
      () =>
        docker([
          'exec',
          api,
          'node',
          '-e',
          'fetch("http://127.0.0.1:3000/readyz").then((res) => console.log(res.status))',
        ]),
      { timeout: 30_000 },
    )
    .toBe('200');
  // Caddy runs read-only: it would log an error if it tried to write outside /data.
  const caddyLog = logEntries(container(browserName, 'caddy'));
  expect(caddyLog.map(({ msg }) => msg)).toContain('serving initial configuration');
  expect(caddyLog.filter(isError)).toEqual([]);
  expect(logEntries(api).filter(isError)).toEqual([]);
});

test('sets up Garage before the API starts, with the s3 profile', ({ browserName, blobStore }) => {
  test.skip(blobStore !== 's3', 'Only Firefox’s stack keeps photos in Garage.');
  const init = docker([
    'compose',
    '--project-name',
    composeProject(browserName),
    'ps',
    '--all',
    '--format',
    '{{.State}} {{.ExitCode}}',
    'garage-init',
  ]);

  // Before the API, which waited for it (compose.yaml).
  expect(init).toBe('exited 0');
});

test("keeps Meilisearch out of Caddy's reach", ({ browserName }) => {
  const fromCaddy = spawnSync(
    'docker',
    [
      'exec',
      container(browserName, 'caddy'),
      'wget',
      '-q',
      '-T',
      '5',
      '-O',
      '/dev/null',
      'http://meilisearch:7700/health',
    ],
    { encoding: 'utf8' },
  );

  expect(fromCaddy.status).toBe(1);
  // Not on its networks, so the name doesn't even resolve.
  expect(fromCaddy.stderr).toContain("bad address 'meilisearch:7700'");
});

test('gives the API its secrets as files, never in its environment', ({
  browserName,
  blobStore,
}) => {
  const api = container(browserName, 'api');
  const environment = docker(['exec', api, 'env']).split('\n');
  // Only the stack that keeps photos in Garage has the bucket's key.
  const s3 = blobStore === 's3';

  expect(environment).toEqual(
    expect.arrayContaining([
      'BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret',
      'MEILI_MASTER_KEY_FILE=/run/secrets/meili_master_key',
      `S3_SECRET_ACCESS_KEY_FILE=${s3 ? '/run/secrets/s3_secret_access_key' : ''}`,
      // Empty, so not set: there's no first admin and no SMTP.
      'ADMIN_PASSWORD_FILE=',
      'SMTP_PASSWORD_FILE=',
    ]),
  );
  const secrets =
    /^(BETTER_AUTH_SECRET|MEILI_MASTER_KEY|ADMIN_PASSWORD|SMTP_PASSWORD|S3_SECRET_ACCESS_KEY)=/;
  expect(environment.filter((line) => secrets.test(line))).toEqual([]);

  // Each secret file's name and size. The image has Node, and not necessarily a shell.
  const files = Object.fromEntries(
    docker([
      'exec',
      api,
      'node',
      '-e',
      "for (const f of require('fs').readdirSync('/run/secrets')) console.log(f, require('fs').statSync('/run/secrets/' + f).size)",
    ])
      .split('\n')
      .map((line) => line.split(' '))
      .map(([name = '', size]) => [name, Number(size)]),
  );
  const read = ['better_auth_secret', 'meili_master_key', ...(s3 ? ['s3_secret_access_key'] : [])];
  for (const name of read) expect(files[name], name).toBeGreaterThan(0);
  // The others are empty. Compose 5 doesn't mount an empty secret; older versions, like the 2.38 on
  // GitHub's runners, mount an empty file. Either way, the API never reads it: its NAME_FILE is empty.
  const unread = Object.keys(files).filter((name) => !read.includes(name));
  expect(['admin_password', 'smtp_password', 's3_secret_access_key']).toEqual(
    expect.arrayContaining(unread),
  );
  for (const name of unread) expect(files[name], name).toBe(0);

  // Meilisearch reads its key from the file as it starts, so it isn't in its configuration either.
  const meilisearch = docker([
    'inspect',
    '--format',
    '{{json .Config.Env}}',
    container(browserName, 'meilisearch'),
  ]);
  expect(meilisearch).not.toContain('MEILI_MASTER_KEY');
});
