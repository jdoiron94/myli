<script setup lang="ts">
import { RefreshCwIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import {
  type RebuildState,
  searchIndexQuery,
  useRebuildSearchIndex,
} from '@/admin/search-index.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';

const askedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const status = useQuery(searchIndexQuery);
const { failure, retrying, stillFailing, retry } = useRetry(status);
const rebuild = useRebuildSearchIndex();
/** Why asking for a rebuild failed. */
const rebuildFailure = ref('');

const REBUILD_TEXT: Readonly<Record<RebuildState, (asked: string) => string>> = {
  queued: (asked) => `A rebuild asked for ${asked} is waiting to start.`,
  running: (asked) => `Rebuilding now, as asked for ${asked}. Search keeps working meanwhile.`,
  retrying: (asked) =>
    `A rebuild asked for ${asked} is waiting for search to be available, and will try again by itself.`,
  succeeded: (asked) => `The last rebuild, asked for ${asked}, finished.`,
  failed: (asked) => `The last rebuild, asked for ${asked}, failed. The API’s log says why.`,
};

const rebuildText = computed(() => {
  const latest = status.data.value?.rebuild;
  if (!latest) return 'There hasn’t been a rebuild yet.';
  return REBUILD_TEXT[latest.state](askedFormat.format(new Date(latest.queuedAt)));
});

async function startRebuild() {
  if (rebuild.isPending.value) return;
  rebuildFailure.value = '';
  try {
    await rebuild.mutateAsync();
  } catch (error) {
    rebuildFailure.value = failureMessage(error);
  }
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Search index
  </h1>
  <p class="mt-2 max-w-prose text-muted-foreground">
    Search reads from an index that’s kept in step with the recipes as they change. Should search
    ever miss a recipe, rebuild the index from the recipes themselves. Search keeps working
    meanwhile.
  </p>

  <!-- What was loaded stays, should checking again fail. -->
  <template v-if="status.data.value">
    <!-- Announced as it changes, as a rebuild goes on. -->
    <div
      role="status"
      class="mt-6 max-w-prose space-y-1 text-sm"
    >
      <p>
        {{
          status.data.value.available
            ? 'Search is working.'
            : 'Search is unavailable right now. Everything else works, and search comes back by itself once it can be reached.'
        }}
      </p>
      <p>{{ rebuildText }}</p>
    </div>
    <Button
      class="mt-4"
      :aria-disabled="rebuild.isPending.value || undefined"
      @click="startRebuild"
    >
      <RefreshCwIcon aria-hidden="true" />
      Rebuild index
    </Button>
    <p
      role="alert"
      class="mt-2 text-sm text-destructive"
    >
      {{ rebuildFailure }}
    </p>
  </template>
  <RetryableFailure
    v-else-if="failure"
    class="mt-6"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else
    class="mt-6 text-sm text-muted-foreground"
  >
    Loading…
  </p>
</template>
