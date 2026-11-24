<script setup lang="ts">
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import NoteForm from './NoteForm.vue';
import { recipeNoteQuery } from './notes.ts';
import type { Recipe } from './recipe.ts';

/**
 * The reader's personal note on a recipe (spec §3.3), for whoever may keep one: no one else ever
 * sees it. It's asked for only then, since the API refuses anyone else. Not printed.
 */
const props = defineProps<{ recipe: Pick<Recipe, 'id' | 'owner' | 'visibility'> }>();

const { data: user } = useQuery(sessionQuery);
const canNote = computed(() =>
  can(user.value ?? null, 'recipe.interact', {
    ownerId: props.recipe.owner.id,
    visibility: props.recipe.visibility,
  }),
);
const query = useQuery(
  computed(() => ({ ...recipeNoteQuery(props.recipe.id), enabled: canNote.value })),
);
const { failure, retrying, stillFailing, retry } = useRetry(query);

/** What happened, like the note saved. */
const notice = ref<string>();
const heading = useTemplateRef('heading');

/** Its Delete button is gone with it: focus goes to the heading. */
async function deleted() {
  notice.value = 'Note deleted.';
  await nextTick();
  heading.value?.focus();
}
</script>

<template>
  <section
    v-if="canNote"
    aria-labelledby="note-heading"
    class="mt-12 max-w-prose print:hidden"
  >
    <h2
      id="note-heading"
      ref="heading"
      tabindex="-1"
      class="mb-4 text-xl font-semibold outline-none"
    >
      Your note
    </h2>
    <RetryableFailure
      v-if="failure"
      :error="failure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <NoteForm
      v-else-if="query.data.value !== undefined"
      :recipe-id="recipe.id"
      :note="query.data.value"
      @saved="notice = 'Note saved.'"
      @deleted="deleted"
      @changing="notice = undefined"
    />
    <p
      v-else
      class="text-muted-foreground"
    >
      Loading your note…
    </p>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="text-sm not-empty:mt-4"
    >
      {{ notice }}
    </p>
  </section>
</template>
