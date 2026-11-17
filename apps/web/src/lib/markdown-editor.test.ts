import { AllSelection, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMarkdown, USER_LINK_REL } from './markdown.ts';
import {
  createMarkdownEditor,
  type Formatting,
  type MarkdownEditorHandle,
} from './markdown-editor.ts';

// jsdom has no clipboard events, which ProseMirror's paste helpers make.
class ClipboardEventStandIn extends Event {
  readonly clipboardData = null;
}
if (!('ClipboardEvent' in globalThis)) {
  Object.assign(globalThis, { ClipboardEvent: ClipboardEventStandIn });
}

const editors: MarkdownEditorHandle[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy();
  document.body.replaceChildren();
});

/** An editor on `markdown`, with the markdown it last reported and its toolbar state. */
async function open(markdown = '') {
  const root = document.createElement('div');
  document.body.append(root);
  const reported = { markdown, formatting: undefined as Formatting | undefined, linkShortcuts: 0 };
  const editor = await createMarkdownEditor({
    root,
    markdown,
    attributes: () => ({ role: 'textbox', 'aria-label': 'Step' }),
    onChange: (changed) => {
      reported.markdown = changed;
    },
    onFormatting: (formatting) => {
      reported.formatting = formatting;
    },
    onLinkShortcut: () => {
      reported.linkShortcuts += 1;
    },
  });
  editors.push(editor);
  return { editor, view: editor.view(), reported, root };
}

/** Types `text` a character at a time, as the browser would: input rules get each one first. */
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp('handleTextInput', (handle) =>
      handle(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

/** Presses Enter, as the keymaps see it. */
function press(view: EditorView, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    ...modifiers,
    bubbles: true,
    cancelable: true,
  });
  view.someProp('handleKeyDown', (handle) => handle(view, event));
}

const select = (view: EditorView, from: number, to: number) => {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
};

const OUTSIDE = 'h1, h2, h3, h4, h5, h6, blockquote, pre, hr, img, table, s, del';

