import type { Token } from 'markdown-it';
import { isShownLinkAddress, markdownTokens } from './markdown.ts';

/**
 * Markdown read the way the renderer reads it (`markdown.ts`), as the syntax tree (mdast) Milkdown
 * builds the editor's document from. Milkdown would read it with remark, which knows syntax the
 * renderer leaves as text, like headings, quotes and images, and doesn't read syntax inside them,
 * where the renderer does: "> A **bold** note" shows as text with "bold" in bold. Reading it with the
 * renderer's own parser, the editor opens exactly what the recipe shows (ADR 0015).
 */

/** The parts of an mdast node that Milkdown's commonmark preset reads. */
export interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  /** Links. */
  url?: string;
  title?: string;
  /** Lists. */
  ordered?: boolean;
  start?: number;
  /** Lists and their items: blank lines between the items. */
  spread?: boolean;
  /** Items of a numbered list: their number. */
  label?: number;
  /** Bold and italic: written with `*` or `_`, kept when saved. */
  marker?: string;
}

const node = (type: string, fields: Omit<MarkdownNode, 'type'> = {}): MarkdownNode => ({
  type,
  children: [],
  ...fields,
});

/** A token's inline children, as phrasing content. */
function inline(tokens: readonly Token[]): MarkdownNode[] {
  const root = node('root');
  const open: MarkdownNode[] = [root];
  const add = (child: MarkdownNode) => {
    open.at(-1)?.children?.push(child);
  };
  const enter = (child: MarkdownNode) => {
    add(child);
    open.push(child);
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        // markdown-it leaves empty ones where it took delimiters out.
        if (token.content !== '') add({ type: 'text', value: token.content });
        break;
      // With `breaks: true`, a line break shows as one either way.
      case 'softbreak':
      case 'hardbreak':
        add({ type: 'break' });
        break;
      case 'code_inline':
        add({ type: 'inlineCode', value: token.content });
        break;
      case 'em_open':
        enter(node('emphasis', { marker: token.markup.charAt(0) }));
        break;
      case 'strong_open':
        enter(node('strong', { marker: token.markup.charAt(0) }));
        break;
      case 'link_open': {
        const href = token.attrGet('href') ?? '';
        const title = token.attrGet('title');
        // An address the renderer drops shows as a link's words, not as a link.
        enter(
          isShownLinkAddress(href)
            ? node('link', { url: href, ...(title === null ? {} : { title }) })
            : node('words'),
        );
        break;
      }
      case 'em_close':
      case 'strong_close':
      case 'link_close':
        open.pop();
        break;
      default:
        // Nothing else is turned on in the renderer. Should a new version add something, its text.
        if (token.content !== '') add({ type: 'text', value: token.content });
    }
  }
  return unwrapWords(root.children ?? []);
}

/** Replaces each `words` node, a link the renderer doesn't keep, with its contents. */
function unwrapWords(children: MarkdownNode[]): MarkdownNode[] {
  return children.flatMap((child) => {
    const inner = child.children && unwrapWords(child.children);
    if (child.type === 'words') return inner ?? [];
    return [inner ? { ...child, children: inner } : child];
  });
}

export function markdownTree(source: string): MarkdownNode {
  const root = node('root');
  const open: MarkdownNode[] = [root];
  /** The lists open around the current token, innermost last. */
  const lists: MarkdownNode[] = [];
  const add = (child: MarkdownNode) => {
    open.at(-1)?.children?.push(child);
  };
  const enter = (child: MarkdownNode) => {
    add(child);
    open.push(child);
  };

  for (const token of markdownTokens(source)) {
    switch (token.type) {
      case 'paragraph_open': {
        // markdown-it hides the paragraphs of a tight list, where items have no blank lines between.
        const list = lists.at(-1);
        if (list && !token.hidden) list.spread = true;
        enter(node('paragraph'));
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = token.type === 'ordered_list_open';
        const list = node('list', {
          ordered,
          spread: false,
          ...(ordered ? { start: Number(token.attrGet('start') ?? 1) } : {}),
        });
        enter(list);
        lists.push(list);
        break;
      }
      case 'list_item_open':
        enter(node('listItem'));
        break;
      case 'inline':
        for (const child of inline(token.children ?? [])) add(child);
        break;
      case 'bullet_list_close':
      case 'ordered_list_close': {
        const list = lists.pop();
        for (const [index, item] of (list?.children ?? []).entries()) {
          item.spread = list?.spread ?? false;
          if (list?.ordered) item.label = (list.start ?? 1) + index;
        }
        open.pop();
        break;
      }
      case 'paragraph_close':
      case 'list_item_close':
        open.pop();
        break;
      default:
        // No other block is turned on in the renderer.
        break;
    }
  }
  return root;
}
