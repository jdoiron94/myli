import { passwordProblems, VALIDATION_PROBLEM_TYPE, type ValidationProblem } from '@myli/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiProblem } from '@/api/problem.ts';
import { apiFieldErrors, formSchema, newPasswordSchema, pointerPath } from './forms.ts';

const schema = formSchema(
  z.object({
    email: z.email('Enter a valid email address.').toLowerCase(),
    password: z.string().min(3, 'Too short.').regex(/\d/, 'Needs a number.'),
    tags: z.array(z.object({ name: z.string().min(1, 'Name the tag.') })),
  }),
);

describe('a Zod schema as a form schema', () => {
  it('submits the parsed values, transforms applied', async () => {
    await expect(
      schema.parse({ email: 'Ada@Example.com', password: 'abc1', tags: [{ name: 'soup' }] }),
    ).resolves.toEqual({
      value: { email: 'ada@example.com', password: 'abc1', tags: [{ name: 'soup' }] },
      errors: [],
    });
  });

  it("gives every message for each field, at the field's path", async () => {
    const result = await schema.parse({
      email: 'nope',
      password: 'a',
      tags: [{ name: 'soup' }, { name: '' }],
    });

    expect(result.value).toBeUndefined();
    expect(result.errors).toEqual([
      { path: 'email', errors: ['Enter a valid email address.'] },
      { path: 'password', errors: ['Too short.', 'Needs a number.'] },
      { path: 'tags[1].name', errors: ['Name the tag.'] },
    ]);
  });
});

describe('a new password', () => {
  it('asks for one when empty, instead of listing every rule', () => {
    expect(newPasswordSchema.safeParse('').error?.issues.map(({ message }) => message)).toEqual([
      'Choose a password.',
    ]);
  });

  it('follows the shared password rules otherwise', () => {
    expect(
      newPasswordSchema.safeParse('short').error?.issues.map(({ message }) => message),
    ).toEqual(passwordProblems('short'));
    expect(newPasswordSchema.parse('Correct horse battery 9')).toBe('Correct horse battery 9');
  });
});

describe("the API's field errors", () => {
  const validationProblem = (errors: ValidationProblem['errors']) =>
    new ApiProblem(
      {
        type: VALIDATION_PROBLEM_TYPE,
        title: 'Unprocessable Content',
        status: 422,
        detail: 'The request is invalid.',
      },
      errors,
    );

  it('are given by field, several to a field if need be', () => {
    const error = validationProblem([
      { in: 'body', pointer: '#/email', detail: 'Enter a valid email address.' },
      { in: 'body', pointer: '#/password', detail: 'Must contain a number.' },
      { in: 'body', pointer: '#/password', detail: 'Must contain a lowercase letter.' },
    ]);

    expect(apiFieldErrors(error, ['name', 'email', 'password'])).toEqual({
      email: ['Enter a valid email address.'],
      password: ['Must contain a number.', 'Must contain a lowercase letter.'],
    });
  });

  it.each([
    ["a field the form doesn't have", [{ in: 'body', pointer: '#/role', detail: 'No.' }]],
    ['a field outside the body', [{ in: 'query', pointer: '#/email', detail: 'No.' }]],
    ['the body as a whole', [{ in: 'body', pointer: '#', detail: 'Expected an object.' }]],
  ] as const)('are left to the page when one is about %s', (_, errors) => {
    const error = validationProblem([
      { in: 'body', pointer: '#/email', detail: 'Enter a valid email address.' },
      ...errors,
    ]);

    expect(apiFieldErrors(error, ['email'])).toBeUndefined();
  });

  it.each([
    ['a conflict', new ApiProblem({ type: 'about:blank', title: 'Conflict', status: 409 })],
    ['a network failure', new TypeError('Failed to fetch')],
  ])("aren't there for %s", (_, error) => {
    expect(apiFieldErrors(error, ['email'])).toBeUndefined();
  });

  it.each([
    ['#/email', 'email'],
    ['#/tags/0/name', 'tags[0].name'],
    ['#/a~1b/c~0d', 'a/b.c~d'],
  ])('map the pointer %s to the field %s', (pointer, path) => {
    expect(pointerPath(pointer)).toBe(path);
  });
});
