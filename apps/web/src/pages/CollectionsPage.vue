<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { nextTick, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useRetry } from '@/api/retry.ts';
import CollectionNameForm from '@/collections/CollectionNameForm.vue';
import {
  collectionsQuery,
  recipeCountText,
  useCreateCollection,
} from '@/collections/collections.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { pageNotice } from '@/lib/page-notice.ts';

/** The reader's collections (spec §3.3), which no one else sees, and a new one. */
const query = useQuery(collectionsQuery);
const { failure, retrying, stillFailing, retry } = useRetry(query);

const router = useRouter();
/** What happened, starting with what the page that sent someone here said, like a deletion. */
const notice = ref(pageNotice(router));

const create = useCreateCollection();

/** Created, it's in the list, which has been fetched again by then: focus goes to it. */
async function save(name: string) {
  notice.value = undefined;
  const created = await create.mutateAsync(name);
  notice.value = `Created “${created.name}”.`;
  await nextTick();
  document.getElementById(`collection-${created.id}`)?.focus();
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Collections
  </h1>
  <p class="mt-2 text-sm text-muted-foreground">
    Only you can see your collections. Add a recipe to one from its page.
  </p>

  <RetryableFailure
    v-if="failure"
    class="mt-6"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else-if="!query.data.value"
    class="mt-6 text-sm text-muted-foreground"
  >
    Loading your collections…
  </p>
  <ul
    v-else-if="query.data.value.length > 0"
    aria-label="Collections"
    class="mt-6 divide-y rounded-md border"
  >
    <li
      v-for="collection in query.data.value"
      :key="collection.id"
      class="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3"
    >
      <RouterLink
        :id="`collection-${collection.id}`"
        :to="{ name: 'collection', params: { id: collection.id } }"
        class="font-medium underline-offset-4 hover:underline"
      >
        {{ collection.name }}
      </RouterLink>
      <span class="text-sm text-muted-foreground">{{ recipeCountText(collection.recipeCount) }}</span>
    </li>
  </ul>
  <p
    v-else
    class="mt-6 text-sm text-muted-foreground"
  >
    No collections yet.
  </p>

  <!-- Always there, so screen readers announce what it says as it changes. -->
  <p
    role="status"
    class="text-sm not-empty:mt-4"
  >
    {{ notice }}
  </p>

  <section
    aria-labelledby="new-collection-heading"
    class="mt-10"
  >
    <h2
      id="new-collection-heading"
      class="mb-4 text-xl font-semibold"
    >
      New collection
    </h2>
    <CollectionNameForm
      label="Name"
      submit-label="Create collection"
      :save="save"
    />
  </section>
</template>
