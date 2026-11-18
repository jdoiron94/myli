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
  it('applies defaults when only the required variables are set', () => {
    expect(loadEnv(REQUIRED)).toEqual({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/myli.db',
      BLOB_DIR: './data/blobs',
      MEILI_URL: 'http://localhost:7700',
      TRUSTED_PROXIES: [],
      INVITATION_TTL_DAYS: 7,
      SMTP_SECURITY: 'starttls',
      ...REQUIRED,
    });
  });

  it('reads and converts values that are set', () => {
    expect(
      loadEnv({
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '8080',
        LOG_LEVEL: 'debug',
        DATABASE_PATH: '/data/myli.db',
        BLOB_DIR: '/data/blobs',
        PUBLIC_URL: 'http://localhost:5173',
        BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
        MEILI_URL: 'http://meilisearch:7700',
        MEILI_MASTER_KEY: REQUIRED.MEILI_MASTER_KEY,
        TRUSTED_PROXIES: '172.18.0.2, 10.0.0.0/8,,fd00::/8 ',
        INVITATION_TTL_DAYS: '14',
      }),
    ).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 8080,
      LOG_LEVEL: 'debug',
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

  it('treats empty strings as unset', () => {
    expect(loadEnv({ ...REQUIRED, PORT: '', LOG_LEVEL: '' })).toMatchObject({
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('drops variables it does not know about', () => {
    expect(loadEnv({ ...REQUIRED, PATH: '/usr/bin', HOME: '/root' })).not.toHaveProperty('PATH');
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

  it.each(['0', '91', '1.5', 'week'])('rejects INVITATION_TTL_DAYS=%s', (days) => {
    expect(loadEnvError({ ...REQUIRED, INVITATION_TTL_DAYS: days }).message).toMatch(
      /^\s+INVITATION_TTL_DAYS: /m,
    );
  });

  it.each(['0', '65536', '80.5', 'http'])('rejects PORT=%s', (port) => {
    expect(loadEnvError({ ...REQUIRED, PORT: port }).message).toMatch(/^\s+PORT: /m);
  });

  it('says which required variables are missing', () => {
    const { message } = loadEnvError({ PUBLIC_URL: '', BETTER_AUTH_SECRET: '' });
    expect(message).toMatch(/^\s+PUBLIC_URL: is required$/m);
    expect(message).toMatch(/^\s+BETTER_AUTH_SECRET: is required$/m);
  });

  it('reduces PUBLIC_URL to its origin', () => {
    expect(loadEnv({ ...REQUIRED, PUBLIC_URL: 'https://Myli.Example:8443/' }).PUBLIC_URL).toBe(
      'https://myli.example:8443',
    );
  });

  it.each([
    'myli.example',
    'ftp://myli.example',
    'https://myli.example/recipes',
    'https://myli.example/?x=1',
  ])('rejects PUBLIC_URL=%s', (url) => {
    expect(loadEnvError({ ...REQUIRED, PUBLIC_URL: url }).message).toMatch(/^\s+PUBLIC_URL: /m);
  });

  it('rejects a BETTER_AUTH_SECRET shorter than 32 characters, without echoing it', () => {
    const { message } = loadEnvError({ ...REQUIRED, BETTER_AUTH_SECRET: 'too-short-hunter2' });
    expect(message).toMatch(/^\s+BETTER_AUTH_SECRET: must be at least 32 characters/m);
    expect(message).not.toContain('hunter2');
  });

  it('requires MEILI_MASTER_KEY, of at least 16 characters, without echoing it', () => {
    const unset = loadEnvError({ ...REQUIRED, MEILI_MASTER_KEY: '' });
    expect(unset.message).toMatch(/^\s+MEILI_MASTER_KEY: is required$/m);

    const { message } = loadEnvError({ ...REQUIRED, MEILI_MASTER_KEY: 'short-hunter2' });
    expect(message).toMatch(/^\s+MEILI_MASTER_KEY: must be at least 16 characters/m);
    expect(message).not.toContain('hunter2');
  });

  it.each(['meilisearch:7700', 'ftp://meilisearch:7700'])('rejects MEILI_URL=%s', (url) => {
    expect(loadEnvError({ ...REQUIRED, MEILI_URL: url }).message).toMatch(/^\s+MEILI_URL: /m);
  });

  it('lists every invalid variable in one error', () => {
    const { message } = loadEnvError({ NODE_ENV: 'staging', PORT: '99999', LOG_LEVEL: 'loud' });
    expect(message).toMatch(/^Invalid environment configuration:/);
    expect(message).toMatch(/^\s+NODE_ENV: /m);
    expect(message).toMatch(/^\s+PORT: /m);
    expect(message).toMatch(/^\s+LOG_LEVEL: /m);
  });

  it('never echoes the invalid values', () => {
    const { message } = loadEnvError({ PORT: 'hunter2-secret', LOG_LEVEL: 'hunter3-secret' });
    expect(message).not.toContain('hunter2-secret');
    expect(message).not.toContain('hunter3-secret');
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

  it('are optional', () => {
    expect(loadEnv(REQUIRED)).not.toHaveProperty('ADMIN_NAME');
  });

  it('are read together, with the name trimmed and the email lowercased', () => {
    expect(loadEnv({ ...REQUIRED, ...ADMIN })).toMatchObject({
      ADMIN_NAME: 'Ada Lovelace',
      ADMIN_EMAIL: 'ada@example.com',
      ADMIN_PASSWORD: 'Correct horse battery 9',
    });
  });

  it.each(['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] as const)(
    'must all be set if any is: only %s is',
    (name) => {
      const { message } = loadEnvError({ ...REQUIRED, [name]: ADMIN[name] });
      const missing = Object.keys(ADMIN).filter((variable) => variable !== name);
      for (const variable of missing) {
        expect(message).toMatch(new RegExp(`^\\s+${variable}: ${ALL_THREE_OR_NONE}$`, 'm'));
      }
      expect(message).not.toMatch(new RegExp(`^\\s+${name}: `, 'm'));
      expect(message).not.toContain(ADMIN[name].trim());
    },
  );

  it('count as set when one is invalid, and are checked alongside every other variable', () => {
    const { message } = loadEnvError({ ...REQUIRED, PORT: 'http', ADMIN_EMAIL: 'not-an-email' });
    expect(message).toMatch(/^\s+PORT: /m);
    expect(message).toMatch(/^\s+ADMIN_EMAIL: Enter a valid email address\.$/m);
    expect(message).toMatch(new RegExp(`^\\s+ADMIN_NAME: ${ALL_THREE_OR_NONE}$`, 'm'));
    expect(message).toMatch(new RegExp(`^\\s+ADMIN_PASSWORD: ${ALL_THREE_OR_NONE}$`, 'm'));
  });

  it('reject a password that breaks the rules, saying which, without echoing it', () => {
    const { message } = loadEnvError({ ...REQUIRED, ...ADMIN, ADMIN_PASSWORD: 'hunter2-hunter2' });
    expect(message).toMatch(/^\s+ADMIN_PASSWORD: Must contain an uppercase letter\.$/m);
    expect(message).not.toContain('hunter2');
  });
});

describe('the SMTP variables', () => {
  const SMTP = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_FROM: 'myli <myli@example.com>',
  };

  it('are optional: email is off unless SMTP_HOST is set', () => {
    const env = loadEnv(REQUIRED);
    expect(env).not.toHaveProperty('SMTP_HOST');
    expect(env.SMTP_SECURITY).toBe('starttls');
  });

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

  it('need SMTP_FROM when SMTP_HOST is set', () => {
    const { message } = loadEnvError({ ...REQUIRED, SMTP_HOST: SMTP.SMTP_HOST });
    expect(message).toMatch(/^\s+SMTP_FROM: is required when SMTP_HOST is set$/m);
  });

  it.each([
    ['SMTP_USER', 'SMTP_PASSWORD'],
    ['SMTP_PASSWORD', 'SMTP_USER'],
  ])('need the login in full: %s without %s is refused', (set, missing) => {
    const { message } = loadEnvError({ ...REQUIRED, ...SMTP, [set]: 'smtp-hunter2' });
    expect(message).toMatch(new RegExp(`^\\s+${missing}: is required when ${set} is set$`, 'm'));
    expect(message).not.toContain('hunter2');
  });

  it.each(['SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'])(
    'refuse %s without SMTP_HOST, which catches a misspelled host variable',
    (name) => {
      const value = name === 'SMTP_PORT' ? '2525' : SMTP.SMTP_FROM;
      const { message } = loadEnvError({ ...REQUIRED, [name]: value });
      expect(message).toMatch(
        new RegExp(`^\\s+${name}: requires SMTP_HOST, which is not set$`, 'm'),
      );
    },
  );

  it.each(['myli@example.com', 'myli <myli@example.com>', '"myli, at home" <myli@example.com>'])(
    'accept SMTP_FROM=%s',
    (from) => {
      expect(loadEnv({ ...REQUIRED, ...SMTP, SMTP_FROM: from }).SMTP_FROM).toBe(from);
    },
  );

  it.each(['myli', 'myli <not-an-email>', 'a@example.com, b@example.com', 'myli <a@example.com'])(
    'reject SMTP_FROM=%s',
    (from) => {
      expect(loadEnvError({ ...REQUIRED, ...SMTP, SMTP_FROM: from }).message).toMatch(
        /^\s+SMTP_FROM: must be an email address, optionally with a name/m,
      );
    },
  );

  it.each([
    ['SMTP_SECURITY', 'ssl'],
    ['SMTP_HOST', 'smtp example com'],
    ['SMTP_PORT', '0'],
  ])('reject %s=%s', (name, value) => {
    expect(loadEnvError({ ...REQUIRED, ...SMTP, [name]: value }).message).toMatch(
      new RegExp(`^\\s+${name}: `, 'm'),
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

  it('refuses a secret and its file together', () => {
    const error = loadEnvError({
      ...REQUIRED,
      MEILI_MASTER_KEY_FILE: secretFile('another-master-key'),
    });

    expect(error.message).toMatch(
      /^\s+MEILI_MASTER_KEY_FILE: can't be set together with MEILI_MASTER_KEY; set one or the other$/m,
    );
    expect(error.message).not.toContain('another-master-key');
  });

  it("says which file can't be read and why, instead of calling the secret missing", () => {
    const missing = join(dir, 'missing');
    const error = loadEnvError({
      PUBLIC_URL: REQUIRED.PUBLIC_URL,
      BETTER_AUTH_SECRET_FILE: missing,
      MEILI_MASTER_KEY_FILE: dir,
    });

    expect(error.message.split('\n').slice(1)).toEqual([
      `  BETTER_AUTH_SECRET_FILE: can't read ${missing}: there is no such file`,
      `  MEILI_MASTER_KEY_FILE: can't read ${dir}: it is a directory`,
    ]);
  });

  it('refuses an empty file', () => {
    const empty = secretFile('\n');
    const error = loadEnvError({
      ...REQUIRED,
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_SECRET_FILE: empty,
    });

    expect(error.message.split('\n').slice(1)).toEqual([
      `  BETTER_AUTH_SECRET_FILE: ${empty} is empty`,
    ]);
  });

  it('checks a secret from a file like any other, saying where it came from, without echoing it', () => {
    const error = loadEnvError({
      ...REQUIRED,
      BETTER_AUTH_SECRET: '',
      BETTER_AUTH_SECRET_FILE: secretFile('too-short-hunter2'),
    });

    expect(error.message).toMatch(
      /^\s+BETTER_AUTH_SECRET \(from BETTER_AUTH_SECRET_FILE\): must be at least 32 characters/m,
    );
    expect(error.message).not.toContain('hunter2');
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

  it('shows the default compose.yaml gives each of its own variables', () => {
    for (const name of composeOnly) expect(example[name], name).toBe(composeDefaults.get(name));
  });

  it('leaves the required variables empty', () => {
    for (const name of Object.keys(REQUIRED)) expect(example[name]).toBe('');
  });

  it('shows the default value of every other variable', () => {
    expect(loadEnv({ ...example, ...REQUIRED })).toEqual(loadEnv(REQUIRED));
  });
});
