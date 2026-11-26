<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import ImportRecipeForm from '@/recipes/ImportRecipeForm.vue';
import type { ImportRecipeResult } from '@/recipes/import.ts';
import RecipeForm from '@/recipes/RecipeForm.vue';
import type { Recipe } from '@/recipes/recipe.ts';

const router = useRouter();

function open(recipe: Recipe) {
  void router.push({ name: 'recipe', params: { id: recipe.id } });
}

/** The recipe imported last, which the form below opens with, in place of what it held. */
const imported = shallowRef<ImportRecipeResult>();
/** Each import opens the form afresh. */
const imports = ref(0);

function fillIn(result: ImportRecipeResult) {
  imported.value = result;
  imports.value += 1;
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    New recipe
  </h1>
  <ImportRecipeForm
    class="mt-6"
    @imported="fillIn"
  />
  <p
    role="status"
    class="mt-4 text-sm empty:hidden"
  >
    <template v-if="imported">
      Filled in from {{ imported.recipe.source.title ?? 'the page' }}. Check it before creating the
      recipe{{ imported.recipe.servings === null ? ', and say how many it serves' : '' }}.
    </template>
  </p>
  <RecipeForm
    :key="imports"
    class="mt-6"
    :imported="imported"
    @saved="open"
  />
</template>
