import { emailSchema, passwordSchema, userNameSchema } from '@myli/shared';
import { z } from 'zod';

/** For variables without a default: says "is required" instead of Zod's type message. */
const required = {
  error: (issue: { input: unknown }) => (issue.input === undefined ? 'is required' : undefined),
};

const port = z.coerce.number().int().min(1).max(65_535);

/** How the API talks to the SMTP server. */
export const SMTP_SECURITY_MODES = ['starttls', 'tls', 'none'] as const;

/** `myli@example.com` or `myli <myli@example.com>`. */
const smtpFromSchema = z.string().refine((value) => {
  const match = /^(?:[^<>\r\n]*<([^<>\s]+)>|([^<>\s]+))$/.exec(value.trim());
  const address = match?.[1] ?? match?.[2];
  return address !== undefined && z.email().safeParse(address).success;
}, 'must be an email address, optionally with a name, like: myli <myli@example.com>');

const FIRST_ADMIN_VARIABLES = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'] as const;
/** SMTP variables that mean nothing without SMTP_HOST. SMTP_SECURITY has a default, so can't tell. */
const SMTP_HOST_DEPENDENTS = ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

/**
 * Every environment variable the API reads. `.env.example` documents each one,
 * and a test fails if the two drift apart.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    HOST: z.string().default('0.0.0.0'),
    PORT: port.default(3000),
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
    // Meilisearch, the search service (spec §4). The API starts and serves requests without it, and
    // keeps trying to reach it.
    MEILI_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:7700'),
    // Used only at startup, to create the API's own key, which is limited to what the API needs.
    MEILI_MASTER_KEY: z
      .string(required)
      .min(16, 'must be at least 16 characters; generate one with: openssl rand -base64 32'),
    // How long an invitation link works.
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    // Optional: email. Off unless SMTP_HOST is set. The default port depends on SMTP_SECURITY.
    SMTP_HOST: z.string().regex(/^\S+$/, 'must be a host name or IP address').optional(),
    SMTP_PORT: port.optional(),
    SMTP_SECURITY: z.enum(SMTP_SECURITY_MODES).default('starttls'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: smtpFromSchema.optional(),
  })
  .superRefine(
    (env, ctx) => {
      const problem = (name: string, message: string) => {
        ctx.addIssue({ code: 'custom', path: [name], message });
      };

      if (FIRST_ADMIN_VARIABLES.some((name) => env[name] !== undefined)) {
        for (const name of FIRST_ADMIN_VARIABLES.filter(
          (variable) => env[variable] === undefined,
        )) {
          problem(name, 'is required when any of ADMIN_NAME, ADMIN_EMAIL or ADMIN_PASSWORD is set');
        }
      }

      if (env.SMTP_HOST === undefined) {
        for (const name of SMTP_HOST_DEPENDENTS.filter((variable) => env[variable] !== undefined)) {
          problem(name, 'requires SMTP_HOST, which is not set');
        }
      } else {
        if (env.SMTP_FROM === undefined) problem('SMTP_FROM', 'is required when SMTP_HOST is set');
        if (env.SMTP_USER !== undefined && env.SMTP_PASSWORD === undefined) {
          problem('SMTP_PASSWORD', 'is required when SMTP_USER is set');
        }
        if (env.SMTP_PASSWORD !== undefined && env.SMTP_USER === undefined) {
          problem('SMTP_USER', 'is required when SMTP_PASSWORD is set');
        }
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
