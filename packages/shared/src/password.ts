import { z } from 'zod';

/** Password rules (spec §3.1). The API enforces them on every path that sets a password. */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Character requirements. Letters and numbers from any script count, not just ASCII. `label` is
 * how a form lists the rule before it's broken; `message` is the error once it is.
 */
const REQUIREMENTS = [
  { pattern: /\p{Ll}/u, label: 'A lowercase letter', message: 'Must contain a lowercase letter.' },
  {
    pattern: /\p{Lu}/u,
    label: 'An uppercase letter',
    message: 'Must contain an uppercase letter.',
  },
  { pattern: /\p{N}/u, label: 'A number', message: 'Must contain a number.' },
  {
    pattern: /[^\p{L}\p{N}]/u,
    label: 'A special character: anything but a letter or a number, a space included',
    message:
      'Must contain a special character: anything but a letter or a number, a space included.',
  },
] as const;

// Refinements, not `.regex()`: the OpenAPI document can't express "contains each of these", and
// would render the patterns wrongly. It gets the length limits, and the description says the rest.
export const passwordSchema = REQUIREMENTS.reduce(
  (schema, { pattern, message }) => schema.refine((value) => pattern.test(value), message),
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Must be at least ${String(PASSWORD_MIN_LENGTH)} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Must be at most ${String(PASSWORD_MAX_LENGTH)} characters.`),
).meta({
  id: 'Password',
  description: `${String(PASSWORD_MIN_LENGTH)} to ${String(PASSWORD_MAX_LENGTH)} characters, with a lowercase letter, an uppercase letter, a number and a special character (anything but a letter or a number, a space included).`,
});

/** Every rule `password` breaks, as messages for the user. Empty when it's acceptable. */
export function passwordProblems(password: string): string[] {
  const result = passwordSchema.safeParse(password);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

/**
 * The rules a new password must follow, for a form to list while it's typed, each with whether
 * `password` meets it. The longest allowed length isn't listed: `passwordProblems` reports it.
 */
export function passwordChecklist(password: string): { label: string; met: boolean }[] {
  return [
    {
      label: `At least ${String(PASSWORD_MIN_LENGTH)} characters`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    ...REQUIREMENTS.map(({ label, pattern }) => ({ label, met: pattern.test(password) })),
  ];
}
