import { passwordSchema, VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import type { TypedSchema } from 'vee-validate';
import { nextTick } from 'vue';
import { z } from 'zod';
import { ApiProblem } from '@/api/problem.ts';

/**
 * A Zod schema as VeeValidate's `validationSchema`. VeeValidate's own adapter, @vee-validate/zod,
 * only supports Zod 3. The values a form submits are the schema's output, so transforms (such as
 * `emailSchema` lower-casing) apply.
 */
export function formSchema<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
): TypedSchema<z.input<TSchema>, z.output<TSchema>> {
  return {
    __type: 'VVTypedSchema',
    async parse(values) {
      const result = await schema.safeParseAsync(values);
      if (result.success) return { value: result.data, errors: [] };
      const errors = new Map<string, string[]>();
      for (const { path, message } of result.error.issues) {
        const field = fieldPath(path);
        errors.set(field, [...(errors.get(field) ?? []), message]);
      }
      return { errors: [...errors].map(([path, messages]) => ({ path, errors: messages })) };
    },
  };
}

/**
 * A new password, for a form: "Choose a password." when it's empty, instead of every rule at once.
 * The rules are `passwordSchema`'s, which the API applies too.
 */
export const newPasswordSchema = z.string().min(1, 'Choose a password.').pipe(passwordSchema);

/**
 * The field errors of a 422, by field, for the form's `setErrors`, when the error is one and every
 * invalid field is one of `fields`. Otherwise `undefined`: the page explains the failure as a whole.
 */
export function apiFieldErrors<TField extends string>(
  error: unknown,
  fields: readonly TField[],
): Partial<Record<TField, string[]>> | undefined {
  if (!(error instanceof ApiProblem) || error.problem.type !== VALIDATION_PROBLEM_TYPE) return;
  if (error.fieldErrors.length === 0) return;
  const known = new Set<string>(fields);
  const errors: Partial<Record<string, string[]>> = {};
  for (const { in: part, pointer, detail } of error.fieldErrors) {
    const field = part === 'body' ? pointerPath(pointer) : undefined;
    if (field === undefined || !known.has(field)) return;
    errors[field] = [...(errors[field] ?? []), detail];
  }
  return errors;
}

/** A JSON Pointer in the API's field errors (`#/items/0/name`) in VeeValidate's notation. */
export function pointerPath(pointer: string): string | undefined {
  if (!pointer.startsWith('#/')) return;
  const keys = pointer
    .slice(2)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  return fieldPath(keys.map((key) => (/^\d+$/.test(key) ? Number(key) : key)));
}

/** A Zod issue's path in VeeValidate's notation: `items[0].name`. */
function fieldPath(path: readonly PropertyKey[]) {
  return path
    .map((key, index) => {
      if (typeof key === 'number') return `[${String(key)}]`;
      return index === 0 ? String(key) : `.${String(key)}`;
    })
    .join('');
}

/**
 * After a submit that failed validation, moves focus to the first field with an error, so keyboard
 * and screen-reader users land on what needs fixing. Pass it as `handleSubmit`'s second argument.
 */
export function focusFirstInvalidField(form: HTMLFormElement | null) {
  void nextTick(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
