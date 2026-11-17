import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

const render = (source: string, headingLevel: 2 | 3 | 4 | 5 | 6 = 3) =>
  renderMarkdown(source, { headingLevel });

/** The rendered HTML as elements, to query. */
function rendered(source: string) {
  const root = document.createElement('div');
  root.innerHTML = render(source);
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
  it('renders emphasis, strikethrough and code', () => {
    expect(render('**Bold**, _soft_, ~~gone~~ and `code`')).toBe(
      '<p><strong>Bold</strong>, <em>soft</em>, <s>gone</s> and <code>code</code></p>\n',
    );
  });

  it('keeps line breaks as they were typed', () => {
    expect(render('Mix the flour.\nAdd the water.')).toBe(
      '<p>Mix the flour.<br>\nAdd the water.</p>\n',
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

  it('renders quotes, rules and code blocks, with no class from the code block’s language', () => {
    const root = rendered('> Grandma’s note\n\n---\n\n```js\nlet x = 1;\n```');
    expect(root.querySelector('blockquote')?.textContent.trim()).toBe('Grandma’s note');
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelector('pre')?.outerHTML).toBe('<pre><code>let x = 1;\n</code></pre>');
  });

  it('moves headings down below the section they’re shown in, never past h6', () => {
    const levels = (source: string, headingLevel: 2 | 3 | 4 | 5 | 6) =>
      [...new DOMParser().parseFromString(render(source, headingLevel), 'text/html').body.children]
        .map((element) => element.tagName)
        .filter((tag) => tag.startsWith('H'));

    expect(levels('# Dough\n## Filling\n###### Note', 3)).toEqual(['H3', 'H4', 'H6']);
    expect(levels('# Dough\n## Filling', 2)).toEqual(['H2', 'H3']);
    expect(levels('# Dough\n## Filling', 6)).toEqual(['H6', 'H6']);
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
    expect(link?.getAttribute('rel')).toBe('ugc nofollow noreferrer');
  });

  it('links bare addresses, email addresses and paths on this site', () => {
    const hrefs = (source: string) =>
      [...rendered(source).querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs('From example.com/bread')).toEqual(['http://example.com/bread']);
    expect(hrefs('Ask cook@example.com')).toEqual(['mailto:cook@example.com']);
    expect(hrefs('[The rolls](/recipes/abc)')).toEqual(['/recipes/abc']);
  });

  it.each([
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
  ])('never links where it shouldn’t: %s', (source) => {
    const root = rendered(source);
    for (const link of root.querySelectorAll('a')) {
      expect(safeHref(link.getAttribute('href')), link.outerHTML).toBe(true);
    }
    expect(root.textContent).not.toBe('');
  });

  it('shows no images, which only uploads provide', () => {
    const root = rendered('![The loaf](https://example.com/loaf.jpg) ![Here](/uploads/loaf.jpg)');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('The loaf');
  });

  it('shows no tables, keeping their text', () => {
    const root = rendered('| Flour | Water |\n|---|---:|\n| 500 g | 350 g |');
    expect(root.querySelector('table, [style]')).toBeNull();
    expect(root.textContent).toContain('500 g');
  });

  it('renders nothing for nothing', () => {
    expect(render('')).toBe('');
  });
});
