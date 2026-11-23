<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { nextTick, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type TrashedRecipe, trashQuery, useRestoreFromTrash } from '@/recipes/trash.ts';

/**
 * The trash (spec §3.2): the deleted recipes the reader may restore, and when each goes for good.
 * Restoring needs no confirmation, since it takes nothing away.
 */

const trash = useQuery(trashQuery);
const { failure, retrying, stillFailing, retry } = useRetry(trash);

const deletedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const purgeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** The recipe the last restore brought back, which the status links to. */
const restored = ref<{ id: string; title: string }>();
/** Why the last restore failed. */
const restoreFailure = ref<string>();

function failureFor(error: unknown, { title }: TrashedRecipe) {
  if (error instanceof ApiProblem && error.status === 404) {
    return `“${title}” isn’t in the trash any more.`;
  }
  // Its version changed, which only restoring and deleting it again does.
  if (error instanceof ApiProblem && error.status === 412) {
    return `Someone restored “${title}” and deleted it again meanwhile. Try again if you still want it back.`;
  }
  return failureMessage(error);
}

const heading = useTemplateRef('heading');

/** After its row is gone, focus would be nowhere. It starts on the page again instead. */
async function keepFocus() {
  await nextTick();
  if (heading.value && (!document.activeElement || document.activeElement === document.body)) {
    heading.value.tabIndex = -1;
    heading.value.focus();
  }
}

const restore = useRestoreFromTrash();

async function restoreRecipe(recipe: TrashedRecipe) {
  if (restore.isPending.value) return;
  restored.value = undefined;
  restoreFailure.value = undefined;
  try {
    await restore.mutateAsync({ id: recipe.id, version: recipe.version });
    restored.value = { id: recipe.id, title: recipe.title };
  } catch (error) {
    restoreFailure.value = failureFor(error, recipe);
  }
  await keepFocus();
}
</script>

<template>
  <h1
    ref="heading"
    class="text-2xl font-semibold"
  >
    Trash
  </h1>
  <p class="mt-2 text-muted-foreground">
    The deleted recipes you can restore. Each comes back as it was, for everyone who could see it.
    <template v-if="trash.data.value">
      After {{ trash.data.value.retentionDays }} days in the trash, it's deleted for good, with its
      history and photos.
    </template>
  </p>

  <!-- Always there, so screen readers announce what it says as it changes. -->
  <p
    role="status"
    class="mt-4 text-sm"
  >
    <template v-if="restored">
      Restored “{{ restored.title }}”.
      <RouterLink
        :to="{ name: 'recipe', params: { id: restored.id } }"
        class="font-medium underline underline-offset-4"
      >
        Go to the recipe
      </RouterLink>
    </template>
  </p>
  <p
    v-if="restoreFailure"
    role="alert"
    class="mt-2 text-sm text-destructive"
  >
    {{ restoreFailure }}
  </p>

  <div
    v-if="trash.data.value"
    class="mt-4"
  >
    <p v-if="trash.data.value.recipes.length === 0">
      The trash is empty.
    </p>
    <Table v-else>
      <TableCaption class="sr-only">
        Deleted recipes, most recently deleted first
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Recipe</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Deleted</TableHead>
          <TableHead>Deleted for good</TableHead>
          <TableHead>
            <span class="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="recipe in trash.data.value.recipes"
          :key="recipe.id"
        >
          <TableCell class="font-medium">
            {{ recipe.title }}
          </TableCell>
          <TableCell>{{ recipe.owner.name }}</TableCell>
          <TableCell>
            <time :datetime="recipe.deletedAt">{{
              deletedFormat.format(new Date(recipe.deletedAt))
            }}</time>
          </TableCell>
          <TableCell>
            <time :datetime="recipe.purgeAt">{{
              purgeFormat.format(new Date(recipe.purgeAt))
            }}</time>
          </TableCell>
          <TableCell>
            <div class="flex justify-end">
              <!-- Its name says which recipe, and starts with the visible text, so voice control
                   finds it by that (WCAG 2.5.3). -->
              <Button
                variant="outline"
                size="sm"
                class="aria-disabled:opacity-50"
                :aria-label="`Restore ${recipe.title}`"
                :aria-disabled="restore.isPending.value ? true : undefined"
                @click="restoreRecipe(recipe)"
              >
                Restore
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
  <RetryableFailure
    v-else-if="failure"
    class="mt-4"
    :error="failure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else
    role="status"
    class="mt-4 text-muted-foreground"
  >
    Loading the trash…
  </p>
</template>
