<script setup lang="ts">
import { PlusIcon } from '@lucide/vue';
import { useFieldArray, useFieldError } from 'vee-validate';
import { nextTick, useTemplateRef } from 'vue';
import FormTextField from '@/components/FormTextField.vue';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import IngredientLineEditor from './IngredientLineEditor.vue';
import { emptyLine, type IngredientLineValues } from './recipe-form.ts';

/**
 * One group of ingredient lines. With several groups, each has a name ("For the dough") and can be
 * removed; a lone group needs neither (spec §3.2).
 */
const props = defineProps<{
  /** The group's place among the recipe's groups, from 0. */
  index: number;
  /** How many groups the recipe has. */
  count: number;
}>();
const emit = defineEmits<{ remove: [] }>();

const path = () => `ingredientGroups[${String(props.index)}]`;
const lines = useFieldArray<IngredientLineValues>(() => `${path()}.ingredients`);
const fields = lines.fields;
const linesError = useFieldError(() => `${path()}.ingredients`);

const root = useTemplateRef('root');
const lineInputs = () => [
  ...(root.value?.querySelectorAll<HTMLInputElement>('[data-ingredient-line]') ?? []),
];

async function focusLine(index: number) {
  await nextTick();
  lineInputs()[index]?.focus();
}

function addLine() {
  lines.push(emptyLine());
  void focusLine(fields.value.length - 1);
}

function next(index: number) {
  lines.insert(index + 1, emptyLine());
  void focusLine(index + 1);
}

/** Pasted lines go in place of a blank line, or else after it, and focus goes to the last. */
function paste(index: number, pasted: string[]) {
  const current = fields.value[index]?.value;
  const blank = current?.details === null && current.rawText.trim() === '';
  const [first, ...rest] = pasted;
  if (blank && first !== undefined) lines.update(index, { rawText: first, details: null });
  (blank ? rest : pasted).forEach((rawText, offset) => {
    lines.insert(index + 1 + offset, { rawText, details: null });
  });
  void focusLine(index + (blank ? rest.length : pasted.length));
}

/** Focus stays on the button pressed, on the line now in its new place. */
async function move(index: number, by: -1 | 1) {
  lines.swap(index, index + by);
  await nextTick();
  const moved = root.value?.querySelectorAll('li')[index + by];
  moved?.querySelector<HTMLElement>(`[data-move="${String(by)}"]`)?.focus();
}

/** Focus goes to the line that takes its place, or the one before, or the button to add one. */
async function removeLine(index: number) {
  lines.remove(index);
  await nextTick();
  const inputs = lineInputs();
  const next = inputs[index] ?? inputs[index - 1];
  if (next) next.focus();
  else root.value?.querySelector<HTMLElement>('[data-add-line]')?.focus();
}
</script>

<template>
  <div
    ref="root"
    data-ingredient-group
    class="space-y-3"
    :class="count > 1 ? 'rounded-lg border p-4' : undefined"
  >
    <div
      v-if="count > 1"
      class="flex items-end gap-2"
    >
      <FormTextField
        class="flex-1"
        :name="`${path()}.label`"
        :label="`Group ${index + 1} name`"
        description="Like “For the dough”."
      />
      <Button
        type="button"
        variant="outline"
        @click="emit('remove')"
      >
        Remove group {{ index + 1 }}
      </Button>
    </div>
    <ul
      v-if="fields.length > 0"
      class="space-y-3"
      :aria-label="count > 1 ? `Group ${index + 1} ingredients` : 'Ingredients'"
    >
      <IngredientLineEditor
        v-for="(field, lineIndex) in fields"
        :key="field.key"
        :path="`${path()}.ingredients[${lineIndex}]`"
        :position="lineIndex + 1"
        :count="fields.length"
        @next="next(lineIndex)"
        @paste="paste(lineIndex, $event)"
        @move="move(lineIndex, $event)"
        @remove="removeLine(lineIndex)"
      />
    </ul>
    <FieldError :errors="linesError ? [linesError] : []" />
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-add-line
      @click="addLine"
    >
      <PlusIcon aria-hidden="true" />
      {{ count > 1 ? `Add an ingredient to group ${index + 1}` : 'Add an ingredient' }}
    </Button>
  </div>
</template>
