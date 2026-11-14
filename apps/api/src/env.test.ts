import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EnvError, envSchema, loadEnv } from './env.ts';

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
};

describe('loadEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(loadEnv(REQUIRED)).toEqual({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/myli.db',
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
        PUBLIC_URL: 'http://localhost:5173',
        BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
      }),
    ).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 8080,
      LOG_LEVEL: 'debug',
      DATABASE_PATH: '/data/myli.db',
      PUBLIC_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: REQUIRED.BETTER_AUTH_SECRET,
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

describe('.env.example', () => {
  const example = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

  it('documents exactly the variables in the schema', () => {
    expect(Object.keys(example).sort()).toEqual(Object.keys(envSchema.shape).sort());
  });

  it('leaves the required variables empty', () => {
    for (const name of Object.keys(REQUIRED)) expect(example[name]).toBe('');
  });

  it('shows the default value of every other variable', () => {
    expect(loadEnv({ ...example, ...REQUIRED })).toEqual(loadEnv(REQUIRED));
  });
});
