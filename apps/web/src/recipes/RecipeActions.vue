<script setup lang="ts">
import {
  ChefHatIcon,
  HeartIcon,
  HistoryIcon,
  LockIcon,
  PencilIcon,
  PrinterIcon,
  TrashIcon,
  UsersIcon,
} from '@lucide/vue';
import { can, type RecipeAction } from '@myli/shared';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { sessionQuery } from '@/auth/session.ts';
import CollectionsMenu from '@/collections/CollectionsMenu.vue';
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
import { goWithNotice, pageNotice } from '@/lib/page-notice.ts';
import { favoriteQuery, useSetFavorite } from './favorites.ts';
import PublicLinkDialog from './PublicLinkDialog.vue';
import { publicLinkKey, publicLinkQuery } from './public-links.ts';
import {
  type Recipe,
  recipeDraftQuery,
  recipeQuery,
  staleRecipe,
  useChangeVisibility,
  useDeleteRecipe,
} from './recipe.ts';
import { servingsQuery } from './servings.ts';

/**
 * What the reader may do with a recipe: cook it, print it or see its history, which anyone who sees
 * it may, and by the policy, keep it as a favorite or in collections, edit it, change who sees it,
 * delete it. None of it is printed.
 */
const props = defineProps<{ recipe: Recipe }>();

const { data: user } = useQuery(sessionQuery);
const allowed = (action: RecipeAction) =>
  can(user.value ?? null, action, {
    ownerId: props.recipe.owner.id,
    visibility: props.recipe.visibility,
  });
const canFavorite = computed(() => allowed('recipe.interact'));
const canEdit = computed(() => allowed('recipe.edit'));
const canSetVisibility = computed(() => allowed('recipe.setVisibility'));
const canDelete = computed(() => allowed('recipe.trash'));
const canShare = computed(() => allowed('recipe.share'));
const shared = computed(() => props.recipe.visibility === 'shared');

// Only asked by someone who may share it. Making it private takes the link away, which its
// confirmation says.
const publicLink = useQuery(
  computed(() => ({ ...publicLinkQuery(props.recipe.id), enabled: canShare.value })),
);
const privateWarning = computed(() =>
  canShare.value && publicLink.data.value
    ? 'Nobody but you will see it, not even admins, and its public link stops working for good. You can share it again later.'
    : 'Nobody but you will see it, not even admins. You can share it again later.',
);

// Whoever may edit the recipe may continue its draft, so they're told there is one.
const draftQuery = useQuery(
  computed(() => ({ ...recipeDraftQuery(props.recipe.id), enabled: canEdit.value })),
);
const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const draftNote = computed(() => {
  const draft = draftQuery.data.value;
  if (!draft || !canEdit.value) return undefined;
  const who = draft.author.id === user.value?.id ? 'You' : draft.author.name;
  return `${who} saved a draft of this recipe on ${savedFormat.format(new Date(draft.updatedAt))}, not published yet.`;
});

// Cook mode opens at the servings chosen here, which are in the address.
const route = useRoute();
const cookLink = computed(() => ({
  name: 'cook',
  params: { id: props.recipe.id },
  query: servingsQuery(route.query),
}));

/** The browser's own dialog, which prints the page with the print stylesheet, or saves a PDF. */
function print() {
  window.print();
}

const router = useRouter();
/** What happened, starting with what the page that sent someone here said, like a discarded draft. */
const notice = ref(pageNotice(router));
const failure = ref<string>();

// Only asked by someone who may keep it, and the button shows once it's known.
const favorite = useQuery(
  computed(() => ({ ...favoriteQuery(props.recipe.id), enabled: canFavorite.value })),
);
const setFavorite = useSetFavorite();

async function toggleFavorite() {
  if (setFavorite.isPending.value || favorite.data.value === undefined) return;
  notice.value = undefined;
  failure.value = undefined;
  try {
    await setFavorite.mutateAsync({ id: props.recipe.id, favorite: !favorite.data.value });
  } catch (error) {
    failure.value = failureMessage(error);
  }
}

/** Why a change failed. One based on an older version leaves the page showing the latest. */
const refusalMessage = (error: unknown) =>
  staleRecipe(error)
    ? 'Someone changed this recipe meanwhile, and it shows their changes now. Try again if you still want to.'
    : failureMessage(error);

const changeVisibility = useChangeVisibility();
const queryClient = useQueryClient();

