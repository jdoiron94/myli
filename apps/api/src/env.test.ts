import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { EnvError, envSchema, FILE_VARIABLES, loadEnv } from './env.ts';

function loadEnvError(source: Record<string, string>): EnvError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error('expected loadEnv to throw');
}

/** Valid values for the variables that have no default. */
const REQUIRED = {
  PUBLIC_URL: 'https://myli.example',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-chars',
  MEILI_MASTER_KEY: 'a-test-master-key',
};

describe('loadEnv', () => {
  it('reads and converts what is set, treating empty as unset and dropping what it doesn’t know', () => {
    expect(
      loadEnv({
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '8080',
        LOG_LEVEL: '',
        DATABASE_PATH: '/data/myli.db',
        BLOB_DIR: '/data/blobs',
        PUBLIC_URL: 'http://localhost:5173',
        BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
        MEILI_URL: 'http://meilisearch:7700',
        MEILI_MASTER_KEY: REQUIRED.MEILI_MASTER_KEY,
        TRUSTED_PROXIES: '172.18.0.2, 10.0.0.0/8,,fd00::/8 ',
        INVITATION_TTL_DAYS: '14',
        PATH: '/usr/bin',
      }),
    ).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 8080,
      LOG_LEVEL: 'info',
      DATABASE_PATH: '/data/myli.db',
      BLOB_DIR: '/data/blobs',
      PUBLIC_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
      MEILI_URL: 'http://meilisearch:7700',
      MEILI_MASTER_KEY: REQUIRED.MEILI_MASTER_KEY,
      TRUSTED_PROXIES: [
        { address: '172.18.0.2', prefix: 32, family: 'ipv4' },
        { address: '10.0.0.0', prefix: 8, family: 'ipv4' },
        { address: 'fd00::', prefix: 8, family: 'ipv6' },
      ],
      INVITATION_TTL_DAYS: 14,
      SMTP_SECURITY: 'starttls',
    });
  });

  it('reduces PUBLIC_URL to its origin, refusing one with a path or query', () => {
    expect(loadEnv({ ...REQUIRED, PUBLIC_URL: 'https://Myli.Example:8443/' }).PUBLIC_URL).toBe(
      'https://myli.example:8443',
    );
    for (const url of [
      'myli.example',
      'https://myli.example/recipes',
      'https://myli.example/?x=1',
    ]) {
      expect(loadEnvError({ ...REQUIRED, PUBLIC_URL: url }).message, url).toMatch(
        /^\s+PUBLIC_URL: /m,
      );
    }
  });

  it('names each TRUSTED_PROXIES entry that is not an address or range, without echoing it', () => {
    const error = loadEnvError({
      ...REQUIRED,
      TRUSTED_PROXIES: '172.18.0.2,caddy,10.0.0.0/33,::1/129,1.2.3.4/8/8,172.18.0.0/ 16',
    });

    expect(error.message.split('\n').slice(1)).toEqual(
      [2, 3, 4, 5, 6].map(
        (entry) =>
          `  TRUSTED_PROXIES: entry ${String(entry)} is not an IP address or CIDR range, like 172.18.0.2 or 172.18.0.0/16`,
      ),
    );
    expect(error.message).not.toContain('caddy');
  });

  it('lists every missing or invalid variable in one error, never echoing a value', () => {
    const { message } = loadEnvError({
      PUBLIC_URL: '',
      BETTER_AUTH_SECRET: 'too-short-hunter2',
      MEILI_MASTER_KEY: 'short-hunter3',
      PORT: 'hunter4',
      NODE_ENV: 'staging',
    });

    expect(message).toMatch(/^Invalid environment configuration:/);
    expect(message).toMatch(/^\s+PUBLIC_URL: is required$/m);
    expect(message).toMatch(/^\s+BETTER_AUTH_SECRET: must be at least 32 characters/m);
    expect(message).toMatch(/^\s+MEILI_MASTER_KEY: must be at least 16 characters/m);
    expect(message).toMatch(/^\s+PORT: /m);
    expect(message).toMatch(/^\s+NODE_ENV: /m);
    expect(message).not.toMatch(/hunter|staging/);
  });
});

