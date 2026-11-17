<script setup lang="ts">
import { RECIPE_LIMITS } from '@myli/shared';
import { useFieldArray, useFieldError } from 'vee-validate';
import { nextTick, useTemplateRef } from 'vue';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import IngredientGroupEditor from './IngredientGroupEditor.vue';
import { emptyGroup, type IngredientGroupValues } from './recipe-form.ts';

/** The recipe's ingredients, in one group or several. */
const groups = useFieldArray<IngredientGroupValues>('ingredientGroups');
const fields = groups.fields;
const error = useFieldError('ingredientGroups');

const root = useTemplateRef('root');
const full = () => fields.value.length >= RECIPE_LIMITS.ingredientGroups;

/** Focus goes to the new group's name. */
async function addGroup() {
  if (full()) return;
  groups.push(emptyGroup());
  await nextTick();
  const shown = root.value?.querySelectorAll('[data-ingredient-group]') ?? [];
  [...shown].at(-1)?.querySelector('input')?.focus();
}

/** Focus goes to the button to add one back. */
async function removeGroup(index: number) {
  groups.remove(index);
  await nextTick();
  root.value?.querySelector<HTMLElement>('[data-add-group]')?.focus();
}
</script>

<template>
  <div ref="root">
    <FieldSet>
      <FieldLegend>Ingredients</FieldLegend>
      <FieldDescription>
        One per line, as you'd write it: “2 cups flour, sifted”. Enter starts the next one, and a
        whole list can be pasted in at once. Under each, you can check how myli reads it.
      </FieldDescription>
      <IngredientGroupEditor
        v-for="(field, index) in fields"
        :key="field.key"
        :index="index"
        :count="fields.length"
        @remove="removeGroup(index)"
      />
      <FieldError :errors="error ? [error] : []" />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="aria-disabled:opacity-50"
          data-add-group
          :aria-disabled="full() ? true : undefined"
          @click="addGroup"
        >
          Add a group, like “For the filling”
        </Button>
      </div>
    </FieldSet>
  </div>
</template>
