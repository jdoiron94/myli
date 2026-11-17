import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { history } from '@milkdown/kit/plugin/history';
import {
  bulletListAttr,
  bulletListSchema,
  docSchema,
  emphasisAttr,
  emphasisKeymap,
  emphasisSchema,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  hardbreakAttr,
  hardbreakClearMarkPlugin,
  hardbreakFilterNodes,
  hardbreakFilterPlugin,
  hardbreakKeymap,
  hardbreakSchema,
  inlineCodeAttr,
  inlineCodeInputRule,
  inlineCodeKeymap,
  inlineCodeSchema,
  inlineNodesCursorPlugin,
  insertHardbreakCommand,
  liftFirstListItemCommand,
  liftListItemCommand,
  linkAttr,
  linkSchema,
  listItemAttr,
  listItemKeymap,
  listItemSchema,
  orderedListAttr,
  orderedListSchema,
  paragraphAttr,
  paragraphSchema,
  sinkListItemCommand,
  splitListItemCommand,
  strongAttr,
  strongInputRule,
  strongKeymap,
  strongSchema,
  syncListOrderPlugin,
  textSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBulletListInputRule,
  wrapInOrderedListInputRule,
} from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { MarkType, Node, NodeType } from '@milkdown/kit/prose/model';
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
import {
  AllSelection,
  type EditorState,
  Plugin,
  Selection,
  TextSelection,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { RemarkPluginRaw } from '@milkdown/kit/transformer';
import { $prose, $remark, callCommand, replaceAll } from '@milkdown/kit/utils';
import { markdownTree } from './markdown-tree.ts';

/**
 * The markdown editor (ADR 0014): Milkdown's kit with only ADR 0006's subset, the one the renderer
 * shows (`markdown.ts`): paragraphs and line breaks, bold, italic, inline code, links and lists.
 * With no node for a heading, a quote, a code block, a rule, an image, a table or HTML, nothing can
 * make one: not typing, not a shortcut, not pasting. Markdown that has one anyway, saved before or
 * written through the API, opens as the renderer shows it (ADR 0015).
 *
 * Only the editing pages load this module, and Milkdown with it.
 */

/**
 * Reads markdown as the renderer does (`markdown-tree.ts`), in place of remark's parser: anything
 * outside the subset opens as the recipe shows it. Saving is still remark's (Milkdown's serializer).
 */
const readLikeTheRenderer = $remark(
  'readLikeTheRenderer',
  (): RemarkPluginRaw<unknown> =>
    function () {
      this.parser = (document) => markdownTree(document);
    },
);

/** What the toolbar shows as on, where the cursor or selection is. */
export interface Formatting {
  strong: boolean;
  emphasis: boolean;
  inlineCode: boolean;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
}

export interface MarkdownEditorOptions {
  root: HTMLElement;
  markdown: string;
  /** For the editable element: its role, accessible name and description. */
  attributes: () => Record<string, string>;
  /** Called with the markdown on every change, as it happens. */
  onChange: (markdown: string) => void;
  /** Called on every change of content or selection. */
  onFormatting: (formatting: Formatting) => void;
  /** Called on Mod+K, to add or change a link. */
  onLinkShortcut: () => void;
}

/** The subset's marks and lists, for the toolbar and the list commands. */
export interface SubsetTypes {
  strong: MarkType;
  emphasis: MarkType;
  inlineCode: MarkType;
  link: MarkType;
  bulletList: NodeType;
  orderedList: NodeType;
  listItem: NodeType;
}

function hasMark(state: EditorState, type: MarkType) {
  const { from, to, empty } = state.selection;
  if (empty) return type.isInSet(state.storedMarks ?? state.selection.$from.marks()) !== undefined;
  return state.doc.rangeHasMark(from, to, type);
}

/** The innermost list around the cursor, or the start of the selection, and where it is. */
function listAround(state: EditorState, types: SubsetTypes): { node: Node; pos: number } | null {
  const { selection, doc } = state;
  // Everything selected starts outside every block: look inside the first.
  const $from =
    selection.$from.depth === 0 ? doc.resolve(Math.min(1, doc.content.size)) : selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === types.bulletList || node.type === types.orderedList) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

export function formattingOf(state: EditorState, types: SubsetTypes): Formatting {
  const list = listAround(state, types)?.node.type;
  return {
    strong: hasMark(state, types.strong),
    emphasis: hasMark(state, types.emphasis),
    inlineCode: hasMark(state, types.inlineCode),
    link: hasMark(state, types.link),
    bulletList: list === types.bulletList,
    orderedList: list === types.orderedList,
  };
}

type ListKind = 'bulletList' | 'orderedList';

/**
 * Makes the selected lines a list of this kind, takes them out of it if they're in one, or changes
 * the kind of the list around them, all of it.
 */
function toggleList(view: EditorView, types: SubsetTypes, kind: ListKind) {
  // The list commands can't work out the lines of a select-all: select them as text instead.
  if (view.state.selection instanceof AllSelection) {
    const { doc } = view.state;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.between(Selection.atStart(doc).$from, Selection.atEnd(doc).$to),
      ),
    );
  }
  const { state } = view;
  const around = listAround(state, types);
  const type = types[kind];
  if (!around) {
    // Each line its own item. Milkdown's own commands would put them all in one.
    wrapInList(type)(state, view.dispatch);
  } else if (around.node.type === type) {
    liftListItem(types.listItem)(state, view.dispatch);
  } else {
    const { node, pos } = around;
    const spread = Boolean(node.attrs.spread);
    const tr = state.tr.setNodeMarkup(
      pos,
      type,
      kind === 'orderedList' ? { order: 1, spread } : { spread },
    );
    // Its items say which kind they're in: Milkdown makes a list numbered again if its first item
    // still says so.
    const listType = kind === 'orderedList' ? 'ordered' : 'bullet';
    node.forEach((item, offset) => {
      tr.setNodeMarkup(pos + 1 + offset, undefined, { ...item.attrs, listType });
    });
    view.dispatch(tr);
  }
}

