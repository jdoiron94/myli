<script setup lang="ts">
import { useField } from 'vee-validate';
import { computed, useId, watch } from 'vue';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/** A labelled text input for a field of the VeeValidate form around it, with its error message. */
const props = defineProps<{
  /** The field's path in the form's values. */
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autocomplete?: string;
  /** The keyboard phones show: `numeric` for whole numbers, `decimal` for others. */
  inputmode?: 'numeric' | 'decimal' | 'url';
  /** A hint under the label, such as the format it takes. */
  description?: string;
  /** Several lines, in a box that grows as they're typed. */
  multiline?: boolean;
}>();

// Not checked while someone first fills it in, only when the form is submitted, and from then on as
// they type, until it's valid again. An error doesn't appear before they've had a chance.
const { value, errorMessage, validate } = useField<string>(() => props.name, undefined, {
  validateOnValueUpdate: false,
});
watch(value, () => {
  if (errorMessage.value) void validate();
});

function update(input: string | number) {
  value.value = String(input);
}

const id = useId();
const errorId = `${id}-error`;
const descriptionId = `${id}-description`;
/** The error first: it's what needs reading when there is one. */
const describedBy = computed(
  () =>
    [errorMessage.value ? errorId : null, props.description ? descriptionId : null]
      .filter((part) => part !== null)
      .join(' ') || undefined,
);
</script>

<template>
  <Field :data-invalid="errorMessage ? true : undefined">
    <FieldLabel :for="id">
      {{ label }}
    </FieldLabel>
    <FieldDescription
      v-if="description"
      :id="descriptionId"
    >
      {{ description }}
    </FieldDescription>
    <Textarea
      v-if="multiline"
      :id="id"
      :model-value="value"
      :name="name"
      :aria-invalid="errorMessage ? true : undefined"
      :aria-describedby="describedBy"
      @update:model-value="update"
    />
    <Input
      v-else
      :id="id"
      :model-value="value"
      :name="name"
      :type="type ?? 'text'"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :aria-invalid="errorMessage ? true : undefined"
      :aria-describedby="describedBy"
      @update:model-value="update"
    />
    <!-- Given [undefined], FieldError would still render an empty alert. -->
    <FieldError
      :id="errorId"
      :errors="errorMessage ? [errorMessage] : []"
    />
  </Field>
</template>
