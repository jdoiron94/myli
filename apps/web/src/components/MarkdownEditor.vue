<script setup lang="ts">
import '@milkdown/kit/prose/view/style/prosemirror.css';
import { BoldIcon, CodeIcon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon } from '@lucide/vue';
import { ToolbarButton, ToolbarRoot, ToolbarSeparator } from 'reka-ui';
import { type Component, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import {
  createMarkdownEditor,
  type Formatting,
  type MarkdownEditorHandle,
} from '@/lib/markdown-editor.ts';
import LinkDialog from './LinkDialog.vue';
import { Button } from './ui/button';

/**
 * The markdown editor (ADR 0014) and its toolbar. `MarkdownField` loads it, and Milkdown with it,
 * only when it's being edited.
 */
const props = defineProps<{
  markdown: string;
  /** For the editable element: its role, accessible name and description, and whether it's invalid. */
  attributes: Record<string, string>;
}>();

const emit = defineEmits<{
  change: [markdown: string];
  /** The editor is created, and can be focused. */
  ready: [];
}>();

interface Action {
  label: string;
  icon: Component;
  /** What it shows as on. */
  on: keyof Formatting;
  run: (editor: MarkdownEditorHandle) => void;
}

const MARKS: Action[] = [
  { label: 'Bold', icon: BoldIcon, on: 'strong', run: (editor) => editor.toggleStrong() },
  { label: 'Italic', icon: ItalicIcon, on: 'emphasis', run: (editor) => editor.toggleEmphasis() },
  { label: 'Code', icon: CodeIcon, on: 'inlineCode', run: (editor) => editor.toggleInlineCode() },
];
const LISTS: Action[] = [
  {
    label: 'Bulleted list',
    icon: ListIcon,
    on: 'bulletList',
    run: (editor) => {
      editor.toggleList('bulletList');
    },
  },
  {
    label: 'Numbered list',
    icon: ListOrderedIcon,
    on: 'orderedList',
    run: (editor) => {
      editor.toggleList('orderedList');
    },
  },
];

const formatting = ref<Formatting>({
  strong: false,
  emphasis: false,
  inlineCode: false,
  link: false,
  bulletList: false,
  orderedList: false,
});

const root = useTemplateRef('root');
let editor: MarkdownEditorHandle | undefined;
let unmounted = false;
/** The markdown it last reported, to tell its own changes from ones made outside it. */
let reported = props.markdown;

onMounted(async () => {
  if (!root.value) return;
  const created = await createMarkdownEditor({
    root: root.value,
    markdown: props.markdown,
    attributes: () => props.attributes,
    onChange: (markdown) => {
      reported = markdown;
      emit('change', markdown);
    },
    onFormatting: (now) => {
      formatting.value = now;
    },
    onLinkShortcut: openLink,
  });
  // Closed while it was being created.
  if (unmounted) {
    await created.destroy();
    return;
  }
  editor = created;
  emit('ready');
});

onBeforeUnmount(() => {
  unmounted = true;
  void editor?.destroy();
});

watch(
  () => props.attributes,
  (attributes) => {
    editor?.view().setProps({ attributes });
  },
);
watch(
  () => props.markdown,
  (markdown) => {
    if (markdown === reported) return;
    reported = markdown;
    editor?.replace(markdown);
  },
);

/** Runs a toolbar action, then goes back to writing. */
function run(action: Action) {
  if (!editor) return;
  action.run(editor);
  editor.focus();
}

const linking = ref(false);
const linkHref = ref<string>();
const askText = ref(false);

function openLink() {
  if (!editor) return;
  const around = editor.linkAt();
  linkHref.value = around?.href;
  askText.value = !around && editor.view().state.selection.empty;
  linking.value = true;
}

defineExpose({
  focusAtEnd: () => editor?.focusAtEnd(),
});
</script>

<template>
  <div>
    <ToolbarRoot
      aria-label="Formatting"
      class="flex flex-wrap items-center gap-0.5 border-b p-1"
    >
      <!-- mousedown is prevented so a click leaves focus, and the selection, in the editor. -->
      <ToolbarButton
        v-for="action in MARKS"
        :key="action.label"
        as-child
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          :aria-label="action.label"
          :aria-pressed="formatting[action.on]"
          @mousedown.prevent
          @click="run(action)"
        >
          <component
            :is="action.icon"
            aria-hidden="true"
          />
        </Button>
      </ToolbarButton>
      <ToolbarButton as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          aria-label="Link"
          :aria-pressed="formatting.link"
          @mousedown.prevent
          @click="openLink"
        >
          <LinkIcon aria-hidden="true" />
        </Button>
      </ToolbarButton>
      <ToolbarSeparator class="mx-1 h-5 w-px bg-border" />
      <ToolbarButton
        v-for="action in LISTS"
        :key="action.label"
        as-child
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          :aria-label="action.label"
          :aria-pressed="formatting[action.on]"
          @mousedown.prevent
          @click="run(action)"
        >
          <component
            :is="action.icon"
            aria-hidden="true"
          />
        </Button>
      </ToolbarButton>
    </ToolbarRoot>
    <div ref="root" />
    <LinkDialog
      v-model:open="linking"
      :href="linkHref"
      :ask-text="askText"
      @save="(href, text) => editor?.setLink(href, text)"
      @remove="editor?.removeLink()"
      @closed="editor?.focus()"
    />
  </div>
</template>
