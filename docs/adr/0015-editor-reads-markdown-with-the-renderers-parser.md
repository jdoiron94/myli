---
status: accepted
date: 2026-11-17
---

# The markdown editor reads markdown with the renderer's parser

Amends one point of [ADR 0014](./0014-milkdown-kit-held-to-the-markdown-subset.md): how the editor reads the markdown it opens. The kit, the subset's schema, saving, the toolbar and lazy loading stand as ADR 0014 decided.

## Context and Problem Statement

ADR 0014 planned a remark plugin to turn markdown outside the subset "into a paragraph of the text that was typed, as the renderer shows it". Milkdown reads markdown with remark. The renderer (`apps/web/src/lib/markdown.ts`) reads it with markdown-it, from its `zero` preset with only the subset's rules on.

Building the editor showed that the two disagree on more than which nodes exist. Where the renderer leaves a construct as text, it still reads the inline syntax inside it. remark reads the construct as a whole, so its text is the construct's source:

| Markdown | The renderer shows | remark's node, as its text |
|---|---|---|
| `> A **bold** note` | "> A bold note", with "bold" in bold | `> A **bold** note` |
| `# A *simple* loaf` | "# A simple loaf", with "simple" in italic | `# A *simple* loaf` |
| `![The loaf](https://example.com/loaf.jpg)` | "!" and a link, "The loaf" | the whole image's source |
| A fenced code block of one line, `stir` | `stir` as inline code: three backticks open a code span too | the fences and the line |
| A fenced code block holding a line `- a` | the line as a list, since a list can interrupt a paragraph | the fences and the line |

The editor would open markdown like this, saved before or written through the API, differently from the recipe page. Once saved from the editor, the recipe page would show it differently too.

How should the editor read markdown, so that it opens what the recipe shows?

## Decision Drivers

- **The editor and the renderer agree** (ADR 0014's first driver), for markdown the editor didn't write too.
- **Markdown stays the stored format,** and saving stays Milkdown's.

## Considered Options

- remark, with a plugin for each case where the renderer reads differently
- The renderer's own parser: markdown-it's tokens, turned into the syntax tree Milkdown builds its document from

## Decision Outcome

Chosen option: **the renderer's own parser.**

- `markdown-tree.ts` turns the tokens of the renderer's markdown-it instance into the mdast nodes that Milkdown's commonmark preset reads: paragraphs, line breaks, bold, italic, inline code, links and lists. A unified parser plugin uses it in place of remark's.
- The rules are the renderer's by construction. Whatever it leaves as text, the editor opens as text, and whatever it reads inside that, the editor reads too. A link whose address the renderer drops opens as its words.
- Saving stays remark's (Milkdown's serializer). Milkdown's remark plugins, which work on what remark reads, aren't used: list numbers, bold and italic markers, and links written as references come from markdown-it's tokens instead.

### Consequences

- Good, because the editor opens exactly what the recipe shows, whatever the markdown, rather than matching a list of known differences.
- Good, because one module that maps a handful of token types replaces two remark plugins of ours and three of Milkdown's.
- Good, because it costs nothing to load: the editing pages already load markdown-it, to show each field rendered until it's edited.
- Bad, because the token mapping is ours to maintain. A markdown-it upgrade that changes its tokens needs it updated; the editor's tests catch that.
- Neutral: there are still two parsers, markdown-it reading and remark writing. The editor's tests save each sample and check that the renderer shows it the same.

### Confirmation

The editor's tests open markdown with each construct, in the subset and outside it, and compare what the editor shows with the renderer's HTML. Then they save it, and compare again. Markdown in the subset saves as it was written.

## Pros and Cons of the Options

### remark, with a plugin per difference

- Good, because it's how Milkdown reads markdown.
- Bad, because the differences are open-ended: any construct the renderer leaves as text can hold syntax it still reads.

### The renderer's parser

- Good, because the editor and the renderer can't disagree on what markdown says.
- Bad, because the token mapping is ours.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.2 Markdown