async function toggleVisibility() {
  if (changeVisibility.isPending.value) return;
  const visibility = shared.value ? 'private' : 'shared';
  notice.value = undefined;
  failure.value = undefined;
  try {
    await changeVisibility.mutateAsync({
      id: props.recipe.id,
      version: props.recipe.version,
      visibility,
    });
  } catch (error) {
    failure.value = refusalMessage(error);
    return;
  }
  // Making it private took its public link away.
  queryClient.removeQueries({ queryKey: publicLinkKey(props.recipe.id) });
  notice.value =
    visibility === 'shared'
      ? 'Shared: everyone on myli can see it now.'
      : 'Private: only you can see it now.';
}

const deleteRecipe = useDeleteRecipe();

/** Home afterwards, which says it's deleted: the recipe's page has nothing to show. */
async function remove() {
  if (deleteRecipe.isPending.value) return;
  const { id, version, title } = props.recipe;
  notice.value = undefined;
  failure.value = undefined;
  try {
    await deleteRecipe.mutateAsync({ id, version });
  } catch (error) {
    failure.value = refusalMessage(error);
    return;
  }
  await goWithNotice(router, { name: 'home' }, `Deleted “${title}”.`);
  queryClient.removeQueries({ queryKey: recipeQuery(id).queryKey });
}
</script>

<template>
  <div class="print:hidden">
    <div class="flex flex-wrap gap-2">
      <Button
        size="sm"
        as-child
      >
        <RouterLink :to="cookLink">
          <ChefHatIcon aria-hidden="true" />
          Cook mode
        </RouterLink>
      </Button>
      <!-- A toggle: its name stays, and it says whether it's on. -->
      <Button
        v-if="canFavorite && favorite.data.value !== undefined"
        variant="outline"
        size="sm"
        :aria-pressed="favorite.data.value"
        @click="toggleFavorite"
      >
        <HeartIcon
          aria-hidden="true"
          :class="{ 'fill-current': favorite.data.value }"
        />
        Favorite
      </Button>
      <CollectionsMenu
        v-if="canFavorite"
        :recipe-id="recipe.id"
        @done="(message) => { failure = undefined; notice = message; }"
        @failed="(message) => { notice = undefined; failure = message; }"
      />
      <Button
        variant="outline"
        size="sm"
        @click="print"
      >
        <PrinterIcon aria-hidden="true" />
        Print
      </Button>
      <Button
        variant="outline"
        size="sm"
        as-child
      >
        <RouterLink :to="{ name: 'recipe-history', params: { id: recipe.id } }">
          <HistoryIcon aria-hidden="true" />
          History
        </RouterLink>
      </Button>
      <Button
        v-if="canEdit"
        variant="outline"
        size="sm"
        as-child
      >
        <RouterLink :to="{ name: 'edit-recipe', params: { id: recipe.id } }">
          <PencilIcon aria-hidden="true" />
          {{ draftNote ? 'Continue draft' : 'Edit recipe' }}
        </RouterLink>
      </Button>

      <PublicLinkDialog
        v-if="canShare"
        :recipe-id="recipe.id"
      />

      <AlertDialog v-if="canSetVisibility">
        <AlertDialogTrigger as-child>
          <Button
            variant="outline"
            size="sm"
          >
            <LockIcon
              v-if="shared"
              aria-hidden="true"
            />
            <UsersIcon
              v-else
              aria-hidden="true"
            />
            {{ shared ? 'Make private' : 'Share with everyone' }}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ shared ? `Make “${recipe.title}” private?` : `Share “${recipe.title}”?` }}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {{
                shared
                  ? privateWarning
                  : 'Everyone on myli will see it, and editors will be able to change it. You can make it private again later.'
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction @click="toggleVisibility">
              {{ shared ? 'Make private' : 'Share' }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog v-if="canDelete">
        <AlertDialogTrigger as-child>
          <Button
            variant="outline"
            size="sm"
          >
            <TrashIcon aria-hidden="true" />
            Delete recipe
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{{ recipe.title }}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It's gone for everyone straight away. You can restore it from the trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              @click="remove"
            >
              Delete recipe
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <p
      v-if="draftNote"
      class="mt-2 text-sm text-muted-foreground"
    >
      {{ draftNote }}
    </p>
    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="text-sm not-empty:mt-2"
    >
      {{ notice }}
    </p>
    <p
      v-if="failure"
      role="alert"
      class="mt-2 text-sm text-destructive"
    >
      {{ failure }}
    </p>
  </div>
</template>
