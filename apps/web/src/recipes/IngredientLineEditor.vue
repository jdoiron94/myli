<script setup lang="ts">
import { ArrowDownIcon, ArrowUpIcon, XIcon } from '@lucide/vue';
import { useField } from 'vee-validate';
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { showLineAsWritten } from './format.ts';
import LineCorrections from './LineCorrections.vue';
import { type LineDetails, quantityText, readLine } from './recipe-form.ts';

/**
 * One ingredient line in the editor: typed as it would be written, with how myli reads it under it,
 * which is what the recipe will show.
 */
const props = defineProps<{
  /** The line's path in the form's values. */
  path: string;
  /** Its place in its group, from 1. */
  position: number;
  /** How many lines its group has. */
  count: number;
}>();

const emit = defineEmits<{
  remove: [];
  move: [by: -1 | 1];
  /** Enter was pressed: a new line goes after this one. */
  next: [];
  /** Several lines were pasted in, to go in place of a blank line or after this one. */
  paste: [lines: string[]];
}>();

// Checked on submit, then as it's typed in until it's right, like the form's other fields.
const {
  value: rawText,
  errorMessage,
  validate,
} = useField<string>(() => `${props.path}.rawText`, undefined, { validateOnValueUpdate: false });
watch(rawText, () => {
  if (errorMessage.value) void validate();
});
const { value: details } = useField<LineDetails | null>(() => `${props.path}.details`);

const reading = computed(() => readLine({ rawText: rawText.value, details: details.value }));
const shown = computed(() => showLineAsWritten(reading.value));
const hasReading = computed(() => details.value !== null || rawText.value.trim() !== '');

const id = useId();
const errorId = `${id}-error`;
const readingId = `${id}-reading`;
const describedBy = computed(
  () =>
    [errorMessage.value ? errorId : null, hasReading.value ? readingId : null]
      .filter((part) => part !== null)
      .join(' ') || undefined,
);

function keydown(event: KeyboardEvent) {
  // Not while an input method is composing a character, where Enter picks the character.
  if (event.key !== 'Enter' || event.isComposing) return;
  // It would submit the form otherwise.
  event.preventDefault();
  emit('next');
}

function paste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!/[\r\n]/.test(text)) return;
  event.preventDefault();
  const lines = text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length > 0) emit('paste', lines);
}

const root = useTemplateRef('root');
const input = useTemplateRef<InstanceType<typeof Input>>('input');
const focusLine = () => {
  (input.value?.$el as HTMLInputElement | undefined)?.focus();
};

/** Starts correcting from what the parser reads, with focus on the first part. */
async function correct() {
  const read = reading.value;
  details.value = {
    qty: quantityText(read.qty),
    qtyMax: quantityText(read.qtyMax),
    unit: read.unit ?? '',
    name: read.name,
    note: read.note ?? '',
    scalable: read.scalable,
  };
  await nextTick();
  root.value?.querySelector<HTMLElement>('[data-corrections] input')?.focus();
}

/** Back to what the parser reads from the line, dropping the corrections. */
async function readAgain() {
  details.value = null;
  await nextTick();
  focusLine();
}

defineExpose({ focus: focusLine });

const first = computed(() => props.position === 1);
const last = computed(() => props.position === props.count);
</script>

<template>
  <li
    ref="root"
    class="space-y-1"
  >
    <div class="flex items-center gap-1">
      <label
        :for="id"
        class="sr-only"
      >Ingredient {{ position }}</label>
      <Input
        :id="id"
        ref="input"
        v-model="rawText"
        data-ingredient-line
        class="min-w-0 flex-1"
        autocomplete="off"
        :aria-invalid="errorMessage ? true : undefined"
        :aria-describedby="describedBy"
        @keydown="keydown"
        @paste="paste"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="aria-disabled:opacity-50"
        :aria-label="`Move ingredient ${position} up`"
        :aria-disabled="first ? true : undefined"
        data-move="-1"
        @click="first || emit('move', -1)"
      >
        <ArrowUpIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="aria-disabled:opacity-50"
        :aria-label="`Move ingredient ${position} down`"
        :aria-disabled="last ? true : undefined"
        data-move="1"
        @click="last || emit('move', 1)"
      >
        <ArrowDownIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        :aria-label="`Remove ingredient ${position}`"
        @click="emit('remove')"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
    <FieldError
      :id="errorId"
      :errors="errorMessage ? [errorMessage] : []"
    />
    <p
      v-if="hasReading"
      :id="readingId"
      class="text-sm text-muted-foreground"
    >
      <!-- Spaces between parts are expressions: Vue drops whitespace at the end of an element. -->
      Reads as:{{ ' ' }}<strong
        v-if="shown.amount"
        class="font-medium text-foreground"
      >{{ shown.amount }}</strong>{{ shown.amount ? ' ' : '' }}<span
        v-if="shown.name"
        class="text-foreground"
      >{{ shown.name }}</span><em v-else>no ingredient named</em><span v-if="shown.note">, {{ shown.note }}</span>.<template v-if="!reading.scalable">
        {{ ' ' }}Doesn't change with servings.
      </template><template v-if="details">
        {{ ' ' }}Corrected by hand.
      </template>
    </p>
    <template v-if="details">
      <LineCorrections
        :path="path"
        :position="position"
      />
      <Button
        type="button"
        variant="link"
        size="sm"
        class="h-auto px-0"
        @click="readAgain"
      >
        Read ingredient {{ position }} again
      </Button>
    </template>
    <Button
      v-else-if="rawText.trim() !== ''"
      type="button"
      variant="link"
      size="sm"
      class="h-auto px-0"
      @click="correct"
    >
      Correct how ingredient {{ position }} is read
    </Button>
  </li>
</template>
