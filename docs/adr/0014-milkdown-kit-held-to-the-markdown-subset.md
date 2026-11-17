---
status: accepted
date: 2026-11-16
---

# Markdown is edited with Milkdown's kit, held to the subset, not with Crepe

Amends one point of [ADR 0006](./0006-structured-steps-and-milkdown.md): which part of Milkdown edits markdown. Structured steps, the markdown subset, rendering and lazy loading stand as ADR 0006 decided.

## Context and Problem Statement

ADR 0006 chose Milkdown's ready-made editor, Crepe, and a deliberately small markdown subset (paragraphs, bold and italic, lists, links, inline code), "enforced the same way in the editor and the renderer". The renderer now enforces it (`apps/web/src/lib/markdown.ts`): anything outside it is shown as the text that was typed.

Phase 1's plan started the editor with a spike: does Crepe work under the app's Content Security Policy (ADR 0012), and can it be held to the subset? If the editor lets someone make a heading that the recipe page then shows as `# Heading`, the two disagree.

The spike (2026-11-16) built three pages with Vite and served them with the app's exact policy. It typed and pasted into each in Chromium and Firefox through Playwright:

| | Crepe | Crepe's builder, four features | Milkdown's kit, the subset's nodes only |
|---|---|---|---|
| Typing `# `, `> `, three backticks, `---`, `~~x~~` | a heading, a quote, a code block, a rule, strikethrough | the same | text, saved escaped (`\# Heading`) |
| Pasting HTML with `<h1>` and `<blockquote>` | kept as a heading and a quote | the same | paragraphs |
| Opening saved markdown with a heading or a quote | a heading, a quote | the same | text, saved escaped |
| Policy violations | `font-src`: its stylesheet embeds a font as a `data:` URI | the same | none |
| JavaScript loaded with the editor (gzipped) | 455 KB, and 115 more chunks for CodeMirror's languages | 205 KB | 112 KB |

Crepe always loads Milkdown's full commonmark and GFM presets, with their input rules and a clipboard plugin that reads pasted markdown, even through its builder. Turning its features off removes their menus, not the nodes. It can't be held to the subset without replacing those presets, which is most of what Crepe is.

How should markdown be edited?

## Decision Drivers

- **The editor and the renderer agree.** What someone sees while editing is what the recipe page shows.
- **No policy exceptions** on the app's pages (ADR 0012).
- **Friendly to non-developers,** as ADR 0006 required: formatting from buttons and shortcuts, not markdown syntax.
- **Markdown stays the stored format.**
- **A small editing bundle,** loaded only on editing screens.

## Considered Options

- Crepe, with its features turned off
- Crepe, with its stylesheet's font overridden and its presets patched to the subset
- Milkdown's kit, with only the subset's nodes, and our own toolbar
- A plain textarea with a preview (ADR 0006's fallback)

## Decision Outcome

Chosen option: **Milkdown's kit, with only the subset's nodes, and our own toolbar.**

**The editor** (`MarkdownEditor.vue`, from group C's editor increments):
- **Schema:** only the commonmark preset's document, text, paragraph, hard break, emphasis, strong, inline code, link, bullet list, ordered list and list item, with their attributes, input rules, keymaps and commands. With no heading, quote, code block, rule, image, table or HTML node, nothing can make one: not typing, not a shortcut, not pasting.
- **Loading:** a remark plugin turns any markdown outside the subset (saved before, imported, or written through the API) into a paragraph of the text that was typed, as the renderer shows it.
- **Saving:** without Milkdown's "preserve empty line" plugin, which writes empty paragraphs as `<br />`: that's HTML, which the renderer would show as text.
- **Toolbar:** our own buttons (shadcn-vue), for bold, italic, inline code, link and the two lists, calling Milkdown's commands. It's styled with the app's theme, so it meets the contrast and keyboard rules the rest of the app does.
- **Loaded lazily** on editing screens only, and mounted only on the field being edited, as ADR 0006 planned.

### Consequences

- Good, because the subset is enforced by the editor's schema, so the editor can't produce what the renderer won't show.
- Good, because the editor causes no policy violations, and the app's policy stays exception-free.
- Good, because it loads about half of what Crepe's builder does, and a quarter of Crepe in full.
- Good, because the toolbar is ours, styled and tested like the rest of the app, rather than Crepe's own UI and icon font.
- Bad, because we build and maintain the toolbar and the link dialog that Crepe would have given us.
- Bad, because the kit's plugins are wired by hand, against the commonmark preset's individual exports. A Milkdown upgrade that renames or splits them needs that list updated; the editor's tests catch it.
- Neutral: markdown saved by the editor escapes syntax outside the subset (`\# Heading`), which the renderer shows as the text that was typed.

### Confirmation

- The editor's tests type and paste each construct outside the subset and check it stays text, and load saved markdown that has them.
- The end-to-end tests edit a recipe's description and steps in both browsers, under the real policy, which fails them on any violation (`e2e/tests/fixtures.ts`).
- A build test checks that the editor's chunk isn't loaded by the recipe page or cook mode.

## Pros and Cons of the Options

### Crepe, with its features turned off

- Good, because it's a finished editor, with a toolbar, link tooltip and menus.
- Bad, because headings, quotes, code blocks, rules, strikethrough and tables can still be typed or pasted in.
- Bad, because its stylesheet's `data:` font breaks the policy.
- Bad, because it's the heaviest option.

### Crepe, patched

- Good, because it keeps Crepe's UI.
- Bad, because the presets are wired inside Crepe: holding it to the subset means forking or monkey-patching it, which every upgrade would break.

### Milkdown's kit, the subset only

- Good, because the schema is the subset, there are no violations, and it's the lightest Milkdown option.
- Bad, because the toolbar and link dialog are ours to build.

### A plain textarea with a preview

- Good, because it's the smallest, with nothing to hold to a subset.
- Bad, because people see and type markdown syntax, which ADR 0006 rejected as unfriendly to non-developers.

## More Information

- The spike's pages and script were throwaway, built with `@milkdown/crepe` and `@milkdown/kit` 7.23.0 and Vite 8.3.7, and run with Playwright 1.65.0 in its Chromium and Firefox builds.
- Spec: [`docs/spec.md`](../spec.md), §3.2 Markdown
