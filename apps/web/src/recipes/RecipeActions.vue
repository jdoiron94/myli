<script setup lang="ts">
import { HeartIcon, LockIcon, PencilIcon, TrashIcon, UsersIcon } from '@lucide/vue';
import { can, type RecipeAction } from '@myli/shared';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import { sessionQuery } from '@/auth/session.ts';
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
import { favoriteQuery, useSetFavorite } from './favorites.ts';
import { type Recipe, recipeQuery, useChangeVisibility, useDeleteRecipe } from './recipe.ts';

/**
 * What the reader may do with a recipe, by the policy: keep it as a favorite, edit it, change who
 * sees it, delete it.
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
const shared = computed(() => props.recipe.visibility === 'shared');

const notice = ref<string>();
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

const changeVisibility = useChangeVisibility();

async function toggleVisibility() {
  if (changeVisibility.isPending.value) return;
  const visibility = shared.value ? 'private' : 'shared';
  notice.value = undefined;
  failure.value = undefined;
  try {
    await changeVisibility.mutateAsync({ id: props.recipe.id, visibility });
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  notice.value =
    visibility === 'shared'
      ? 'Shared: everyone on myli can see it now.'
      : 'Private: only you can see it now.';
}

const deleteRecipe = useDeleteRecipe();
const router = useRouter();
const queryClient = useQueryClient();

/** Home afterwards, which says it's deleted: the recipe's page has nothing to show. */
async function remove() {
  if (deleteRecipe.isPending.value) return;
  const { id, title } = props.recipe;
  notice.value = undefined;
  failure.value = undefined;
  try {
    await deleteRecipe.mutateAsync(id);
  } catch (error) {
    failure.value = failureMessage(error);
    return;
  }
  await goWithNotice(router, { name: 'home' }, `Deleted “${title}”.`);
  queryClient.removeQueries({ queryKey: recipeQuery(id).queryKey });
}
</script>

<template>
  <div v-if="canFavorite || canEdit || canSetVisibility || canDelete">
    <div class="flex flex-wrap gap-2">
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
      <Button
        v-if="canEdit"
        variant="outline"
        size="sm"
        as-child
      >
        <RouterLink :to="{ name: 'edit-recipe', params: { id: recipe.id } }">
          <PencilIcon aria-hidden="true" />
          Edit recipe
        </RouterLink>
      </Button>

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
                  ? 'Nobody but you will see it, not even admins. You can share it again later.'
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
              It's gone for everyone straight away.
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