const subsetTypes = (ctx: Ctx): SubsetTypes => ({
  strong: strongSchema.type(ctx),
  emphasis: emphasisSchema.type(ctx),
  inlineCode: inlineCodeSchema.type(ctx),
  link: linkSchema.type(ctx),
  bulletList: bulletListSchema.type(ctx),
  orderedList: orderedListSchema.type(ctx),
  listItem: listItemSchema.type(ctx),
});

/** A Milkdown editor held to the subset, created in `root`. */
export async function createMarkdownEditor(options: MarkdownEditorOptions) {
  // Reports each change straight away. Milkdown's listener plugin waits 200 ms, and drops what it
  // was waiting with when the editor closes, which could lose the last words typed before saving.
  const reporter = $prose(
    (ctx) =>
      new Plugin({
        view: () => ({
          update: (view, previous) => {
            if (!view.state.doc.eq(previous.doc)) {
              // Without the newline a markdown file ends with, which a field's value doesn't.
              options.onChange(ctx.get(serializerCtx)(view.state.doc).trimEnd());
            }
            options.onFormatting(formattingOf(view.state, subsetTypes(ctx)));
          },
        }),
      }),
  );

  // The toolbar's own shortcuts: the lists work as its buttons do.
  const shortcuts = $prose((ctx) => {
    const list =
      (kind: ListKind) => (_state: EditorState, _dispatch: unknown, view?: EditorView) => {
        if (view) toggleList(view, subsetTypes(ctx), kind);
        return true;
      };
    return keymap({
      'Mod-k': () => {
        options.onLinkShortcut();
        return true;
      },
      'Mod-Alt-8': list('bulletList'),
      'Mod-Alt-7': list('orderedList'),
    });
  });

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.markdown);
      // Lists saved with "-", the usual way to write them, and how the editor starts one.
      ctx.update(remarkStringifyOptionsCtx, (previous) => ({ ...previous, bullet: '-' as const }));
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        attributes: options.attributes,
      }));
      // Typing at the end of a link carries on after it, rather than making the link longer.
      ctx.update(linkSchema.key, (schema) => (context) => ({
        ...schema(context),
        inclusive: false,
      }));
      // Tab and Shift+Tab move focus, as everywhere else; lists are indented with Mod+] and Mod+[.
      ctx.update(listItemKeymap.key, (previous) => ({
        ...previous,
        SinkListItem: { shortcuts: 'Mod-]' },
        LiftListItem: { shortcuts: 'Mod-[' },
      }));
    })
    .use([
      paragraphAttr,
      hardbreakAttr,
      emphasisAttr,
      strongAttr,
      inlineCodeAttr,
      linkAttr,
      bulletListAttr,
      orderedListAttr,
      listItemAttr,
    ])
    // None of Milkdown's remark plugins: they work on what remark reads, which this replaces. Not
    // remarkPreserveEmptyLinePlugin either, which writes empty paragraphs as `<br />`: HTML, which
    // the renderer shows as text.
    .use(readLikeTheRenderer)
    .use(
      [
        docSchema,
        textSchema,
        paragraphSchema,
        hardbreakSchema,
        hardbreakFilterNodes,
        emphasisSchema,
        strongSchema,
        inlineCodeSchema,
        linkSchema,
        bulletListSchema,
        orderedListSchema,
        listItemSchema,
      ].flat(),
    )
    .use([
      emphasisStarInputRule,
      emphasisUnderscoreInputRule,
      strongInputRule,
      inlineCodeInputRule,
      wrapInBulletListInputRule,
      wrapInOrderedListInputRule,
    ])
    .use([
      toggleEmphasisCommand,
      toggleStrongCommand,
      toggleInlineCodeCommand,
      sinkListItemCommand,
      splitListItemCommand,
      liftListItemCommand,
      liftFirstListItemCommand,
      insertHardbreakCommand,
    ])
    .use([hardbreakKeymap, emphasisKeymap, strongKeymap, inlineCodeKeymap, listItemKeymap].flat())
    .use([
      hardbreakClearMarkPlugin,
      hardbreakFilterPlugin,
      inlineNodesCursorPlugin,
      syncListOrderPlugin,
    ])
    .use(history)
    .use([reporter, shortcuts])
    .create();

  const subset = editor.action(subsetTypes);
  const view = (): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
  options.onFormatting(formattingOf(view().state, subset));

  /** The link the cursor or the selection's start is in: its range and address. */
  function linkAt(): { from: number; to: number; href: string } | null {
    const { $from } = view().state.selection;
    const mark =
      subset.link.isInSet($from.marks()) ?? subset.link.isInSet($from.nodeAfter?.marks ?? []);
    if (!mark) return null;
    // The runs of text with this same link in the cursor's block, and the one the cursor is in.
    const runs: { from: number; to: number }[] = [];
    const start = $from.start();
    $from.parent.forEach((node, offset) => {
      if (!mark.isInSet(node.marks)) return;
      const at = start + offset;
      const last = runs.at(-1);
      if (last?.to === at) last.to = at + node.nodeSize;
      else runs.push({ from: at, to: at + node.nodeSize });
    });
    const run = runs.find(({ from, to }) => from <= $from.pos && $from.pos <= to);
    return run ? { ...run, href: String(mark.attrs.href) } : null;
  }

  /**
   * Links the selection, or the link the cursor is in, to `href`. With nothing selected and no
   * link around the cursor, `text` goes in, linked, or the address itself without it.
   */
  function setLink(href: string, text = '') {
    const current = view();
    const { state } = current;
    const link = subset.link.create({ href });
    const around = linkAt();
    const { from, to, empty } = state.selection;
    if (around) {
      current.dispatch(
        state.tr
          .removeMark(around.from, around.to, subset.link)
          .addMark(around.from, around.to, link),
      );
    } else if (empty) {
      current.dispatch(state.tr.insert(from, state.schema.text(text === '' ? href : text, [link])));
    } else {
      current.dispatch(state.tr.removeMark(from, to, subset.link).addMark(from, to, link));
    }
  }

  function removeLink() {
    const around = linkAt();
    const current = view();
    const { from, to } = around ?? current.state.selection;
    current.dispatch(current.state.tr.removeMark(from, to, subset.link));
  }

  return {
    editor,
    view,
    toggleStrong: () => editor.action(callCommand(toggleStrongCommand.key)),
    toggleEmphasis: () => editor.action(callCommand(toggleEmphasisCommand.key)),
    toggleInlineCode: () => editor.action(callCommand(toggleInlineCodeCommand.key)),
    toggleList: (kind: ListKind) => {
      toggleList(view(), subset, kind);
    },
    linkAt,
    setLink,
    removeLink,
    /** Focuses the editor, keeping its selection. */
    focus: () => {
      view().focus();
    },
    /** Focuses the editor with the cursor at the end, to carry on writing. */
    focusAtEnd: () => {
      const current = view();
      current.dispatch(current.state.tr.setSelection(Selection.atEnd(current.state.doc)));
      current.focus();
    },
    /** Replaces the content, as when the field's value changes from outside the editor. */
    replace: (markdown: string) => {
      editor.action(replaceAll(markdown));
    },
    destroy: () => editor.destroy(),
  };
}

export type MarkdownEditorHandle = Awaited<ReturnType<typeof createMarkdownEditor>>;
