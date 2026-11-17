<script setup lang="ts">
import { UNIT_SYSTEMS, type UnitSystem } from '@myli/shared';
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import { UNIT_SYSTEM_LABELS } from './format.ts';

/**
 * Which unit system to show quantities in: radios, drawn as one switch so it fits beside the
 * servings. Each shows a short name; screen readers hear the full one ("US customary"), which starts
 * with what's shown, so speaking it works too.
 */
const system = defineModel<UnitSystem>({ required: true });

const SHORT_LABELS: Readonly<Record<UnitSystem, string>> = { imperial: 'US', metric: 'Metric' };
</script>

<template>
  <RadioGroupRoot
    v-model="system"
    aria-label="Units"
    orientation="horizontal"
    class="inline-flex h-8 items-center rounded-lg border border-input p-0.5"
  >
    <RadioGroupItem
      v-for="choice in UNIT_SYSTEMS"
      :key="choice"
      :value="choice"
      :aria-label="UNIT_SYSTEM_LABELS[choice]"
      class="h-full rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
    >
      {{ SHORT_LABELS[choice] }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
