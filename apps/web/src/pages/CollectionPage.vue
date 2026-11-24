<script setup lang="ts">
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon, TrashIcon, XIcon } from '@lucide/vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import CollectionNameForm from '@/collections/CollectionNameForm.vue';
import {
  collectionQuery,
  recipeCountText,
  useDeleteCollection,
  useRenameCollection,
  useReorderCollection,
  useSetInCollection,
} from '@/collections/collections.ts';
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
import { goWithNotice } from '@/lib/page-notice.ts';
import RecipeCard from '@/recipes/RecipeCard.vue';
import { documentTitle } from '@/router.ts';

/**
 * One of the reader's collections (spec §3.3): its recipes in their order, which they change, and
 * renaming or deleting it. No one else sees it.
 */
const props = defineProps<{ id: string }>();

const query = useQuery(computed(() => collectionQuery(props.id)));
const { failure: loadFailure, retrying, stillFailing, retry } = useRetry(query);
const collection = computed(() => query.data.value);

/** The API answers 404 alike for a collection that doesn't exist and someone else's. */
const notFound = computed(
  () => loadFailure.value instanceof ApiProblem && loadFailure.value.status === 404,
);
const heading = computed(() => {
  if (collection.value) return collection.value.name;
  return notFound.value ? 'Collection not found' : 'Collection';
});

const route = useRoute();
watchEffect(() => {
  // Only while this page is the current one: the router sets the next page's title as it leaves.
  if (route.name === 'collection' && (collection.value || notFound.value)) {
    document.title = documentTitle(heading.value);
  }
});

/** What happened, like a recipe taken out, and why a change failed. */
const notice = ref<string>();
const failure = ref<string>();
const headingElement = useTemplateRef('heading-element');

function starting() {
  notice.value = undefined;
  failure.value = undefined;
}

async function focusById(id: string) {
  await nextTick();
  document.getElementById(id)?.focus();
}

const renaming = ref(false);
const rename = useRenameCollection();

async function saveName(name: string) {
  starting();
  await rename.mutateAsync({ id: props.id, name });
  notice.value = `Renamed “${name}”.`;
  stopRenaming();
}

/** Back to the page, focus on its Rename button, which the form replaced. */
function stopRenaming() {
  renaming.value = false;
  void focusById('rename-collection');
}

const router = useRouter();
const queryClient = useQueryClient();
const remove = useDeleteCollection();

