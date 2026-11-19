<script setup lang="ts">
import type { TagType } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useId } from 'vue';
import MergeTagDialog from '@/admin/MergeTagDialog.vue';
import RenameTagDialog from '@/admin/RenameTagDialog.vue';
import { type ManagedTag, managedTagsQuery, useDeleteTag } from '@/admin/tags.ts';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import RetryableFailure from '@/components/RetryableFailure.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
import type { Tag } from '@/recipes/recipe.ts';

/**
 * Every tag, by type, with how many recipes the admin may see have it (spec §3.2). Admins rename a
 * tag, merge it into another of its type, or delete it. The allergens are a fixed list.
 */

/** Each type, in the order recipe pages show them. */
const TYPES: { type: TagType; heading: string; noun: string }[] = [
  { type: 'cuisine', heading: 'Cuisines', noun: 'cuisine' },
  { type: 'meal_type', heading: 'Meals', noun: 'meal' },
  { type: 'diet', heading: 'Diets', noun: 'diet' },
  { type: 'allergen', heading: 'Allergens', noun: 'allergen' },
  { type: 'custom', heading: 'Other tags', noun: 'other' },
];

const tags = useQuery(managedTagsQuery);
const { failure, retrying, stillFailing, retry } = useRetry(tags);

const byType = computed(() => {
  const groups = new Map<TagType, ManagedTag[]>();
  for (const tag of tags.data.value ?? [])
    groups.set(tag.type, [...(groups.get(tag.type) ?? []), tag]);
  return groups;
});
const othersOf = (tag: Tag) => (byType.value.get(tag.type) ?? []).filter(({ id }) => id !== tag.id);

/** What the last change did. */
const notice = ref('');
/** Why deleting failed. */
const actionFailure = ref<string>();

const idPrefix = useId();
const headingId = (type: TagType) => `${idPrefix}-${type}`;

/** When a tag's row is gone, focus goes to its type's heading, so it stays where it was. */
async function focusHeading(type: TagType) {
  await nextTick();
  document.getElementById(headingId(type))?.focus();
}

const recipeCount = (count: number) => (count === 1 ? '1 recipe' : `${String(count)} recipes`);

function renamed(from: Tag, to: Tag) {
  actionFailure.value = undefined;
  notice.value = `Renamed “${from.name}” to “${to.name}”.`;
}

async function merged(into: Tag, from: Tag) {
  actionFailure.value = undefined;
  notice.value = `Merged “${from.name}” into “${into.name}”.`;
  await focusHeading(from.type);
}

const deleteTag = useDeleteTag();

async function deleteIt(tag: Tag) {
  if (deleteTag.isPending.value) return;
  actionFailure.value = undefined;
  // The row goes once the list is refreshed, before the deletion is done: keep its name.
  tag = { ...tag };
  try {
    await deleteTag.mutateAsync(tag.id);
    notice.value = `Deleted “${tag.name}”.`;
  } catch (error) {
    actionFailure.value = failureMessage(error);
  }
  await focusHeading(tag.type);
}
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Tags
  </h1>
  <p class="mt-2 text-muted-foreground">
    Every tag, by type. Rename a tag, merge it into another of its type, or delete it: the change
    reaches every recipe with it.
  </p>
  <p class="mt-2 text-sm text-muted-foreground">
    Counts include only recipes you can see, not those others keep private.
  </p>
  <!-- Always there, so screen readers announce what it says as it changes. -->
  <p
    role="status"
    class="mt-4 text-sm"
  >
    {{ notice }}
  </p>
  <p
    v-if="actionFailure"
    role="alert"
    class="mt-2 text-sm text-destructive"
  >
    {{ actionFailure }}
  </p>

  <div
    v-if="tags.data.value"
    class="mt-4 space-y-10"
  >
    <section
      v-for="group in TYPES"
      :key="group.type"
      :aria-labelledby="headingId(group.type)"
    >
      <h2
        :id="headingId(group.type)"
        tabindex="-1"
        class="w-fit rounded-md text-xl font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {{ group.heading }}
      </h2>
      <p
        v-if="group.type === 'allergen'"
        class="mt-1 text-sm text-muted-foreground"
      >
        A fixed list: allergens can't be changed.
      </p>
      <p
        v-if="!byType.get(group.type)?.length"
        class="mt-2 text-sm text-muted-foreground"
      >
        No {{ group.noun }} tags yet.
      </p>
      <Table
        v-else
        class="mt-2"
      >
        <TableCaption class="sr-only">
          {{ group.heading }}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Recipes</TableHead>
            <TableHead v-if="group.type !== 'allergen'">
              <span class="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="tag in byType.get(group.type)"
            :key="tag.id"
          >
            <TableCell class="whitespace-normal">
              {{ tag.name }}
            </TableCell>
            <TableCell>{{ tag.recipes.toLocaleString() }}</TableCell>
            <TableCell v-if="group.type !== 'allergen'">
              <div class="flex justify-end gap-2">
                <RenameTagDialog
                  :tag="tag"
                  @renamed="renamed"
                />
                <MergeTagDialog
                  v-if="othersOf(tag).length > 0"
                  :tag="tag"
                  :others="othersOf(tag)"
                  :on-merged="merged"
                />
                <AlertDialog>
                  <AlertDialogTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      :aria-label="`Delete ${tag.name}`"
                    >
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{{ tag.name }}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It comes off every recipe that has it: {{ recipeCount(tag.recipes) }} you
                        can see, and any that others keep private. This can't be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        @click="deleteIt(tag)"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>
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
    Loading tags…
  </p>
</template>
