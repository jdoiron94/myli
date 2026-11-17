<script setup lang="ts">
import { useRouter } from 'vue-router';
import { pageNotice } from '@/lib/page-notice.ts';

/** Taken once: what the page that sent someone here said happened. */
const notice = pageNotice(useRouter());
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Recipes
  </h1>
  <p
    role="status"
    class="mt-2 text-sm"
  >
    {{ notice }}
  </p>
  <p class="mt-2 text-muted-foreground">
    Your recipes will be here.
  </p>
</template>
