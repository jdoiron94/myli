import { describe, expect, it } from 'vitest';
import { renderMarkdown, USER_LINK_REL } from './markdown.ts';

/** The rendered HTML as elements, to query. */
function rendered(source: string) {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(source);
  return root;
}

const SITE = 'https://myli.test';

/** Whether a link may go where it points: http(s), mailto, or a path on this site. */
function safeHref(href: string | null) {
  if (href === null) return true;
  if (/^(?:https?|mailto):/i.test(href)) return true;
  return new URL(href, SITE).origin === SITE;
}

describe('renderMarkdown', () => {
  it('renders bold, italic and inline code', () => {
    expect(renderMarkdown('**Bold**, _soft_ and `code`')).toBe(
      '<p><strong>Bold</strong>, <em>soft</em> and <code>code</code></p>\n',
    );
  });

  it('keeps line breaks as they were typed, and paragraphs apart', () => {
    expect(renderMarkdown('Mix the flour.\nAdd the water.\n\nRest it.')).toBe(
      '<p>Mix the flour.<br>\nAdd the water.</p>\n<p>Rest it.</p>\n',
    );
  });

  it('renders lists, numbered ones starting where they were written', () => {
    const root = rendered('- Flour\n- Water\n\n3. Knead\n4. Rest');
    expect([...root.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'Flour',
      'Water',
    ]);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  // ADR 0006: the subset the editor offers, and nothing else. What's outside it stays as typed,
  // though a fenced block's backticks still make inline code, and an image's brackets a link.
  it('shows what’s outside the subset as text: headings, quotes, rules, code, strikethrough, tables and images', () => {
    for (const [, source, shown] of [
      ['a heading', '# Before you start', '# Before you start'],
      ['an underlined heading', 'Before you start\n====', '===='],
      ['a quote', '> Grandma’s note', '> Grandma’s note'],
      ['a rule', 'Rest it.\n\n---', '---'],
      ['a fenced code block', '```\nlet x = 1;\n```', 'let x = 1;'],
      ['an indented code block', '    let x = 1;', 'let x = 1;'],
      ['strikethrough', '~~gone~~', '~~gone~~'],
      ['a table', '| Flour | Water |\n|---|---:|\n| 500 g | 350 g |', '| Flour | Water |'],
      ['an image', '![The loaf](https://example.com/loaf.jpg)', '!The loaf'],
    ] as const) {
      const root = rendered(source);
      expect(
        root.querySelector('h1, h2, h3, h4, h5, h6, blockquote, hr, pre, s, table, img'),
        source,
      ).toBeNull();
      expect(root.textContent, source).toContain(shown);
    }
  });

  it('shows raw HTML as the text that was typed', () => {
    const source = '<script>alert(1)</script> <b style="color: red" onclick="steal()">hi</b>';
    const root = rendered(source);
    expect(root.textContent.trim()).toBe(source);
    expect(root.querySelector('script, b, [style], [onclick]')).toBeNull();
  });

  it('renders links, marked as written by users, with their titles', () => {
    const link = rendered(
      '[The original](https://example.com/bread "Where it came from")',
    ).querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/bread');
    expect(link?.getAttribute('title')).toBe('Where it came from');
    expect(link?.getAttribute('rel')).toBe(USER_LINK_REL);
    expect(USER_LINK_REL.split(' ')).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']),
    );
  });

  it('links bare addresses, email addresses, references and paths on this site', () => {
    const hrefs = (source: string) =>
      [...rendered(source).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs('From example.com/bread')).toEqual(['http://example.com/bread']);
    expect(hrefs('Ask cook@example.com')).toEqual(['mailto:cook@example.com']);
    expect(hrefs('<https://example.com/a>')).toEqual(['https://example.com/a']);
    expect(rendered('<https://example.com/a>').textContent.trim()).toBe('https://example.com/a');
    expect(hrefs('[The rolls](/recipes/abc)')).toEqual(['/recipes/abc']);
    expect(hrefs('See [the rolls][1].\n\n[1]: /recipes/abc')).toEqual(['/recipes/abc']);
  });

  it('never links where it shouldn’t: other schemes, other hosts, however they’re written', () => {
    for (const source of [
      '[a](javascript:alert(1))',
      '[a](JaVaScRiPt:alert(1))',
      '[a](java\tscript:alert(1))',
      '<javascript:alert(1)>',
      '[a](vbscript:msgbox(1))',
      '[a](data:text/html,<script>alert(1)</script>)',
      '[a](file:///etc/passwd)',
      '[a](//evil.example/)',
      '[a](/\\evil.example/)',
      '[a](\\\\evil.example)',
      '[a]( //evil.example)',
      '[a][1]\n\n[1]: //evil.example/',
    ]) {
      const root = rendered(source);
      for (const link of root.querySelectorAll('a')) {
        expect(safeHref(link.getAttribute('href')), link.outerHTML).toBe(true);
      }
      expect(root.textContent).not.toBe('');
    }
  });

  it('renders nothing for nothing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