describe('the first admin variables', () => {
  const ADMIN = {
    ADMIN_NAME: '  Ada Lovelace ',
    ADMIN_EMAIL: 'Ada@Example.com',
    ADMIN_PASSWORD: 'Correct horse battery 9',
  };
  const ALL_THREE_OR_NONE =
    'is required when any of ADMIN_NAME, ADMIN_EMAIL or ADMIN_PASSWORD is set';

  it('are read together, with the name trimmed and the email lowercased', () => {
    expect(loadEnv({ ...REQUIRED, ...ADMIN })).toMatchObject({
      ADMIN_NAME: 'Ada Lovelace',
      ADMIN_EMAIL: 'ada@example.com',
      ADMIN_PASSWORD: 'Correct horse battery 9',
    });
  });

  it('must all be set if any is, even an invalid one, and the password must follow the rules', () => {
    const incomplete = loadEnvError({ ...REQUIRED, ADMIN_EMAIL: 'not-an-email' }).message;
    expect(incomplete).toMatch(/^\s+ADMIN_EMAIL: Enter a valid email address\.$/m);
    expect(incomplete).toMatch(new RegExp(`^\\s+ADMIN_NAME: ${ALL_THREE_OR_NONE}$`, 'm'));
    expect(incomplete).toMatch(new RegExp(`^\\s+ADMIN_PASSWORD: ${ALL_THREE_OR_NONE}$`, 'm'));

    const weak = loadEnvError({ ...REQUIRED, ...ADMIN, ADMIN_PASSWORD: 'hunter2-hunter2' }).message;
    expect(weak).toMatch(/^\s+ADMIN_PASSWORD: Must contain an uppercase letter\.$/m);
    expect(weak).not.toContain('hunter2');
  });
});

describe('the SMTP variables', () => {
  const SMTP = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_FROM: 'myli <myli@example.com>',
  };

  it('are read together', () => {
    expect(
      loadEnv({
        ...REQUIRED,
        ...SMTP,
        SMTP_PORT: '2525',
        SMTP_SECURITY: 'tls',
        SMTP_USER: 'myli',
        SMTP_PASSWORD: 'smtp-secret',
      }),
    ).toMatchObject({
      ...SMTP,
      SMTP_PORT: 2525,
      SMTP_SECURITY: 'tls',
      SMTP_USER: 'myli',
      SMTP_PASSWORD: 'smtp-secret',
    });
  });

  it('need what goes with them: SMTP_FROM with the host, the login in full, and the host with any', () => {
    expect(loadEnvError({ ...REQUIRED, SMTP_HOST: SMTP.SMTP_HOST }).message).toMatch(
      /^\s+SMTP_FROM: is required when SMTP_HOST is set$/m,
    );

    const half = loadEnvError({ ...REQUIRED, ...SMTP, SMTP_USER: 'smtp-hunter2' }).message;
    expect(half).toMatch(/^\s+SMTP_PASSWORD: is required when SMTP_USER is set$/m);
    expect(half).not.toContain('hunter2');
    expect(loadEnvError({ ...REQUIRED, ...SMTP, SMTP_PASSWORD: 'x' }).message).toMatch(
      /^\s+SMTP_USER: is required when SMTP_PASSWORD is set$/m,
    );

    // Catches a misspelled host variable.
    expect(loadEnvError({ ...REQUIRED, SMTP_PORT: '2525' }).message).toMatch(
      /^\s+SMTP_PORT: requires SMTP_HOST, which is not set$/m,
    );
  });

  it('take SMTP_FROM as an email address, optionally with a name', () => {
    const accepted = [
      'myli@example.com',
      'myli <myli@example.com>',
      '"myli, at home" <myli@example.com>',
    ];
    const refused = [
      'myli',
      'myli <not-an-email>',
      'a@example.com, b@example.com',
      'myli <a@example.com',
    ];
    const takes = (from: string) => {
      try {
        return loadEnv({ ...REQUIRED, ...SMTP, SMTP_FROM: from }).SMTP_FROM === from;
      } catch (error) {
        if (
          error instanceof EnvError &&
          /^\s+SMTP_FROM: must be an email address/m.test(error.message)
        ) {
          return false;
        }
        throw error;
      }
    };

    expect(
      Object.fromEntries([...accepted, ...refused].map((from) => [from, takes(from)])),
    ).toEqual(
      Object.fromEntries([
        ...accepted.map((from) => [from, true]),
        ...refused.map((from) => [from, false]),
      ]),
    );
  });
});

