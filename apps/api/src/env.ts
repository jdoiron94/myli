import { z } from 'zod';

/**
 * Every environment variable the API reads. `.env.example` documents each one,
 * and a test fails if the two drift apart.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

/**
 * Validates the environment and returns typed config.
 *
 * Empty strings count as unset, so `PORT=` in a `.env` file falls back to the default.
 * Throws an `EnvError` that lists every invalid variable. The message never includes
 * the values themselves, because some of them will be secrets.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(set);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map(
    (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new EnvError(['Invalid environment configuration:', ...problems].join('\n'));
}
