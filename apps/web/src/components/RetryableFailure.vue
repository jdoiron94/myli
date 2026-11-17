<script setup lang="ts">
import { onBeforeUnmount, onUnmounted, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { Button } from '@/components/ui/button';

/**
 * Why something couldn't be loaded, and a button to try again. `useRetry` gives the props, and keeps
 * the failure on screen while it's tried again.
 */
defineProps<{
  error: unknown;
  retrying: boolean;
  /** The last try failed too: says so, since the message is the same. */
  stillFailing: boolean;
}>();
defineEmits<{ retry: [] }>();

// Once it worked, the button they pressed is gone. Rather than leave focus nowhere, it starts on the
// page's heading again, as after a navigation (AppLayout).
const root = useTemplateRef('root');
let heading: HTMLElement | null = null;
onBeforeUnmount(() => {
  if (root.value?.contains(document.activeElement)) {
    heading = root.value.closest('main')?.querySelector('h1') ?? null;
  }
});
onUnmounted(() => {
  if (!heading?.isConnected) return;
  heading.tabIndex = -1;
  heading.focus();
});
</script>

<template>
  <div ref="root">
    <p role="alert">
      {{ failureMessage(error) }}
    </p>
    <!-- A button, not a submit, should it be shown inside a form. -->
    <Button
      type="button"
      class="mt-6 aria-disabled:opacity-50"
      :aria-disabled="retrying ? true : undefined"
      @click="$emit('retry')"
    >
      {{ retrying ? 'Trying again…' : 'Try again' }}
    </Button>
    <p
      role="status"
      class="mt-4 text-sm"
    >
      {{ stillFailing ? 'Still not working. Try again in a moment.' : '' }}
    </p>
  </div>
</template>
