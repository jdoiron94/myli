<script setup lang="ts">
import { CheckIcon, CircleIcon, EyeIcon, EyeOffIcon } from '@lucide/vue';
import { passwordChecklist } from '@myli/shared';
import { useField } from 'vee-validate';
import { computed, ref, useId, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * A new password for the VeeValidate form around it: the input, a button to show what's typed, and
 * the password rules, each marked as it's met. Use `FormTextField` to ask for an existing one.
 */
const props = defineProps<{
  /** The field's path in the form's values. */
  name: string;
  label: string;
}>();

// Checked like FormTextField's: on submit, then as they type until it's valid again.
const { value, errors, validate } = useField<string>(() => props.name, undefined, {
  validateOnValueUpdate: false,
});
watch(value, () => {
  if (errors.value.length > 0) void validate();
});

function update(input: string | number) {
  value.value = String(input);
}

const shown = ref(false);
const checklist = computed(() => passwordChecklist(value.value));

const id = useId();
const errorId = `${id}-error`;
const rulesId = `${id}-rules`;
const invalid = computed(() => errors.value.length > 0);
</script>

<template>
  <Field :data-invalid="invalid ? true : undefined">
    <FieldLabel :for="id">
      {{ label }}
    </FieldLabel>
    <div class="relative">
      <Input
        :id="id"
        :model-value="value"
        :name="name"
        :type="shown ? 'text' : 'password'"
        autocomplete="new-password"
        class="pr-10"
        :aria-invalid="invalid ? true : undefined"
        :aria-describedby="invalid ? `${errorId} ${rulesId}` : rulesId"
        @update:model-value="update"
      />
      <!-- A toggle with a fixed name: screen readers say whether it's pressed. -->
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="absolute top-1/2 right-0.5 -translate-y-1/2"
        aria-label="Show password"
        :aria-pressed="shown"
        @click="shown = !shown"
      >
        <EyeOffIcon
          v-if="shown"
          aria-hidden="true"
        />
        <EyeIcon
          v-else
          aria-hidden="true"
        />
      </Button>
    </div>
    <FieldError
      :id="errorId"
      :errors="errors"
    />
    <!-- Not a live region: announcing it on every keystroke would drown out the typing. Screen
         readers hear it with the input instead, each rule saying whether it's met. -->
    <div
      :id="rulesId"
      class="text-sm"
    >
      <p class="text-muted-foreground">
        It needs:
      </p>
      <ul class="mt-1 flex flex-col gap-1">
        <li
          v-for="rule in checklist"
          :key="rule.label"
          class="flex items-start gap-2"
          :class="rule.met ? 'text-foreground' : 'text-muted-foreground'"
        >
          <CheckIcon
            v-if="rule.met"
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <CircleIcon
            v-else
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{{ rule.label }}<span class="sr-only">{{ rule.met ? ': done' : ': not yet' }}</span></span>
        </li>
      </ul>
    </div>
  </Field>
</template>
