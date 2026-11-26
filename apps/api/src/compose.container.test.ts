// Checks compose.yaml as Docker Compose reads it: `pnpm test:containers`. Needs only the docker CLI.
// The end-to-end tests against the images run the stack itself (e2e/start-compose.ts).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GARAGE_CONFIG, GARAGE_IMAGE } from './blobs/testing.ts';
import { envSchema, FILE_VARIABLES } from './env.ts';
import { MEILISEARCH_IMAGE } from './search/testing.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface Service {
  image: string;
  command?: string[];
  depends_on?: Record<string, { condition: string; required: boolean }>;
  build?: { context: string; dockerfile: string };
  environment?: Record<string, string>;
  secrets?: { source: string; target: string; mode?: number | string }[];
  configs?: { source: string; target: string }[];
  ports?: { target: number; published: string; protocol: string; host_ip?: string }[];
  networks?: Record<string, unknown>;
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean | null;
}

interface ComposeConfig {
  name: string;
  services: Record<string, Service>;
  networks: Record<string, { ipam: { config?: { subnet: string }[] } }>;
  secrets: Record<string, { environment: string }>;
  configs: Record<string, { content: string }>;
}

/** The variables compose.yaml needs before Compose will read it at all. */
const REQUIRED = {
  PUBLIC_URL: 'https://myli.example',
  BETTER_AUTH_SECRET: 'better-auth-secret',
  MEILI_MASTER_KEY: 'meili-master-key',
};

/**
 * compose.yaml as Compose resolves it, with the dev and s3 profiles and any `overrides` on top, given
 * only `variables`: not the shell's, nor the repo's .env.
 */
