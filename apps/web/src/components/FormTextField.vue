<script setup lang="ts">
import { useField } from 'vee-validate';
import { useId, watch } from 'vue';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** A labelled text input for a field of the VeeValidate form around it, with its error message. */
const props = defineProps<{
  /** The field's path in the form's values. */
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autocomplete?: string;
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
</script>

<template>
  <Field :data-invalid="errorMessage ? true : undefined">
    <FieldLabel :for="id">
      {{ label }}
    </FieldLabel>
    <Input
      :id="id"
      :model-value="value"
      :name="name"
      :type="type ?? 'text'"
      :autocomplete="autocomplete"
      :aria-invalid="errorMessage ? true : undefined"
      :aria-describedby="errorMessage ? errorId : undefined"
      @update:model-value="update"
    />
    <!-- Given [undefined], FieldError would still render an empty alert. -->
    <FieldError
      :id="errorId"
      :errors="errorMessage ? [errorMessage] : []"
    />
  </Field>
</template>
