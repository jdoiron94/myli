<script setup lang="ts">
import { UNIT_SYSTEMS, type UnitSystem } from '@myli/shared';
import { useId } from 'vue';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { UNIT_SYSTEM_LABELS } from './format.ts';

/** Which unit system to show quantities in. */
const system = defineModel<UnitSystem>({ required: true });

const id = useId();
</script>

<template>
  <FieldSet>
    <FieldLegend
      variant="label"
      class="mb-1.5"
    >
      Units
    </FieldLegend>
    <RadioGroup
      v-model="system"
      orientation="horizontal"
      class="flex flex-wrap gap-4"
    >
      <Field
        v-for="choice in UNIT_SYSTEMS"
        :key="choice"
        orientation="horizontal"
        class="w-auto"
      >
        <RadioGroupItem
          :id="`${id}-${choice}`"
          :value="choice"
        />
        <FieldLabel :for="`${id}-${choice}`">
          {{ UNIT_SYSTEM_LABELS[choice] }}
        </FieldLabel>
      </Field>
    </RadioGroup>
  </FieldSet>
</template>
