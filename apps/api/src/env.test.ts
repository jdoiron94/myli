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

describe('loadEnv', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/myli.db',
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
      }),
    ).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 8080,
      LOG_LEVEL: 'debug',
      DATABASE_PATH: '/data/myli.db',
    });
  });

  it('treats empty strings as unset', () => {
    expect(loadEnv({ PORT: '', LOG_LEVEL: '' })).toMatchObject({ PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('drops variables it does not know about', () => {
    expect(loadEnv({ PATH: '/usr/bin', HOME: '/root' })).not.toHaveProperty('PATH');
  });

  it.each(['0', '65536', '80.5', 'http'])('rejects PORT=%s', (port) => {
    expect(loadEnvError({ PORT: port }).message).toMatch(/^\s+PORT: /m);
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

describe('.env.example', () => {
  const example = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'));

  it('documents exactly the variables in the schema', () => {
    expect(Object.keys(example).sort()).toEqual(Object.keys(envSchema.shape).sort());
  });

  it('shows the default value of each variable', () => {
    expect(loadEnv(example)).toEqual(loadEnv({}));
  });
});
