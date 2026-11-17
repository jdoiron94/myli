<script setup lang="ts">
import { useRouter } from 'vue-router';
import RecipeForm from '@/recipes/RecipeForm.vue';
import type { Recipe } from '@/recipes/recipe.ts';

const router = useRouter();

function open(recipe: Recipe) {
  void router.push({ name: 'recipe', params: { id: recipe.id } });
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    New recipe
  </h1>
  <RecipeForm
    class="mt-6"
    @saved="open"
  />
</template>