describe('the markdown editor', () => {
  it('opens the subset as formatting, and gives back markdown the renderer shows the same', async () => {
    const markdown =
      'Mix **well**, _gently_ and `slowly`.\nThen rest.\n\n- Flour\n- Water\n\n3. Knead\n4. Bake\n\n[The original](https://example.com/bread)';
    const { root, editor, reported } = await open(markdown);

    expect(root.querySelector('strong')?.textContent).toBe('well');
    expect(root.querySelector('em')?.textContent).toBe('gently');
    expect(root.querySelector('code')?.textContent).toBe('slowly');
    expect(root.querySelectorAll('ul li')).toHaveLength(2);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/bread');

    // Changing something, then changing it back, reports the markdown.
    const view = editor.view();
    type(view, ' ');
    view.dispatch(view.state.tr.delete(view.state.selection.from - 1, view.state.selection.from));
    expect(renderMarkdown(reported.markdown)).toBe(renderMarkdown(markdown));
  });

  /** A page's formatting and words, without what only the editor adds, to compare it with. */
  function shape(node: globalThis.Node): string {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/\n/g, '');
    }
    if (!(node instanceof Element)) return '';
    if (node.matches('.ProseMirror-trailingBreak, .ProseMirror-separator')) return '';
    const inner = [...node.childNodes].map(shape).join('');
    const tag = node.tagName.toLowerCase();
    // The editor's list items hold paragraphs, where a tight list's don't.
    if (tag === 'div' || (tag === 'p' && node.parentElement?.tagName === 'LI')) return inner;
    // An empty editor has an empty paragraph to type in.
    if (tag === 'p' && inner === '') return '';
    if (tag === 'br') return '⏎';
    // An address the renderer drops leaves an anchor that goes nowhere: its words.
    if (tag === 'a') {
      return node.hasAttribute('href') ? `a[${node.getAttribute('href') ?? ''}](${inner})` : inner;
    }
    if (tag === 'ol') return `ol@${node.getAttribute('start') ?? '1'}(${inner})`;
    return `${tag}(${inner})`;
  }
  const rendered = (markdown: string) => {
    const page = document.createElement('div');
    page.innerHTML = renderMarkdown(markdown);
    return shape(page);
  };

  it.each([
    ['the subset', 'Mix **well**, _gently_ and `slowly`.\nThen rest.'],
    ['line breaks of each kind', 'One\\\nTwo  \nThree\nFour'],
    ['lists, numbered from where they start', '- Flour\n- Water\n\n3. Knead\n4. Bake\n\n1) Rest'],
    ['a loose list, and lists in lists', '- Flour\n\n  - sifted\n\n- Water'],
    [
      'links of each kind',
      '[One](https://example.com/one), <https://example.com/two> and example.com/three',
    ],
    ['a link written as a reference', 'See [the rolls][1].\n\n[1]: /recipes/abc'],
    ['links the renderer drops', '[run](javascript:alert(1)) and [call](tel:123)'],
    ['escapes and entities', 'Tom &amp; Jerry, \\*not italic\\*'],
    ['a heading, with formatting in it', '# A *simple* loaf\n\nBefore you start\n===='],
    ['a quote', '> A **bold** note\n> on two lines'],
    ['a rule', 'Rest it.\n\n---\n\n***'],
    ['a fenced code block', '```\nstir\n```\n\n```js\nlet x = 1;\n```'],
    ['a list in a code block', '```\n- a\n```'],
    ['an indented code block', 'Intro.\n\n    indented code'],
    ['an image', '![The loaf](https://example.com/loaf.jpg)'],
    ['raw HTML', '<b onclick="steal()">hi</b>\n\n<div>\nblock\n</div>'],
    ['a heading and a quote in a list', '- # Flour\n  > quoted'],
    ['nothing', ''],
  ])('opens %s as the renderer shows it, and saves it so', async (_, markdown) => {
    const { root, view, reported } = await open(markdown);

    expect(shape(root)).toBe(rendered(markdown));

    // Saved after a change made and undone, it still shows the same.
    const at = Selection.atStart(view.state.doc).from;
    view.dispatch(view.state.tr.insertText('x', at));
    view.dispatch(view.state.tr.delete(at, at + 1));
    expect(rendered(reported.markdown)).toBe(rendered(markdown));
  });

  it.each([
    'Mix **well**, *gently* and `slowly`.',
    'Mix __well__ and _gently_.',
    'One\\\nTwo',
    '- Flour\n- Water',
    '- Flour\n\n- Water',
    '3. Knead\n4. Bake',
    '1. Mix\n   - flour\n   - water\n2. Bake',
    'See [the rolls](/recipes/rolls "Soft rolls").',
  ])('saves %j as it was written', async (markdown) => {
    const { view, reported } = await open(markdown);

    const at = Selection.atStart(view.state.doc).from;
    view.dispatch(view.state.tr.insertText('x', at));
    view.dispatch(view.state.tr.delete(at, at + 1));

    expect(reported.markdown).toBe(markdown);
  });

  it.each(['* Flour\n* Water', '+ Flour\n+ Water'])(
    'saves %j with -, the way a list is usually written',
    async (markdown) => {
      const { view, reported } = await open(markdown);

      const at = Selection.atStart(view.state.doc).from;
      view.dispatch(view.state.tr.insertText('x', at));
      view.dispatch(view.state.tr.delete(at, at + 1));

      expect(reported.markdown).toBe('- Flour\n- Water');
    },
  );

  it.each([
    ['# ', 'a heading'],
    ['## ', 'a heading'],
    ['> ', 'a quote'],
    ['```', 'a code block'],
    ['---', 'a rule'],
    ['~~gone~~ ', 'strikethrough'],
    ['![a](b.png) ', 'an image'],
  ])('keeps %j as text when typed, rather than making %s', async (typed) => {
    const { view, root, reported } = await open();

    type(view, `${typed}Flour`);
    press(view, 'Enter');

    expect(root.querySelector(OUTSIDE)).toBeNull();
    expect(root.textContent).toBe(`${typed}Flour`);
    // Saved escaped where it would be markdown, so the recipe shows it as typed too.
    expect(renderMarkdown(reported.markdown)).not.toMatch(/<(h\d|blockquote|pre|hr|img|s|del)\b/);
    expect(
      new DOMParser().parseFromString(renderMarkdown(reported.markdown), 'text/html').body
        .textContent,
    ).toContain(typed.trim());
  });

  it('makes lists, bold, italic and code from what’s typed, as the toolbar does', async () => {
    const { view, reported } = await open();

    type(view, '- **Flour** and *water*, `500 g`');
    press(view, 'Enter');
    type(view, 'Salt');

    const html = renderMarkdown(reported.markdown);
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Flour</strong>');
    expect(html).toContain('<em>water</em>');
    expect(html).toContain('<code>500 g</code>');
    expect(html).toContain('<li>Salt</li>');
  });

  it('keeps pasted HTML to the subset', async () => {
    const { view, root, reported } = await open();

    view.pasteHTML(
      '<h1>Pasted heading</h1><blockquote>A quote</blockquote><p><b>Bold</b> <img src="https://example.com/x.png"> <s>gone</s></p><pre>code</pre><table><tr><td>cell</td></tr></table>',
    );

    expect(root.querySelector(OUTSIDE)).toBeNull();
    expect(root.querySelector('strong')?.textContent).toBe('Bold');
    for (const text of ['Pasted heading', 'A quote', 'gone', 'code', 'cell']) {
      expect(root.textContent).toContain(text);
    }
    expect(reported.markdown).not.toContain('<');
  });

  it('keeps pasted markdown as text', async () => {
    const { view, root } = await open();

    view.pasteText('# Heading\n> quote\n**bold**');

    expect(root.querySelector(`${OUTSIDE}, strong`)).toBeNull();
    expect(root.textContent).toContain('# Heading');
  });

  it('keeps line breaks as typed, without saving empty paragraphs as HTML', async () => {
    const { view, root, reported } = await open('Mix.\nAdd the water.');

    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    press(view, 'Enter', { shiftKey: true });
    type(view, 'Rest.');
    press(view, 'Enter');
    press(view, 'Enter');
    type(view, 'Bake.');

    // The empty paragraph between them is there while editing, and left out when saved.
    expect([...root.querySelectorAll('p')].map((paragraph) => paragraph.textContent)).toEqual([
      'Mix.Add the water.Rest.',
      '',
      'Bake.',
    ]);
    expect(root.querySelectorAll('p:first-child br')).toHaveLength(2);
    expect(reported.markdown).not.toContain('<br');
    expect(renderMarkdown(reported.markdown)).toBe(
      '<p>Mix.<br>\nAdd the water.<br>\nRest.</p>\n<p>Bake.</p>\n',
    );
  });

  describe('its formatting actions', () => {
    it('toggles bold and italic on the selection, and says which are on', async () => {
      const { editor, view, reported } = await open('Mix the flour.');
      select(view, 5, 8);

      editor.toggleStrong();
      expect(reported.formatting).toMatchObject({ strong: true, emphasis: false });
      editor.toggleEmphasis();
      expect(reported.formatting).toMatchObject({ strong: true, emphasis: true });
      expect(renderMarkdown(reported.markdown)).toBe(
        '<p>Mix <em><strong>the</strong></em> flour.</p>\n',
      );

      editor.toggleStrong();
      editor.toggleEmphasis();
      expect(reported.formatting).toMatchObject({ strong: false, emphasis: false });
      expect(renderMarkdown(reported.markdown)).toBe('<p>Mix the flour.</p>\n');
    });

    it('turns bold on and off for what’s typed next, with nothing selected', async () => {
      const { editor, view, reported } = await open();
      type(view, 'A ');

      editor.toggleStrong();
      expect(reported.formatting).toMatchObject({ strong: true });
      type(view, 'crusty');
      editor.toggleStrong();
      expect(reported.formatting).toMatchObject({ strong: false });
      type(view, ' loaf');

      expect(reported.markdown).toBe('A **crusty** loaf');
    });

    it('makes the selection code, in place of other formatting, and back', async () => {
      const { editor, view, reported } = await open('Bake at **200 C**.');
      select(view, 9, 14);

      editor.toggleInlineCode();
      expect(reported.formatting).toMatchObject({ inlineCode: true, strong: false });
      expect(renderMarkdown(reported.markdown)).toBe('<p>Bake at <code>200 C</code>.</p>\n');

      editor.toggleInlineCode();
      expect(reported.formatting).toMatchObject({ inlineCode: false });
      expect(renderMarkdown(reported.markdown)).toBe('<p>Bake at 200 C.</p>\n');
    });

    it('turns lists on, off, and from one kind to the other', async () => {
      const { editor, reported } = await open('Flour');

      editor.toggleList('bulletList');
      expect(reported.formatting).toMatchObject({ bulletList: true, orderedList: false });
      expect(renderMarkdown(reported.markdown)).toBe('<ul>\n<li>Flour</li>\n</ul>\n');

      editor.toggleList('orderedList');
      expect(reported.formatting).toMatchObject({ bulletList: false, orderedList: true });
      expect(renderMarkdown(reported.markdown)).toBe('<ol>\n<li>Flour</li>\n</ol>\n');

      editor.toggleList('orderedList');
      expect(reported.formatting).toMatchObject({ bulletList: false, orderedList: false });
      expect(renderMarkdown(reported.markdown)).toBe('<p>Flour</p>\n');
    });

    it('changes the kind of the whole list from any of its items, keeping its nesting', async () => {
      const { editor, view, reported } = await open('1. Flour\n2. Water\n   - cold\n3. Salt');
      select(view, 14, 14);

      editor.toggleList('bulletList');
      expect(renderMarkdown(reported.markdown)).toBe(
        '<ul>\n<li>Flour</li>\n<li>Water\n<ul>\n<li>cold</li>\n</ul>\n</li>\n<li>Salt</li>\n</ul>\n',
      );
      expect(reported.formatting).toMatchObject({ bulletList: true, orderedList: false });

      editor.toggleList('orderedList');
      expect(renderMarkdown(reported.markdown)).toBe(
        '<ol>\n<li>Flour</li>\n<li>Water\n<ul>\n<li>cold</li>\n</ul>\n</li>\n<li>Salt</li>\n</ol>\n',
      );
    });

    it('says a list is on when everything in it is selected', async () => {
      const { view, reported } = await open('1. Flour\n2. Water');

      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));

      expect(reported.formatting).toMatchObject({ orderedList: true, bulletList: false });
    });

    it('works on everything selected', async () => {
      const { editor, view, reported } = await open('Flour\n\nWater');
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));

      editor.toggleList('orderedList');
      expect(reported.formatting).toMatchObject({ orderedList: true });
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      editor.toggleList('bulletList');
      expect(reported.formatting).toMatchObject({ bulletList: true, orderedList: false });
      expect(renderMarkdown(reported.markdown)).toBe(
        '<ul>\n<li>Flour</li>\n<li>Water</li>\n</ul>\n',
      );
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      editor.toggleList('bulletList');
      expect(renderMarkdown(reported.markdown)).toBe('<p>Flour</p>\n<p>Water</p>\n');
    });

    it('links the selection, changes a link the cursor is in, and removes it', async () => {
      const { editor, view, reported } = await open('See the rolls today.');
      select(view, 5, 14);

      editor.setLink('/recipes/rolls');
      expect(renderMarkdown(reported.markdown)).toContain('<a href="/recipes/rolls"');
      expect(reported.formatting?.link).toBe(true);

      select(view, 8, 8);
      expect(editor.linkAt()).toEqual({ from: 5, to: 14, href: '/recipes/rolls' });
      editor.setLink('https://example.com/rolls');
      expect(renderMarkdown(reported.markdown)).toContain(
        'See <a href="https://example.com/rolls" rel="ugc nofollow noopener noreferrer">the rolls</a> today.',
      );

      editor.removeLink();
      expect(renderMarkdown(reported.markdown)).toBe('<p>See the rolls today.</p>\n');
      expect(editor.linkAt()).toBeNull();
    });

    it('puts in the address itself, linked, when nothing is selected', async () => {
      const { editor, view, reported } = await open('See ');
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

      editor.setLink('https://example.com');

      expect(renderMarkdown(reported.markdown)).toContain('>https://example.com</a>');
    });

    it('puts in the text it was given, linked, when nothing is selected', async () => {
      const { editor, view, reported } = await open();
      type(view, 'See ');

      editor.setLink('/recipes/rolls', 'the rolls');
      type(view, '.');

      expect(renderMarkdown(reported.markdown)).toBe(
        `<p>See <a href="/recipes/rolls" rel="${USER_LINK_REL}">the rolls</a>.</p>\n`,
      );
    });
  });

  it('takes new content from outside', async () => {
    const { editor, root, reported } = await open('Old.');

    editor.replace('New **step**.');

    expect(root.querySelector('strong')?.textContent).toBe('step');
    expect(renderMarkdown(reported.markdown)).toBe('<p>New <strong>step</strong>.</p>\n');
  });

  it('leaves Tab and Shift+Tab to move focus, and indents lists with Mod+] and Mod+[', async () => {
    const { view, reported } = await open('- Flour\n- Water');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
      expect(view.someProp('handleKeyDown', (handle) => handle(view, tab))).toBeFalsy();
    }
    press(view, ']', { ctrlKey: true });
    expect(renderMarkdown(reported.markdown)).toBe(
      '<ul>\n<li>Flour\n<ul>\n<li>Water</li>\n</ul>\n</li>\n</ul>\n',
    );
    press(view, '[', { ctrlKey: true });
    expect(renderMarkdown(reported.markdown)).toBe('<ul>\n<li>Flour</li>\n<li>Water</li>\n</ul>\n');
  });

  it('toggles lists with Mod+Alt+8 and Mod+Alt+7, as the toolbar does', async () => {
    const { view, reported } = await open('Flour\n\nWater');
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));

    press(view, '8', { ctrlKey: true, altKey: true });
    expect(renderMarkdown(reported.markdown)).toBe('<ul>\n<li>Flour</li>\n<li>Water</li>\n</ul>\n');
    press(view, '7', { ctrlKey: true, altKey: true });
    expect(renderMarkdown(reported.markdown)).toBe('<ol>\n<li>Flour</li>\n<li>Water</li>\n</ol>\n');
  });

  it('asks for a link on Mod+K', async () => {
    const { view, reported } = await open('See the rolls.');

    press(view, 'k', { ctrlKey: true });

    expect(reported.linkShortcuts).toBe(1);
  });

  it('focuses with the cursor at the end, to carry on writing', async () => {
    const { editor, view, reported } = await open('Mix.\n\n- Flour');

    editor.focusAtEnd();
    type(view, ' and water');

    expect(view.hasFocus()).toBe(true);
    expect(renderMarkdown(reported.markdown)).toContain('<li>Flour and water</li>');
  });

  it('gives the editable element the attributes it was given', async () => {
    const { root } = await open();

    const editable = root.querySelector('[contenteditable]');
    expect(editable?.getAttribute('role')).toBe('textbox');
    expect(editable?.getAttribute('aria-label')).toBe('Step');
  });
});
