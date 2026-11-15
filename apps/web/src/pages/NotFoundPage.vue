<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <main>
    <h1>Page not found</h1>
    <p>There's nothing at this address.</p>
    <p>
      <RouterLink :to="{ name: 'home' }">Go to the home page</RouterLink>
    </p>
  </main>
</template>