describe('secrets from files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myli-env-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  /** Writes `contents` to a new file and returns its path. */
  let files = 0;
  function secretFile(contents: string) {
    files += 1;
    const path = join(dir, `secret-${String(files)}`);
    writeFileSync(path, contents);
    return path;
  }

  it('reads each secret from the file its NAME_FILE names, without the trailing newline', () => {
    const env = loadEnv({
      PUBLIC_URL: REQUIRED.PUBLIC_URL,
      BETTER_AUTH_SECRET_FILE: secretFile(`${REQUIRED.BETTER_AUTH_SECRET}\n`),
      MEILI_MASTER_KEY_FILE: secretFile(`${REQUIRED.MEILI_MASTER_KEY}\r\n`),
      ADMIN_NAME: 'Ada Lovelace',
      ADMIN_EMAIL: 'ada@example.com',
      ADMIN_PASSWORD_FILE: secretFile('Correct horse battery 9'),
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'myli@example.com',
      SMTP_USER: 'myli',
      SMTP_PASSWORD_FILE: secretFile(' spaces count \n\n'),
    });

    expect(env).toMatchObject({
      BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
      MEILI_MASTER_KEY: REQUIRED.MEILI_MASTER_KEY,
      ADMIN_PASSWORD: 'Correct horse battery 9',
      // Only one newline is the file's own.
      SMTP_PASSWORD: ' spaces count \n',
    });
    expect(Object.keys(env).filter((name) => name.endsWith('_FILE'))).toEqual([]);
  });

  it('says what’s wrong with a file by its path, never its contents', () => {
    const together = loadEnvError({
      ...REQUIRED,
      MEILI_MASTER_KEY_FILE: secretFile('another-master-key'),
    });
    expect(together.message).toMatch(
      /^\s+MEILI_MASTER_KEY_FILE: can't be set together with MEILI_MASTER_KEY; set one or the other$/m,
    );
    expect(together.message).not.toContain('another-master-key');

    const missing = join(dir, 'missing');
    const empty = secretFile('\n');
    const unreadable = loadEnvError({
      PUBLIC_URL: REQUIRED.PUBLIC_URL,
      BETTER_AUTH_SECRET_FILE: missing,
      MEILI_MASTER_KEY_FILE: dir,
      ADMIN_NAME: 'Ada Lovelace',
      ADMIN_EMAIL: 'ada@example.com',
      ADMIN_PASSWORD_FILE: empty,
    });
    expect(unreadable.message.split('\n').slice(1)).toEqual([
      `  BETTER_AUTH_SECRET_FILE: can't read ${missing}: there is no such file`,
      `  MEILI_MASTER_KEY_FILE: can't read ${dir}: it is a directory`,
      `  ADMIN_PASSWORD_FILE: ${empty} is empty`,
    ]);

    const short = loadEnvError({
      ...REQUIRED,
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_SECRET_FILE: secretFile('too-short-hunter2'),
    });
    expect(short.message).toMatch(
      /^\s+BETTER_AUTH_SECRET \(from BETTER_AUTH_SECRET_FILE\): must be at least 32 characters/m,
    );
    expect(short.message).not.toContain('hunter2');
  });
});

describe('.env.example', () => {
  const example = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));
  // Every variable compose.yaml reads, with the default it gives it, if any: `${NAME:-default}`.
  const compose = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');
  const composeDefaults = new Map(
    [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?/g)].map(([, name, value]) => [
      name ?? '',
      value,
    ]),
  );
  const composeOnly = [...composeDefaults.keys()].filter((name) => !(name in envSchema.shape));

  it("documents exactly the variables in the schema, the files secrets can come from, and Compose's", () => {
    expect(composeOnly).toContain('MYLI_PROXY_SUBNET');
    expect(Object.keys(example).sort()).toEqual(
      [
        ...Object.keys(envSchema.shape),
        ...FILE_VARIABLES.map((name) => `${name}_FILE`),
        ...composeOnly,
      ].sort(),
    );
  });

  it('shows the default of each variable, leaving the required ones empty', () => {
    for (const name of composeOnly) expect(example[name], name).toBe(composeDefaults.get(name));
    for (const name of Object.keys(REQUIRED)) expect(example[name], name).toBe('');
    expect(loadEnv({ ...example, ...REQUIRED })).toEqual(loadEnv(REQUIRED));
  });
});
