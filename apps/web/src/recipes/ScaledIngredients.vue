<script setup lang="ts">
import { scaleFactor } from '@myli/shared';
import { computed, nextTick, useTemplateRef } from 'vue';
import { useUnitSystem } from '@/account/preferences.ts';
import { failureMessage } from '@/api/failure.ts';
import { Button } from '@/components/ui/button';
import IngredientList from './IngredientList.vue';
import type { Recipe } from './recipe.ts';
import ServingsControl from './ServingsControl.vue';
import UnitSystemChoice from './UnitSystemChoice.vue';

/**
 * A recipe's ingredients, scaled to the servings chosen and shown in the reader's unit system, with
 * the controls for both (spec §3.2). Scaling changes only what's shown.
 */
const props = defineProps<{ recipe: Pick<Recipe, 'servings' | 'ingredientGroups'> }>();
const servings = defineModel<number>('servings', { required: true });

const scaled = computed(() => servings.value !== props.recipe.servings);
const factor = computed(() => scaleFactor(props.recipe.servings, servings.value));
const servingsText = (count: number) => `${String(count)} ${count === 1 ? 'serving' : 'servings'}`;

const servingsControl = useTemplateRef('servingsControl');
/** Back to the recipe's own servings. The button goes, so focus goes to the number instead. */
async function unscale() {
  servings.value = props.recipe.servings;
  await nextTick();
  servingsControl.value?.focus();
}

const units = useUnitSystem();
</script>

<template>
  <template v-if="recipe.ingredientGroups.length > 0">
    <div class="mb-4 text-base">
      <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
        <ServingsControl
          ref="servingsControl"
          v-model="servings"
        />
        <UnitSystemChoice
          v-if="units.ready.value"
          :model-value="units.system.value"
          @update:model-value="units.choose"
        />
      </div>
      <!-- Always there, so screen readers announce what it says as it changes: hiding it while
           empty would stop that, so it only loses its margin. -->
      <p
        role="status"
        class="text-sm text-muted-foreground not-empty:mt-3"
      >
        <template v-if="scaled">
          Amounts for {{ servingsText(servings) }}, scaled from the recipe's
          {{ recipe.servings }}.
        </template>
      </p>
      <Button
        v-if="scaled"
        variant="outline"
        size="sm"
        class="mt-2"
        @click="unscale"
      >
        Back to {{ servingsText(recipe.servings) }}
      </Button>
      <p
        v-if="units.failure.value"
        role="alert"
        class="mt-3 text-sm text-destructive"
      >
        Your choice of units couldn't be saved. {{ failureMessage(units.failure.value) }}
      </p>
    </div>
    <IngredientList
      v-if="units.ready.value"
      :groups="recipe.ingredientGroups"
      :system="units.system.value"
      :factor="factor"
    />
  </template>
  <p
    v-else
    class="text-muted-foreground"
  >
    No ingredients yet.
  </p>
</template>
