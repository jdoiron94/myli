---
status: accepted
date: 2026-11-13
---

# Structured steps, with markdown edited in Milkdown

## Context and Problem Statement

Recipes have long-form text (description, step instructions, personal notes, comments) that benefits from light formatting. The original idea was a markdown editor for the recipe body. Two questions follow:
- Should instructions be one markdown document, or structured step records?
- Which editor should edit the markdown fields?

## Decision Drivers

- **Structure where features need it.** Revision diffs and cook mode work better on discrete steps than on free text.
- **Friendly to non-developers.** Household members shouldn't have to know markdown syntax.
- **Markdown as the stored format:** portable, diffable, and readable in exports.
- **Safe rendering** of user content. XSS must be impossible.
- **Works with Vue 3,** is maintained, and is permissively licensed.

## Considered Options

**Content model**
- One markdown document for all instructions
- Structured step records, each with a markdown body

**Editor**
- Milkdown (Crepe)
- md-editor-v3
- Tiptap
- Plain textarea with live preview

## Decision Outcome

**Content model: structured step records**
- Each step stores its position, a markdown body and an optional image (spec §3.2).
- Ingredients are structured records too, so the instructions don't contain the ingredient list as text.

**Editor: Milkdown (Crepe)**
- Milkdown is built on ProseMirror and uses remark to read and write markdown, so it stores markdown while editing as WYSIWYG.
- One configuration is shared by every markdown field: description, step bodies, notes and comments.

**A deliberately small markdown subset**, enforced the same way in the editor and the renderer:
- allowed: paragraphs, bold and italic, ordered and unordered lists, links, inline code
- not allowed: raw HTML, embedded images (images are structured fields), headings, tables

**Rendering**
- markdown-it with `html: false`, then DOMPurify as a second layer of defense, applied to all user markdown.
- Links get `rel="noopener noreferrer nofollow"`.

**Performance**
- A recipe can have many steps. The editor is mounted only on the step being edited; every other step shows rendered HTML.
- The editor bundle is lazy-loaded on the editing screens only, so read-only pages and cook mode never load it.

### Consequences

- Good, because steps are records, so revision diffs can report "step 3 changed" instead of a diff of one large text block ([ADR 0007](./0007-revision-snapshots-and-optimistic-concurrency.md)).
- Good, because cook mode, print view and JSON-LD export (`recipeInstructions` as a list of `HowToStep`) map directly onto steps.
- Good, because non-developers get a familiar formatting toolbar while storage stays plain markdown.
- Good, because the small subset keeps rendering predictable, and two sanitization layers make XSS impossible by construction.
- Bad, because WYSIWYG markdown editors re-serialize content, e.g. normalizing list markers or emphasis characters. The first edit of imported content may show formatting-only changes in a diff. Content written in the editor stays stable.
- Bad, because the step editor UI is more complex than a single textarea: add, remove and reorder steps, plus one editor at a time.
- Bad, because Milkdown and ProseMirror add noticeable weight to the editing bundle. Lazy loading keeps it out of every other page.

### Confirmation

- Rendering tests feed known XSS payloads through every markdown field: script tags, `javascript:` links, event-handler attributes, HTML entities. They assert that the sanitized output is inert.
- A test confirms that markdown outside the allowed subset renders as plain text and never executes.
- A bundle check confirms the editor chunk isn't loaded on recipe view or cook mode routes.
- E2E: create a recipe with several steps, reorder them, edit one step's formatting, and confirm the saved markdown and the rendered output.

## Pros and Cons of the Options

### One markdown document

- Good, because it's the simplest editing experience: one field.
- Bad, because cook mode and per-step images would need fragile parsing of numbered lists out of free text.
- Bad, because revision diffs are much less meaningful.

### Structured step records

- Good, because they enable clear diffs, per-step images, export to JSON-LD steps, and reordering.
- Bad, because editing them takes a more involved UI.

### Milkdown (Crepe)

- Good, because it's a WYSIWYG editor that stores markdown, with a ready-made Crepe UI and a Vue integration.
- Good, because it's MIT-licensed and built on mature ProseMirror and remark foundations.
- Bad, because the bundle is heavier, and it normalizes formatting when it serializes.

### md-editor-v3

- Good, because it's a mature Vue 3 split-pane markdown editor, simple to integrate.
- Bad, because users see and type raw markdown syntax, which is less friendly for non-developers.

### Tiptap

- Good, because it's an excellent, widely used ProseMirror-based editor with a strong Vue integration.
- Bad, because its native format is JSON or HTML, and markdown support is an extension layered on top. Markdown isn't its primary storage format.
- Bad, because some higher-level features are part of a paid offering, which makes it less clear what's free.

### Plain textarea with live preview

- Good, because it's the smallest and simplest, with no dependency.
- Bad, because it gives no formatting help and isn't friendly to non-developers.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.2 recipes, §3.6 cook mode, §3.7 import and export