function composeConfig(variables: Record<string, string> = {}, overrides: string[] = []) {
  const files = ['compose.yaml', ...overrides].flatMap((file) => ['--file', file]);
  const json = execFileSync(
    'docker',
    [
      'compose',
      ...files,
      '--env-file',
      '/dev/null',
      '--profile',
      'dev',
      '--profile',
      's3',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...REQUIRED, ...variables },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(json) as ComposeConfig;
}

/** A service that compose.yaml defines. */
function service(config: ComposeConfig, name: string): Service {
  const found = config.services[name];
  if (!found) throw new Error(`compose.yaml has no ${name} service`);
  return found;
}

/** The secret's name in compose.yaml, and its file in the container. */
const secretName = (variable: string) => variable.toLowerCase();

describe("the API's configuration", () => {
  // The API image sets these (apps/api/Dockerfile).
  const setByImage = ['NODE_ENV', 'HOST', 'PORT', 'DATABASE_PATH', 'BLOB_DIR', 'BACKUP_DIR'];
  // compose.yaml sets these itself.
  const setByCompose = ['MEILI_URL', 'TRUSTED_PROXIES'];
  // Everything else, a new variable included, has to be passed through or come from a file.
  const passedThrough = Object.keys(envSchema.shape).filter(
    (name) => ![...setByImage, ...setByCompose, ...FILE_VARIABLES].includes(name),
  );

  it('passes the API every variable it reads, unless the image or compose.yaml sets it', () => {
    const values = Object.fromEntries(passedThrough.map((name) => [name, `value of ${name}`]));
    const { environment = {} } = service(composeConfig(values), 'api');

    for (const name of passedThrough) expect(environment[name], name).toBe(`value of ${name}`);
    expect(Object.keys(environment).sort()).toEqual(
      [
        ...passedThrough,
        ...setByCompose,
        ...FILE_VARIABLES.map((secret) => `${secret}_FILE`),
      ].sort(),
    );
    expect(environment.MEILI_URL).toBe('http://meilisearch:7700');
  });

  it('gives the API each secret as a file, named only when the secret is set', () => {
    const everySecret = Object.fromEntries(FILE_VARIABLES.map((name) => [name, `secret ${name}`]));
    const config = composeConfig(everySecret);
    const api = service(config, 'api');

    for (const name of FILE_VARIABLES) {
      const file = `/run/secrets/${secretName(name)}`;
      expect(api.environment?.[`${name}_FILE`], name).toBe(file);
      expect(api.secrets).toContainEqual({ source: secretName(name), target: file });
      expect(config.secrets[secretName(name)]).toEqual(
        expect.objectContaining({ environment: name }),
      );
      // Never the secret itself.
      expect(api.environment?.[name], name).toBeUndefined();
    }

    // Empty: so is NAME_FILE, which counts as unset, whether Compose leaves the file out (Compose 5)
    // or mounts it empty (older versions).
    const none = Object.fromEntries(FILE_VARIABLES.map((name) => [name, '']));
    const { environment = {} } = service(composeConfig(none), 'api');
    for (const name of FILE_VARIABLES) expect(environment[`${name}_FILE`], name).toBe('');
  });

  it('trusts X-Forwarded-For only from the proxy network, which only Caddy and the API are on', () => {
    const config = composeConfig({ MYLI_PROXY_SUBNET: '10.99.0.0/29' });

    expect(config.networks.proxy?.ipam.config).toEqual([{ subnet: '10.99.0.0/29' }]);
    expect(service(config, 'api').environment?.TRUSTED_PROXIES).toBe('10.99.0.0/29');
    const onProxy = Object.entries(config.services)
      .filter(([, { networks = {} }]) => 'proxy' in networks)
      .map(([name]) => name);
    expect(onProxy.sort()).toEqual(['api', 'caddy']);
  });
});

describe('the services', () => {
  it('run the same Meilisearch as the container tests', () => {
    expect(service(composeConfig(), 'meilisearch').image).toBe(MEILISEARCH_IMAGE);
  });

  it('run the same Garage as the container tests, set up before the API starts, with the s3 profile', () => {
    const config = composeConfig({
      S3_SECRET_ACCESS_KEY: 's3 secret',
      MYLI_GARAGE_RPC_SECRET: 'rpc secret',
      MYLI_GARAGE_ADMIN_TOKEN: 'admin token',
    });
    const garage = service(config, 'garage');
    const init = service(config, 'garage-init');

    expect(garage.image).toBe(GARAGE_IMAGE);
    expect(garage.configs).toEqual([{ source: 'garage', target: '/etc/garage.toml' }]);
    expect(config.configs.garage?.content).toBe(GARAGE_CONFIG);
    // Only root may read them, or Garage refuses to start. Compose 5 writes the mode as octal text.
    const modes = (garage.secrets ?? []).map(({ source, mode }) => ({
      source,
      mode: typeof mode === 'string' ? Number.parseInt(mode, 8) : mode,
    }));
    expect(modes).toEqual([
      { source: 'myli_garage_rpc_secret', mode: 0o400 },
      { source: 'myli_garage_admin_token', mode: 0o400 },
    ]);
    expect(garage.environment).toEqual({
      GARAGE_RPC_SECRET_FILE: '/run/secrets/myli_garage_rpc_secret',
      GARAGE_ADMIN_TOKEN_FILE: '/run/secrets/myli_garage_admin_token',
    });
    expect(config.secrets.myli_garage_admin_token).toEqual(
      expect.objectContaining({ environment: 'MYLI_GARAGE_ADMIN_TOKEN' }),
    );

    expect(init.image).toBe(service(config, 'api').image);
    expect(init.command).toEqual(['node', 'src/set-up-garage.ts']);
    expect(init.environment).toEqual(
      expect.objectContaining({
        GARAGE_ADMIN_URL: 'http://garage:3903',
        GARAGE_ADMIN_TOKEN_FILE: '/run/secrets/myli_garage_admin_token',
        S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/s3_secret_access_key',
      }),
    );
    expect(init.depends_on).toEqual({
      garage: expect.objectContaining({ condition: 'service_healthy' }),
    });
    // Without the profile, the API starts without it.
    expect(service(config, 'api').depends_on?.['garage-init']).toEqual(
      expect.objectContaining({ condition: 'service_completed_successfully', required: false }),
    );
  });

  it("take myli's images from MYLI_IMAGE_PREFIX at MYLI_VERSION, or build them here", () => {
    const local = composeConfig();
    expect(service(local, 'api').image).toBe('myli-api:latest');
    expect(service(local, 'caddy').image).toBe('myli-web:latest');
    expect(service(local, 'api').build).toEqual({
      context: REPO_ROOT.replace(/\/$/, ''),
      dockerfile: 'apps/api/Dockerfile',
    });
    expect(service(local, 'caddy').build).toEqual({
      context: REPO_ROOT.replace(/\/$/, ''),
      dockerfile: 'apps/web/Dockerfile',
    });

    const registry = composeConfig({
      MYLI_IMAGE_PREFIX: 'registry.example.com/myli/',
      MYLI_VERSION: '1.2.3',
    });
    expect(service(registry, 'api').image).toBe('registry.example.com/myli/myli-api:1.2.3');
    expect(service(registry, 'caddy').image).toBe('registry.example.com/myli/myli-web:1.2.3');
  });

  it("publish only Caddy's ports, and Mailpit's and pnpm dev:all's Meilisearch on this machine alone", () => {
    const ports = (config: ComposeConfig, name: string) =>
      (service(config, name).ports ?? []).map(
        ({ host_ip, published, target, protocol }) =>
          `${host_ip ? `${host_ip}:` : ''}${published}:${String(target)}/${protocol}`,
      );
    const defaults = composeConfig();

    expect(ports(defaults, 'caddy')).toEqual(['80:80/tcp', '443:443/tcp', '443:443/udp']);
    expect(ports(defaults, 'api')).toEqual([]);
    expect(ports(defaults, 'meilisearch')).toEqual([]);
    expect(ports(defaults, 'garage')).toEqual([]);
    expect(ports(defaults, 'mailpit')).toEqual([
      '127.0.0.1:8025:8025/tcp',
      '127.0.0.1:1025:1025/tcp',
    ]);

    // PUBLIC_URL's port, which Caddy listens on inside the container too.
    const custom = composeConfig({ MYLI_HTTP_PORT: '8080', MYLI_HTTPS_PORT: '8443' });
    expect(ports(custom, 'caddy')).toEqual(['8080:80/tcp', '8443:8443/tcp', '8443:8443/udp']);

    // In a project of its own, so it never takes over the Meilisearch of a stack run from here.
    const dev = composeConfig({}, ['compose.dev.yaml']);
    expect({ name: dev.name, meilisearch: ports(dev, 'meilisearch') }).toEqual({
      name: 'myli-dev',
      meilisearch: ['127.0.0.1:7700:7700/tcp'],
    });
    expect(defaults.name).toBe('myli');
  });

  it('run without Linux capabilities, unable to gain any', () => {
    const { services } = composeConfig();

    expect(Object.keys(services).sort()).toEqual([
      'api',
      'caddy',
      'garage',
      'garage-init',
      'mailpit',
      'meilisearch',
    ]);
    for (const [name, { cap_drop, security_opt }] of Object.entries(services)) {
      expect(cap_drop, name).toEqual(['ALL']);
      expect(security_opt, name).toEqual(['no-new-privileges:true']);
    }
    // The API can't be read-only: Compose copies its secrets into the container.
    expect(service(composeConfig(), 'caddy').read_only).toBe(true);
    expect(service(composeConfig(), 'mailpit').read_only).toBe(true);
  });
});
