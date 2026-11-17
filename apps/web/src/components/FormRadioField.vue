<script setup lang="ts" generic="TValue extends string">
import { useField } from 'vee-validate';
import { useId } from 'vue';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/**
 * A choice of one, as radio buttons, for a field of the VeeValidate form around it, with its error.
 * Each choice can have a line saying what it means.
 */
const props = defineProps<{
  /** The field's path in the form's values. */
  name: string;
  /** What's being chosen, as the group's legend. */
  label: string;
  choices: readonly { value: TValue; label: string; description?: string }[];
  /** Side by side, for short choices without descriptions. */
  inline?: boolean;
}>();

const { value, errorMessage } = useField<TValue>(() => props.name);

const id = useId();
const errorId = `${id}-error`;
const choiceId = (choice: TValue) => `${id}-${choice}`;
</script>

<template>
  <FieldSet>
    <FieldLegend variant="label">
      {{ label }}
    </FieldLegend>
    <RadioGroup
      v-model="value"
      :name="name"
      :class="inline ? 'flex flex-wrap gap-x-6 gap-y-3' : undefined"
      :aria-describedby="errorMessage ? errorId : undefined"
    >
      <Field
        v-for="choice in choices"
        :key="choice.value"
        orientation="horizontal"
        :class="inline ? 'w-auto' : undefined"
      >
        <RadioGroupItem
          :id="choiceId(choice.value)"
          :value="choice.value"
          :aria-describedby="choice.description ? `${choiceId(choice.value)}-description` : undefined"
          :aria-invalid="errorMessage ? true : undefined"
        />
        <FieldContent>
          <FieldLabel :for="choiceId(choice.value)">
            {{ choice.label }}
          </FieldLabel>
          <FieldDescription
            v-if="choice.description"
            :id="`${choiceId(choice.value)}-description`"
          >
            {{ choice.description }}
          </FieldDescription>
        </FieldContent>
      </Field>
    </RadioGroup>
    <FieldError
      :id="errorId"
      :errors="errorMessage ? [errorMessage] : []"
    />
  </FieldSet>
</template>
