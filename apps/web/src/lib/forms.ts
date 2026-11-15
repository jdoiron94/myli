import type { TypedSchema } from 'vee-validate';
import { nextTick } from 'vue';
import type { z } from 'zod';

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
