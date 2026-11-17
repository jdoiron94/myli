<script lang="ts">
import { shallowRef } from 'vue';

/** The field being edited, if any: one editor is open at a time on the page (ADR 0006). */
const editing = shallowRef<symbol | null>(null);
</script>

<script setup lang="ts">
import { useField } from 'vee-validate';
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  useId,
  useTemplateRef,
  watch,
} from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import type MarkdownEditorComponent from './MarkdownEditor.vue';
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field';

/**
 * A field of the VeeValidate form around it that holds markdown: a description, a step. It shows
 * the markdown rendered, as the recipe will, until it's focused; then the editor takes its place.
 * The editor is loaded only on pages with such a field, and open on one field at a time.
 */
const props = defineProps<{
  /** The field's path in the form's values. */
  name: string;
  label: string;
  /** A hint under the label. */
  description?: string;
}>();

const loadEditor = () => import('./MarkdownEditor.vue');
const MarkdownEditor = defineAsyncComponent(loadEditor);
// Loaded as the page opens, so it's there by the time a field is focused.
onMounted(() => {
  void loadEditor();
});

// Checked on submit, then as it's typed in until it's right, like the form's other fields.
const { value, errorMessage, validate } = useField<string>(() => props.name, undefined, {
  validateOnValueUpdate: false,
});
watch(value, () => {
  if (errorMessage.value) void validate();
});

const self = Symbol(props.name);
const isEditing = computed(() => editing.value === self);
/** The editor is created and shown. Until then, the rendered markdown stays in its place. */
const ready = ref(false);
watch(isEditing, (now) => {
  if (!now) ready.value = false;
});
onBeforeUnmount(() => {
  if (editing.value === self) editing.value = null;
});

const id = useId();
const labelId = `${id}-label`;
const descriptionId = `${id}-description`;
const errorId = `${id}-error`;
/** The error first: it's what needs reading when there is one. */
const describedBy = computed(() =>
  [errorMessage.value ? errorId : null, props.description ? descriptionId : null]
    .filter((part) => part !== null)
    .join(' '),
);
/** The same for the rendered markdown as for the editor that takes its place. */
const textbox = computed(() => ({
  role: 'textbox' as const,
  'aria-multiline': 'true' as const,
  'aria-labelledby': labelId,
  ...(describedBy.value ? { 'aria-describedby': describedBy.value } : {}),
  ...(errorMessage.value ? { 'aria-invalid': 'true' as const } : {}),
}));
const CONTENT = 'markdown min-h-16 px-2.5 py-2 text-base outline-none md:text-sm';
const editorAttributes = computed(() => ({ ...textbox.value, class: CONTENT }));

const preview = useTemplateRef('preview');
const editor = useTemplateRef<InstanceType<typeof MarkdownEditorComponent>>('editor');

// Its links are the field's text, not places to go: clicking one edits the field.
function markLinks() {
  for (const link of preview.value?.querySelectorAll('a') ?? []) link.tabIndex = -1;
}
onMounted(markLinks);
onUpdated(markLinks);

function edit() {
  editing.value = self;
}

function clickPreview(event: MouseEvent) {
  event.preventDefault();
  edit();
}

async function editorReady() {
  // Focus moves to the editor only if it's still on the field, not if it moved on meanwhile.
  const focused = preview.value?.contains(document.activeElement) ?? false;
  ready.value = true;
  await nextTick();
  if (focused) editor.value?.focusAtEnd();
}

function focus() {
  if (ready.value) editor.value?.focusAtEnd();
  else preview.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <Field :data-invalid="errorMessage ? true : undefined">
    <FieldLabel
      :id="labelId"
      @click="focus"
    >
      {{ label }}
    </FieldLabel>
    <FieldDescription
      v-if="description"
      :id="descriptionId"
    >
      {{ description }}
    </FieldDescription>
    <div
      class="rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30 dark:has-[[aria-invalid=true]]:ring-destructive/40"
    >
      <MarkdownEditor
        v-if="isEditing"
        v-show="ready"
        ref="editor"
        :markdown="value"
        :attributes="editorAttributes"
        @change="value = $event"
        @ready="editorReady"
      />
      <div
        v-if="!ready"
        ref="preview"
        v-bind="textbox"
        tabindex="0"
        :class="CONTENT"
        @focus="edit"
        @click="clickPreview"
      >
        <MarkdownContent :source="value" />
      </div>
    </div>
    <FieldError
      :id="errorId"
      :errors="errorMessage ? [errorMessage] : []"
    />
  </Field>
</template>
