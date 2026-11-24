<script setup lang="ts">
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon, TrashIcon, XIcon } from '@lucide/vue';
import { recipeListQuerySchema } from '@myli/shared';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { until } from '@vueuse/core';
import { computed, nextTick, ref, useTemplateRef, watchEffect } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { ApiProblem } from '@/api/problem.ts';
import { useRetry } from '@/api/retry.ts';
import CollectionNameForm from '@/collections/CollectionNameForm.vue';
import {
  collectionKey,
  collectionQuery,
  type MoveDirection,
  recipeCountText,
  useDeleteCollection,
  useMoveInCollection,
  useRenameCollection,
  useSetInCollection,
} from '@/collections/collections.ts';
import PageLinks from '@/components/PageLinks.vue';
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
import { useFocusAfterPaging } from '@/lib/paging.ts';
import RecipeCard from '@/recipes/RecipeCard.vue';
import { documentTitle } from '@/router.ts';

/**
 * One of the reader's collections (spec §3.3): its recipes in their order, which they change, a
 * page at a time, the page in the address (`?page=2`), and renaming or deleting it. No one else
 * sees it.
 */
const props = defineProps<{ id: string }>();

const route = useRoute();
/** The page the address asks for, or the first, if it asks for none or for one that can't be. */
const page = computed(() => recipeListQuerySchema.safeParse(route.query).data?.page ?? 1);
const query = useQuery(computed(() => collectionQuery(props.id, page.value)));
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
  queryClient.removeQueries({ queryKey: collectionKey(props.id) });
}

const pageLink = (to: number) => ({ query: to > 1 ? { page: String(to) } : {} });
const count = useTemplateRef('count');
const { paged } = useFocusAfterPaging(() => collection.value?.page, count);

/** Whether the recipe at `index` on this page is first or last of all, so it can't move that way. */
function atEnd(index: number, direction: MoveDirection) {
  const shown = collection.value;
  if (!shown) return true;
  return direction === 'earlier'
    ? shown.page === 1 && index === 0
    : shown.page >= shown.totalPages && index === shown.recipes.length - 1;
}

/** Once the page shows the recipe, fetched again, focuses the element with this ID. */
async function focusWhenShown(elementId: string, recipeId: string) {
  await until(
    computed(
      () =>
        !query.isFetching.value &&
        collection.value?.recipes.some((recipe) => recipe.id === recipeId) === true,
    ),
  ).toBe(true, { timeout: 10_000 });
  await focusById(elementId);
}

const move = useMoveInCollection();

/**
 * Moves a recipe one place earlier or later. From either end of a page, that's onto the page next
 * to it, which then shows. Focus stays on the button pressed, which moves with it.
 */
async function moveRecipe(index: number, direction: MoveDirection) {
  const shown = collection.value;
  const recipe = shown?.recipes[index];
  if (!shown || !recipe || move.isPending.value || atEnd(index, direction)) return;
  starting();
  try {
    await move.mutateAsync({ id: props.id, recipeId: recipe.id, direction });
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  if (direction === 'earlier' && index === 0) {
    await router.push(pageLink(shown.page - 1));
  } else if (direction === 'later' && index === shown.recipes.length - 1) {
    await router.push(pageLink(shown.page + 1));
  }
  await focusWhenShown(`${direction}-${recipe.id}`, recipe.id);
}

const takeOut = useSetInCollection();

/**
 * It's gone from the list, and its buttons with it: focus goes to the heading. Taking out the last
 * on a page goes back to the page before, which has some.
 */
async function removeRecipe(recipeId: string, title: string) {
  if (takeOut.isPending.value) return;
  starting();
  try {
    await takeOut.mutateAsync({ id: props.id, recipeId, inIt: false });
    notice.value = `Took “${title}” out of this collection.`;
  } catch (error) {
    failure.value = failureMessage(error);
  }
  const shown = collection.value;
  if (shown?.recipes.length === 0 && shown.total > 0) {
    await router.replace(pageLink(shown.totalPages));
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

    <!-- Focused after going to another page. -->
    <p
      ref="count"
      tabindex="-1"
      class="mt-6 w-fit rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {{ recipeCountText(collection.total) }}
    </p>
    <ol
      v-if="collection.recipes.length > 0"
      aria-label="Recipes in this collection"
      :aria-busy="query.isPlaceholderData.value || undefined"
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
            :aria-disabled="atEnd(index, 'earlier') || undefined"
            @click="moveRecipe(index, 'earlier')"
          >
            <ArrowLeftIcon aria-hidden="true" />
            Move earlier<span class="sr-only">: {{ recipe.title }}</span>
          </Button>
          <Button
            :id="`later-${recipe.id}`"
            variant="ghost"
            size="xs"
            class="aria-disabled:opacity-50"
            :aria-disabled="atEnd(index, 'later') || undefined"
            @click="moveRecipe(index, 'later')"
          >
            <ArrowRightIcon aria-hidden="true" />
            Move later<span class="sr-only">: {{ recipe.title }}</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger as-child>
              <Button
                variant="ghost"
                size="xs"
              >
                <XIcon aria-hidden="true" />
                Take out<span class="sr-only">: {{ recipe.title }}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Take “{{ recipe.title }}” out of this collection?</AlertDialogTitle>
                <AlertDialogDescription>
                  The recipe stays as it is. Adding it again puts it at the end.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  @click="removeRecipe(recipe.id, recipe.title)"
                >
                  Take out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </li>
    </ol>
    <p
      v-else-if="collection.total > 0"
      class="mt-4 text-sm"
    >
      There are no recipes on this page.
      <RouterLink
        :to="pageLink(1)"
        class="font-medium underline underline-offset-4"
      >
        Go to the first page
      </RouterLink>
    </p>
    <p
      v-else
      class="mt-4 text-sm text-muted-foreground"
    >
      Choose Collections on a recipe’s page to add it here.
    </p>

    <PageLinks
      :page="collection.page"
      :total-pages="collection.totalPages"
      :link="pageLink"
      @go="paged"
    />
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
