<script setup lang="ts">
import type { UnitSystem } from '@myli/shared';
import { computed } from 'vue';
import { showLine } from './format.ts';
import type { Recipe } from './recipe.ts';

/**
 * A recipe's ingredients, in their groups. A recipe with one group shows no heading for it (spec
 * §3.2); with several, each labeled group gets one, below the section's own.
 */
const props = defineProps<{
  groups: Recipe['ingredientGroups'];
  system: UnitSystem;
  /** What scalable quantities are multiplied by: 1 at the recipe's own servings. */
  factor: number;
}>();

const shown = computed(() =>
  props.groups.map((group) => ({
    label: props.groups.length > 1 ? group.label : null,
    lines: group.ingredients.map((line) =>
      showLine(line, { system: props.system, factor: props.factor }),
    ),
  })),
);
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="(group, groupIndex) in shown"
      :key="groupIndex"
    >
      <h3
        v-if="group.label"
        class="mb-2 font-semibold"
      >
        {{ group.label }}
      </h3>
      <!-- The space after the amount is an expression: Vue drops whitespace at the end of an element,
           and "3 cupsflour" would be what screen readers read. -->
      <ul class="space-y-2">
        <li
          v-for="(line, lineIndex) in group.lines"
          :key="lineIndex"
          class="print:break-inside-avoid"
        >
          <span
            v-if="line.amount"
            class="font-medium"
          >{{ line.amount }}</span>{{ line.amount ? ' ' : '' }}{{ line.name }}<span
            v-if="line.note"
            class="text-muted-foreground"
          >, {{ line.note }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
