<script setup lang="ts">
import { useField } from 'vee-validate';
import { useId } from 'vue';
import FormTextField from '@/components/FormTextField.vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';

/**
 * The parts of an ingredient line, as someone corrected how myli reads it. Each is a field of the
 * form, under the line's `details`.
 */
const props = defineProps<{
  /** The line's path in the form's values. */
  path: string;
  /** Its place in its group, from 1. */
  position: number;
}>();

const field = (part: string) => `${props.path}.details.${part}`;
const { value: scalable } = useField<boolean>(() => field('scalable'));
const scalableId = useId();
</script>

<template>
  <FieldSet
    data-corrections
    class="gap-3 rounded-md border p-3"
  >
    <FieldLegend
      variant="label"
      class="mb-0"
    >
      How ingredient {{ position }} is read
    </FieldLegend>
    <div class="grid grid-cols-2 gap-3">
      <FormTextField
        :name="field('qty')"
        label="Amount"
        description="Like 2 or 1½. Empty for none."
      />
      <FormTextField
        :name="field('qtyMax')"
        label="Up to"
        description="The top of a range, like 3 in 2–3."
      />
      <FormTextField
        :name="field('unit')"
        label="Unit"
        description="Like cup or clove. Empty for a count."
      />
      <FormTextField
        :name="field('name')"
        label="Ingredient"
      />
    </div>
    <FormTextField
      :name="field('note')"
      label="Note"
      description="Anything said about it, like “finely chopped”."
    />
    <Field orientation="horizontal">
      <Checkbox
        :id="scalableId"
        :model-value="scalable"
        @update:model-value="scalable = $event === true"
      />
      <FieldLabel :for="scalableId">
        Changes with servings
      </FieldLabel>
    </Field>
  </FieldSet>
</template>
