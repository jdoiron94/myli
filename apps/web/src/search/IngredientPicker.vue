<script setup lang="ts">
import { CheckIcon, XIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxRoot,
} from 'reka-ui';
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { ingredientSuggestionsQuery } from './search.ts';

/**
 * The ingredients a search requires (spec §3.4): picked from those recipes use, as suggested while
 * typing, and shown below, each with a button to take it off.
 */
const props = defineProps<{ chosen: string[] }>();
const emit = defineEmits<{ change: [ingredients: string[]] }>();

/** How long typing pauses before the suggestions are asked for. */
const TYPING_PAUSE_MS = 150;

const open = ref(false);
const typed = ref('');
const asked = ref('');
let pause: ReturnType<typeof setTimeout> | undefined;
watch(typed, (value) => {
  clearTimeout(pause);
  pause = setTimeout(() => {
    asked.value = value.trim();
  }, TYPING_PAUSE_MS);
});
onBeforeUnmount(() => {
  clearTimeout(pause);
});

// Asked for only once the list is open: most visits to home never open it.
const suggestions = useQuery(
  computed(() => ({ ...ingredientSuggestionsQuery(asked.value), enabled: open.value })),
);

function choose(value: unknown) {
  emit('change', (value as string[]).slice());
  // Closed and emptied once one is picked, so the list doesn't cover the chosen ones below, and
  // typing starts on the next.
  open.value = false;
  typed.value = '';
}

function remove(name: string) {
  emit(
    'change',
    props.chosen.filter((item) => item !== name),
  );
}

const unit = (count: number) => (count === 1 ? ' recipe' : ' recipes');

const id = useId();
const countId = (name: string) => `${id}-count-${name.replace(/\W/g, '_')}`;
</script>

<template>
  <FieldSet class="gap-2">
    <FieldLegend
      variant="label"
      class="mb-0"
    >
      Ingredients
    </FieldLegend>
    <FieldDescription class="text-xs">
      All of those chosen.
    </FieldDescription>
    <ComboboxRoot
      v-model:open="open"
      :model-value="chosen"
      multiple
      ignore-filter
      open-on-click
      @update:model-value="choose"
    >
      <FieldLabel
        :for="id"
        class="sr-only"
      >
        Add an ingredient
      </FieldLabel>
      <ComboboxAnchor>
        <ComboboxInput
          :id="id"
          v-model="typed"
          placeholder="Like basil, or tofu"
          maxlength="100"
          class="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
      </ComboboxAnchor>
      <!-- In place, not in a portal, so it's in the main landmark, read after the input. Without
           ComboboxViewport, which adds a <style> element that the CSP refuses. -->
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-50 max-h-(--reka-combobox-content-available-height) w-(--reka-combobox-trigger-width) min-w-48 overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        <p
          v-if="suggestions.error.value"
          class="px-2 py-1.5 text-sm"
        >
          {{ failureMessage(suggestions.error.value) }}
        </p>
        <p
          v-else-if="!suggestions.data.value"
          class="px-2 py-1.5 text-sm text-muted-foreground"
        >
          Looking…
        </p>
        <template v-else>
          <ComboboxEmpty class="px-2 py-1.5 text-sm text-muted-foreground">
            No recipe uses an ingredient like that.
          </ComboboxEmpty>
          <ComboboxItem
            v-for="suggestion in suggestions.data.value"
            :key="suggestion.name"
            :value="suggestion.name"
            :aria-describedby="countId(suggestion.name)"
            class="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
          >
            <span class="min-w-0 flex-1 break-words">{{ suggestion.name }}</span>
            <!-- Its description, not part of its name: "bread flour", then "1 recipe". -->
            <span
              :id="countId(suggestion.name)"
              aria-hidden="true"
              class="text-xs text-muted-foreground tabular-nums"
            >{{ suggestion.recipes.toLocaleString() }}<span class="sr-only">{{ unit(suggestion.recipes) }}</span></span>
            <span class="flex size-4 items-center justify-center">
              <ComboboxItemIndicator>
                <CheckIcon
                  class="size-4"
                  aria-hidden="true"
                />
              </ComboboxItemIndicator>
            </span>
          </ComboboxItem>
        </template>
      </ComboboxContent>
    </ComboboxRoot>
    <ul
      v-if="chosen.length > 0"
      aria-label="Ingredients chosen"
      class="flex flex-wrap gap-1.5"
    >
      <li
        v-for="name in chosen"
        :key="name"
        class="inline-flex items-center gap-0.5 rounded-full bg-secondary py-0.5 pr-0.5 pl-2.5 text-sm break-words text-secondary-foreground"
      >
        {{ name }}
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          :aria-label="`Remove ${name}`"
          :title="`Remove ${name}`"
          @click="remove(name)"
        >
          <XIcon
            class="size-3.5"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </FieldSet>
</template>
