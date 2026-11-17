import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * Renders what users write in markdown (descriptions, steps, later comments and notes) as HTML that
 * is safe to put in the page with `v-html`.
 *
 * Only a deliberately small subset is markdown here, the same one the editor offers (ADR 0006):
 * paragraphs and line breaks, bold and italic, lists, links and inline code. Anything else, like a
 * heading, a quote, a table, an image or raw HTML, is shown as the text that was typed.
 *
 * markdown-it starts from its `zero` preset, with only the rules for that subset turned on, so a new
 * version can't add syntax unnoticed. DOMPurify then keeps only the elements and attributes the
 * subset produces, as a second line of defense:
 * - no `style` attributes or `<style>` elements, which the Content Security Policy refuses
 * - links only to http(s), mailto and paths on this site
 */

const md = new MarkdownIt('zero', {
  // Bare addresses ("example.com/bread") become links.
  linkify: true,
  // A line break in what someone typed is one in the recipe, as they'd expect from a text box.
  breaks: true,
}).enable([
  'list',
  // "[the rolls][1]" with "[1]: /recipes/…" further down: a link written another way.
  'reference',
  'emphasis',
  'link',
  'autolink',
  'linkify',
  'backticks',
  'newline',
  'escape',
  'entity',
]);

/** markdown-it's renderer rule signature, which its types only give as a union member. */
type Rule = NonNullable<MarkdownIt['renderer']['rules']['link_open']>;

// Links lead away from someone else's writing: search engines shouldn't credit them to this site,
// and the site they lead to isn't told which recipe (or which private instance) they came from.
export const USER_LINK_REL = 'ugc nofollow noopener noreferrer';

const markLink: Rule = (tokens, index, options, _env, renderer) => {
  tokens[index]?.attrSet('rel', USER_LINK_REL);
  return renderer.renderToken(tokens, index, options);
};
md.renderer.rules.link_open = markLink;

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'ul', 'ol', 'li', 'a'];
const ALLOWED_ATTR = ['href', 'title', 'rel', 'start'];
// http(s) and mailto, or a path on this site. Not `//host` or `/\host`, which browsers read as
// another site.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|\/(?![/\\]))/i;
// DOMPurify checks every attribute's value against that pattern, except these (and a few of its
// own, like `title`), so a list's `start="3"` would be dropped without them.
const ADD_URI_SAFE_ATTR = ['rel', 'start'];

/**
 * How the renderer reads markdown, as markdown-it's tokens. The markdown editor reads it the same
 * way, so it opens just what the recipe shows (ADR 0015).
 */
export const markdownTokens = (source: string) => md.parse(source, {});

/** Whether a link's address is one the renderer keeps, rather than dropping it from the link. */
export const isShownLinkAddress = (href: string) => ALLOWED_URI_REGEXP.test(href);

/** Sanitized HTML for markdown that someone wrote. */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
