<script setup lang="ts">
import { MinusIcon, PlusIcon } from '@lucide/vue';
import { RECIPE_LIMITS } from '@myli/shared';
import { computed, ref, useId, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * How many servings to show a recipe for: typed in, or one more or fewer with the buttons. The
 * number only changes to whole numbers in range; while what's typed isn't one, it says so, and
 * leaving the field puts the last good number back.
 */
const servings = defineModel<number>({ required: true });

const MAX = RECIPE_LIMITS.servings;
const id = useId();
const errorId = `${id}-error`;

const draft = ref(String(servings.value));
watch(servings, (value) => {
  if (parse(draft.value) !== value) draft.value = String(value);
});

function parse(text: string): number | undefined {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return /^\d+$/.test(trimmed) && value >= 1 && value <= MAX ? value : undefined;
}

const invalid = computed(() => parse(draft.value) === undefined);

function typed(text: string | number) {
  draft.value = String(text);
  const value = parse(draft.value);
  if (value !== undefined) servings.value = value;
}

function left() {
  if (invalid.value) draft.value = String(servings.value);
}

// The buttons stay focusable at the limits (aria-disabled, not disabled), so pressing one until it
// stops working doesn't lose focus.
function step(by: number) {
  const next = servings.value + by;
  if (next >= 1 && next <= MAX) servings.value = next;
}

const input = useTemplateRef<InstanceType<typeof Input>>('input');
defineExpose({
  focus: () => {
    (input.value?.$el as HTMLInputElement | undefined)?.focus();
  },
});
</script>

<template>
  <div>
    <div class="flex items-center gap-2">
      <label
        :for="id"
        class="text-sm font-medium"
      >Servings</label>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Fewer servings"
        :aria-controls="id"
        :aria-disabled="servings <= 1 ? true : undefined"
        @click="step(-1)"
      >
        <MinusIcon aria-hidden="true" />
      </Button>
      <Input
        :id="id"
        ref="input"
        :model-value="draft"
        inputmode="numeric"
        autocomplete="off"
        class="w-16 text-center"
        :aria-invalid="invalid ? true : undefined"
        :aria-describedby="invalid ? errorId : undefined"
        @update:model-value="typed"
        @blur="left"
      />
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="More servings"
        :aria-controls="id"
        :aria-disabled="servings >= MAX ? true : undefined"
        @click="step(1)"
      >
        <PlusIcon aria-hidden="true" />
      </Button>
    </div>
    <p
      v-if="invalid"
      :id="errorId"
      class="mt-1 text-sm text-destructive"
    >
      Enter a whole number from 1 to {{ MAX }}.
    </p>
  </div>
</template>
