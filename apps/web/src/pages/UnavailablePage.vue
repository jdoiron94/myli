<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { safeRedirect } from '@/auth/redirect.ts';
import { Button } from '@/components/ui/button';

const route = useRoute();
const router = useRouter();
const trying = ref(false);
const stillUnavailable = ref(false);

/** Goes back to the page they asked for, which fetches the session again on the way. */
async function tryAgain() {
  if (trying.value) return;
  trying.value = true;
  stillUnavailable.value = false;
  try {
    await router.replace(safeRedirect(route.query.redirect));
  } finally {
    trying.value = false;
    // Sent back here: the session couldn't be fetched this time either.
    stillUnavailable.value = router.currentRoute.value.name === 'unavailable';
  }
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Can't reach myli
  </h1>
  <p class="mt-2 text-muted-foreground">
    myli's server isn't answering. It may be restarting.
  </p>
  <Button
    class="mt-6 aria-disabled:opacity-50"
    :aria-disabled="trying ? true : undefined"
    @click="tryAgain"
  >
    {{ trying ? 'Trying again…' : 'Try again' }}
  </Button>
  <p
    role="status"
    class="mt-4 text-sm"
  >
    {{ stillUnavailable ? 'Still no answer. Try again in a moment.' : '' }}
  </p>
</template>
