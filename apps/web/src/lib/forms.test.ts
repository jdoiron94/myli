import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formSchema } from './forms.ts';

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
