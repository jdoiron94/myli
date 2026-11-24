<script setup lang="ts">
import { ChevronDownIcon, FolderIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, useTemplateRef } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMenuNavigation } from '@/lib/menu-navigation.ts';
import {
  type CollectionSummary,
  collectionsQuery,
  recipeCollectionsQuery,
  useSetInCollection,
} from './collections.ts';

/**
 * Puts a recipe in the reader's collections, or takes it out once they confirm: one checked item
 * each. Shown only to whoever may keep collections, since the API refuses anyone else.
 */
const props = defineProps<{ recipeId: string }>();
const emit = defineEmits<{ done: [message: string]; failed: [message: string] }>();

const collections = useQuery(collectionsQuery);
const holding = useQuery(computed(() => recipeCollectionsQuery(props.recipeId)));
const loaded = computed(() =>
  collections.data.value && holding.data.value
    ? { collections: collections.data.value, holding: new Set(holding.data.value) }
    : undefined,
);

const setIn = useSetInCollection();

async function toggle(collection: CollectionSummary, inIt: boolean) {
  if (setIn.isPending.value) return;
  try {
    await setIn.mutateAsync({ id: collection.id, recipeId: props.recipeId, inIt });
  } catch (error) {
    emit('failed', failureMessage(error));
    return;
  }
  emit('done', inIt ? `Added to “${collection.name}”.` : `Taken out of “${collection.name}”.`);
}

/** The collection whose item was unchecked, while the menu closes. */
const unchecked = ref<CollectionSummary>();
/** The collection to take the recipe out of once confirmed, and whether that's being asked. */
const confirming = ref<CollectionSummary>();
const asking = ref(false);

function check(collection: CollectionSummary, inIt: boolean) {
  if (inIt) void toggle(collection, true);
  else unchecked.value = collection;
}

const newCollection = useRouter().resolve({ name: 'collections' });
const { selected, closeAutoFocus } = useMenuNavigation();

/** Asks only once the menu has gone, so the menu and the dialog never both hold focus. */
function menuClosed(event: Event) {
  closeAutoFocus(event);
  if (!unchecked.value) return;
  confirming.value = unchecked.value;
  unchecked.value = undefined;
  asking.value = true;
}

const trigger = useTemplateRef<{ $el: HTMLElement }>('trigger');

/** The dialog has no trigger of its own: focus goes back to the menu's. */
function dialogClosed(event: Event) {
  event.preventDefault();
  trigger.value?.$el.focus();
}

async function takeOut() {
  if (confirming.value) await toggle(confirming.value, false);
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        ref="trigger"
        variant="outline"
        size="sm"
      >
        <FolderIcon aria-hidden="true" />
        Collections
        <ChevronDownIcon aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      class="w-auto min-w-48"
      @close-auto-focus="menuClosed"
    >
      <DropdownMenuLabel>Keep it in</DropdownMenuLabel>
      <template v-if="loaded">
        <DropdownMenuCheckboxItem
          v-for="collection in loaded.collections"
          :key="collection.id"
          :model-value="loaded.holding.has(collection.id)"
          @update:model-value="(inIt) => check(collection, inIt)"
        >
          {{ collection.name }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem
          v-if="loaded.collections.length === 0"
          disabled
        >
          No collections yet
        </DropdownMenuItem>
      </template>
      <DropdownMenuItem
        v-else
        disabled
      >
        Loading…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        as-child
        @select="selected(newCollection)"
      >
        <RouterLink :to="newCollection.fullPath">
          New collection…
        </RouterLink>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <AlertDialog v-model:open="asking">
    <AlertDialogContent @close-auto-focus="dialogClosed">
      <AlertDialogHeader>
        <AlertDialogTitle>Take it out of “{{ confirming?.name }}”?</AlertDialogTitle>
        <AlertDialogDescription>
          The recipe stays as it is. Adding it again puts it at the end.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          @click="takeOut"
        >
          Take out
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
