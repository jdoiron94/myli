import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * Renders what users write in markdown (descriptions, steps, later comments and notes) as HTML that
 * is safe to put in the page with `v-html`.
 *
 * markdown-it never passes raw HTML through (`html: false`), so `<script>` is shown as text.
 * DOMPurify then keeps only the elements and attributes below, as a second line of defense:
 * - no `style` attributes or `<style>` elements, which the Content Security Policy refuses
 * - no images: the CSP only loads images from this site, and a step's photo is uploaded instead
 * - no tables, which would scroll sideways on a phone
 * - links only to http(s), mailto and paths on this site
 */

const md = new MarkdownIt({
  html: false,
  // Bare addresses ("example.com/bread") become links.
  linkify: true,
  // A line break in what someone typed is one in the recipe, as they'd expect from a text box.
  breaks: true,
});
md.disable(['image', 'table']);

/** markdown-it's renderer rule signature, which its types only give as a union member. */
type Rule = NonNullable<MarkdownIt['renderer']['rules']['link_open']>;

/** How far down to move headings, read from the `env` each render passes. */
interface RenderEnv {
  headingOffset: number;
}

// The page's own headings come first: a `#` in a step must not become a second <h1> (every page has
// exactly one), or outrank the section it sits in.
const shiftHeading: Rule = (tokens, index, options, env: RenderEnv, renderer) => {
  const token = tokens[index];
  if (token) token.tag = `h${String(Math.min(6, Number(token.tag.slice(1)) + env.headingOffset))}`;
  return renderer.renderToken(tokens, index, options);
};
md.renderer.rules.heading_open = shiftHeading;
md.renderer.rules.heading_close = shiftHeading;

// Links lead away from someone else's writing: search engines shouldn't credit them to this site,
// and the site they lead to isn't told which recipe (or which private instance) they came from.
md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index]?.attrSet('rel', 'ugc nofollow noreferrer');
  return renderer.renderToken(tokens, index, options);
};

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'hr',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
];
const ALLOWED_ATTR = ['href', 'title', 'rel', 'start'];
// http(s) and mailto, or a path on this site. Not `//host` or `/\host`, which browsers read as
// another site.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|\/(?![/\\]))/i;
// DOMPurify checks every attribute's value against that pattern, except these (and a few of its
// own, like `title`), so a list's `start="3"` would be dropped without them.
const ADD_URI_SAFE_ATTR = ['rel', 'start'];

export interface MarkdownOptions {
  /** The level a `#` heading becomes: one below the heading of the section it's shown in. */
  headingLevel: 2 | 3 | 4 | 5 | 6;
}

/** Sanitized HTML for markdown that someone wrote. */
export function renderMarkdown(source: string, { headingLevel }: MarkdownOptions): string {
  const env: RenderEnv = { headingOffset: headingLevel - 1 };
  return DOMPurify.sanitize(md.render(source, env), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
