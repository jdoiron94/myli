import { emailSchema, passwordSchema, userNameSchema } from '@myli/shared';
import { z } from 'zod';

/** For variables without a default: says "is required" instead of Zod's type message. */
const required = {
  error: (issue: { input: unknown }) => (issue.input === undefined ? 'is required' : undefined),
};

const FIRST_ADMIN_VARIABLES = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] as const;

/**
 * Every environment variable the API reads. `.env.example` documents each one,
 * and a test fails if the two drift apart.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_PATH: z.string().default('./data/myli.db'),
    // The address people open myli at. Sign-in only accepts requests from this origin, cookies are
    // marked Secure when it's https, and emailed links point here.
    PUBLIC_URL: z
      .url({ protocol: /^https?$/, ...required })
      .refine((value) => {
        // Zod runs this even when the URL check above failed; that failure is already reported.
        const url = URL.parse(value);
        return url === null || (url.pathname === '/' && url.search === '' && url.hash === '');
      }, 'must be an origin only, like https://myli.example, without a path')
      .transform((value) => new URL(value).origin),
    // Signs session cookies and encrypts auth data. Changing it signs everyone out.
    BETTER_AUTH_SECRET: z
      .string(required)
      .min(32, 'must be at least 32 characters; generate one with: openssl rand -base64 32'),
    // Optional: the first admin, created at startup if no user exists yet. All three or none.
    ADMIN_NAME: userNameSchema.optional(),
    ADMIN_EMAIL: emailSchema.optional(),
    ADMIN_PASSWORD: passwordSchema.optional(),
  })
  .superRefine(
    (env, ctx) => {
      const set = FIRST_ADMIN_VARIABLES.filter((name) => env[name] !== undefined);
      if (set.length === 0 || set.length === FIRST_ADMIN_VARIABLES.length) return;
      for (const name of FIRST_ADMIN_VARIABLES.filter((variable) => !set.includes(variable))) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'is required when any of ADMIN_NAME, ADMIN_EMAIL or ADMIN_PASSWORD is set',
        });
      }
    },
    // Zod skips object-level checks once any field is invalid. Run anyway, so one error lists
    // every problem; invalid fields still hold the value that was set.
    { when: (payload) => typeof payload.value === 'object' && payload.value !== null },
  );

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
