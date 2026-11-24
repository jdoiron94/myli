<script setup lang="ts">
import { ChevronDownIcon, FolderIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { failureMessage } from '@/api/failure.ts';
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
 * Puts a recipe in the reader's collections, or takes it out: one checked item each. Shown only to
 * whoever may keep collections, since the API refuses anyone else.
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

const newCollection = useRouter().resolve({ name: 'collections' });
const { selected, closeAutoFocus } = useMenuNavigation();
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
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
      @close-auto-focus="closeAutoFocus"
    >
      <DropdownMenuLabel>Keep it in</DropdownMenuLabel>
      <template v-if="loaded">
        <DropdownMenuCheckboxItem
          v-for="collection in loaded.collections"
          :key="collection.id"
          :model-value="loaded.holding.has(collection.id)"
          @update:model-value="(inIt) => toggle(collection, inIt)"
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
</template>
