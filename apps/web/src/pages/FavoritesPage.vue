<script setup lang="ts">
import RecipeListing from '@/recipes/RecipeListing.vue';

/** The reader's favorite recipes, most recently chosen first (spec §3.3), from the database. */
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Favorites
  </h1>

  <RecipeListing
    list="favorites"
    label="Favorites"
    empty-text="No favorites yet."
  >
    <template #empty>
      <p class="mt-4 text-sm text-muted-foreground">
        Choose Favorite on a recipe’s page to keep it here.
      </p>
    </template>
  </RecipeListing>
</template>
