<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Page not found
  </h1>
  <p class="mt-2 text-muted-foreground">
    There's nothing at this address.
  </p>
  <p class="mt-4">
    <RouterLink
      :to="{ name: 'home' }"
      class="underline underline-offset-4"
    >
      Go to the home page
    </RouterLink>
  </p>
</template>
