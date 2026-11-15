<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <h1 class="text-2xl font-semibold">
    You don't have access to this page
  </h1>
  <p class="mt-2 text-muted-foreground">
    Your role doesn't include it. If you need it, ask an admin.
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