/** The collections, which say it's deleted: this page has nothing to show. */
async function deleteCollection() {
  if (remove.isPending.value || !collection.value) return;
  const { name } = collection.value;
  starting();
  try {
    await remove.mutateAsync(props.id);
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  await goWithNotice(router, { name: 'collections' }, `Deleted “${name}”.`);
  queryClient.removeQueries({ queryKey: collectionQuery(props.id).queryKey });
}

const reorder = useReorderCollection();

/**
 * Moves a recipe one place earlier or later. Focus stays on the button pressed, which moves with
 * it, once the collection has been fetched again.
 */
async function move(index: number, by: -1 | 1) {
  const recipes = collection.value?.recipes;
  const to = index + by;
  if (!recipes || reorder.isPending.value || to < 0 || to >= recipes.length) return;
  const ids = recipes.map((recipe) => recipe.id);
  const [moved] = ids.splice(index, 1);
  if (moved === undefined) return;
  ids.splice(to, 0, moved);
  starting();
  try {
    await reorder.mutateAsync({ id: props.id, recipeIds: ids });
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  await focusById(`${by < 0 ? 'earlier' : 'later'}-${moved}`);
}

const takeOut = useSetInCollection();

/** It's gone from the list, and its buttons with it: focus goes to the heading. */
async function removeRecipe(recipeId: string, title: string) {
  if (takeOut.isPending.value) return;
  starting();
  try {
    await takeOut.mutateAsync({ id: props.id, recipeId, inIt: false });
    notice.value = `Took “${title}” out of this collection.`;
  } catch (error) {
    failure.value = failureMessage(error);
  }
  headingElement.value?.focus();
}
</script>

<template>
  <h1
    ref="heading-element"
    tabindex="-1"
    class="text-2xl font-semibold break-words outline-none"
  >
    {{ heading }}
  </h1>

  <template v-if="collection">
    <CollectionNameForm
      v-if="renaming"
      class="mt-4"
      label="Name"
      submit-label="Save name"
      :initial="collection.name"
      :save="saveName"
      cancellable
      @cancel="stopRenaming"
    />
    <div
      v-else
      class="mt-4 flex flex-wrap gap-2"
    >
      <Button
        id="rename-collection"
        variant="outline"
        size="sm"
        @click="renaming = true"
      >
        <PencilIcon aria-hidden="true" />
        Rename
      </Button>
      <AlertDialog>
        <AlertDialogTrigger as-child>
          <Button
            variant="outline"
            size="sm"
          >
            <TrashIcon aria-hidden="true" />
            Delete collection
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{{ collection.name }}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its recipes stay as they are. The collection is gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              @click="deleteCollection"
            >
              Delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

    <!-- Always there, so screen readers announce what they say as it changes. -->
    <p
      role="status"
      class="text-sm not-empty:mt-4"
    >
      {{ notice }}
    </p>
    <p
      v-if="failure"
      role="alert"
      class="mt-4 text-sm text-destructive"
    >
      {{ failure }}
    </p>

    <p class="mt-6 text-sm font-medium">
      {{ recipeCountText(collection.recipes.length) }}
    </p>
    <ol
      v-if="collection.recipes.length > 0"
      aria-label="Recipes in this collection"
      class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <li
        v-for="(recipe, index) in collection.recipes"
        :key="recipe.id"
        class="flex flex-col gap-2"
      >
        <RecipeCard
          class="flex-1"
          :recipe="recipe"
        />
        <!-- Every card has these: the hidden part of each name says which recipe it's for. Only
             aria-disabled at either end, so a button pressed to get there keeps focus. -->
        <div class="flex flex-wrap gap-1">
          <Button
            :id="`earlier-${recipe.id}`"
            variant="ghost"
            size="xs"
            class="aria-disabled:opacity-50"
            :aria-disabled="index === 0 ? true : undefined"
            @click="move(index, -1)"
          >
            <ArrowLeftIcon aria-hidden="true" />
            Move earlier<span class="sr-only">: {{ recipe.title }}</span>
          </Button>
          <Button
            :id="`later-${recipe.id}`"
            variant="ghost"
            size="xs"
            class="aria-disabled:opacity-50"
            :aria-disabled="index === collection.recipes.length - 1 ? true : undefined"
            @click="move(index, 1)"
          >
            <ArrowRightIcon aria-hidden="true" />
            Move later<span class="sr-only">: {{ recipe.title }}</span>
          </Button>
          <Button
            variant="ghost"
            size="xs"
            @click="removeRecipe(recipe.id, recipe.title)"
          >
            <XIcon aria-hidden="true" />
            Take out<span class="sr-only">: {{ recipe.title }}</span>
          </Button>
        </div>
      </li>
    </ol>
    <p
      v-else
      class="mt-4 text-sm text-muted-foreground"
    >
      Choose Collections on a recipe’s page to add it here.
    </p>
  </template>

  <p
    v-else-if="notFound"
    class="mt-2 text-muted-foreground"
  >
    This collection doesn't exist, or was deleted.
  </p>
  <RetryableFailure
    v-else-if="loadFailure"
    class="mt-4"
    :error="loadFailure"
    :retrying="retrying"
    :still-failing="stillFailing"
    @retry="retry"
  />
  <p
    v-else
    class="mt-2 text-muted-foreground"
  >
    Loading the collection…
  </p>
</template>
