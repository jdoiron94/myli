// Builds the API's Docker image and runs it: `pnpm test:containers`, with Docker running.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MEILI_MASTER_KEY, meilisearchContainer } from './search/testing.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IMAGE = 'myli-api:container-test';

/** Runs a Docker command from the repo root. Its output, build progress included, is captured. */
const docker = (args: string[], input?: string) =>
  execFileSync('docker', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

describe('the build context', () => {
  it('leaves out secrets, local data and installed packages', () => {
    // Exports exactly what a build from the repo root receives.
    const context = mkdtempSync(join(tmpdir(), 'myli-context-'));
    try {
      docker(
        ['build', '--file', '-', '--output', `type=local,dest=${context}`, '.'],
        'FROM scratch\nCOPY . /\n',
      );

      expect(existsSync(join(context, 'apps/api/src/main.ts'))).toBe(true);
      expect(existsSync(join(context, '.env.example'))).toBe(true);
      const files = readdirSync(context, { recursive: true, encoding: 'utf8' });
      const unwanted = files.filter((file) =>
        /(^|\/)(\.env(\..*)?|node_modules|\.git|[^/]+\.db(-shm|-wal)?|[^/]+\.test\.ts)$/.test(file),
      );
      expect(unwanted.filter((file) => file !== '.env.example')).toEqual([]);
      expect(files.filter((file) => file.startsWith('apps/api/data'))).toEqual([]);
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  });
});

describe('the API image', () => {
  let network: StartedNetwork;
  let meilisearch: StartedTestContainer;
  let api: StartedTestContainer;
  let apiUrl: string;

  beforeAll(async () => {
    docker(['build', '--file', 'apps/api/Dockerfile', '--tag', IMAGE, '.']);
    network = await new Network().start();
    meilisearch = await meilisearchContainer()
      .withNetwork(network)
      .withNetworkAliases('meilisearch')
      .start();
    // Only the variables without a default: the image sets the rest.
    api = await new GenericContainer(IMAGE)
      .withNetwork(network)
      .withEnvironment({
        PUBLIC_URL: 'http://127.0.0.1',
        BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
        MEILI_URL: 'http://meilisearch:7700',
        MEILI_MASTER_KEY,
      })
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHealthCheck())
      .start();
    apiUrl = `http://${api.getHost()}:${String(api.getMappedPort(3000))}`;
  });

  afterAll(async () => {
    await meilisearch.stop();
    await network.stop();
    docker(['image', 'rm', IMAGE]);
  });

  it('describes itself for its page in GHCR, which it links to the repository', () => {
    const labels = JSON.parse(
      docker(['image', 'inspect', '--format', '{{json .Config.Labels}}', IMAGE]),
    ) as Record<string, string>;
    const { license } = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      license: string;
    };

    expect(labels).toEqual({
      'org.opencontainers.image.title': 'myli API',
      'org.opencontainers.image.description': 'The API of myli, a self-hosted recipe app',
      'org.opencontainers.image.source': 'https://github.com/jdoiron94/myli',
      'org.opencontainers.image.url': 'https://github.com/jdoiron94/myli',
      'org.opencontainers.image.documentation': 'https://github.com/jdoiron94/myli',
      'org.opencontainers.image.licenses': license,
    });
  });

  it('runs as the unprivileged node user', async () => {
    expect(docker(['image', 'inspect', '--format', '{{.Config.User}}', IMAGE]).trim()).toBe('node');
    expect((await api.exec(['id', '-u'])).output.trim()).toBe('1000');
  });

  it('becomes healthy, keeps its database on /data, and sets up search', async () => {
    // The image's healthcheck passed before the container counted as started.
    expect((await fetch(`${apiUrl}/healthz`)).status).toBe(200);
    await vi.waitFor(
      async () => {
        expect((await fetch(`${apiUrl}/readyz`)).status).toBe(200);
      },
      { timeout: 30_000, interval: 250 },
    );

    const { output } = await api.exec(['stat', '--format', '%U %n', '/data/myli.db']);
    expect(output.trim()).toBe('node /data/myli.db');
  });

  it('holds the source and production dependencies, and no secrets, tests or local data', async () => {
    const { output: stray } = await api.exec([
      'find',
      '/app',
      '-path',
      '*/node_modules',
      '-prune',
      '-o',
      '(',
      '-name',
      '.env*',
      '-o',
      '-name',
      '*.test.ts',
      '-o',
      '-name',
      '*.db',
      ')',
      '-print',
    ]);
    expect(stray.trim()).toBe('');

    const { output: packages } = await api.exec(['ls', '/app/node_modules/.pnpm']);
    const installed = packages.trim().split('\n');
    expect(installed).toContainEqual(expect.stringMatching(/^better-sqlite3@/));
    for (const devOnly of [
      'vitest',
      'testcontainers',
      'drizzle-kit',
      'typescript',
      'pino-pretty',
    ]) {
      expect(installed.filter((name) => name.startsWith(`${devOnly}@`))).toEqual([]);
    }
  });

  it('runs the demo seed script, which prints the accounts it created', async () => {
    const { exitCode, stdout, stderr } = await api.exec(['node', 'src/seed-demo.ts']);

    expect(exitCode).toBe(0);
    for (const role of ['admin', 'editor', 'viewer']) {
      expect(stdout).toContain(`${role}@example.com`);
    }
    // Its log goes to stderr, so stdout holds only the accounts.
    expect(stdout).not.toContain('"level"');
    expect(stderr).toContain('"msg":"demo accounts created"');
  });

  it('shuts down cleanly when Docker stops it', async () => {
    const id = api.getId();
    await api.stop({ timeout: 10_000, remove: false });

    expect(docker(['inspect', '--format', '{{.State.ExitCode}}', id]).trim()).toBe('0');
    const logs = docker(['logs', id])
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { level: number; msg: string });
    expect(logs.at(-1)?.msg).toBe('shutting down');
    expect(logs.filter((line) => line.level >= 50)).toEqual([]);
    docker(['rm', id]);
  });
});
