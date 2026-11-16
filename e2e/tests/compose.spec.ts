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

test('gives the API its secrets as files, never in its environment', ({ browserName }) => {
  const api = container(browserName, 'api');
  const environment = docker(['exec', api, 'env']).split('\n');

  expect(environment).toEqual(
    expect.arrayContaining([
      'BETTER_AUTH_SECRET_FILE=/run/secrets/better_auth_secret',
      'MEILI_MASTER_KEY_FILE=/run/secrets/meili_master_key',
      // Empty, so not set: there's no first admin and no SMTP.
      'ADMIN_PASSWORD_FILE=',
      'SMTP_PASSWORD_FILE=',
    ]),
  );
  const secrets = /^(BETTER_AUTH_SECRET|MEILI_MASTER_KEY|ADMIN_PASSWORD|SMTP_PASSWORD)=/;
  expect(environment.filter((line) => secrets.test(line))).toEqual([]);
  expect(docker(['exec', api, 'ls', '/run/secrets']).split('\n')).toEqual([
    'better_auth_secret',
    'meili_master_key',
  ]);

  // Meilisearch reads its key from the file as it starts, so it isn't in its configuration either.
  const meilisearch = docker([
    'inspect',
    '--format',
    '{{json .Config.Env}}',
    container(browserName, 'meilisearch'),
  ]);
  expect(meilisearch).not.toContain('MEILI_MASTER_KEY');
});
