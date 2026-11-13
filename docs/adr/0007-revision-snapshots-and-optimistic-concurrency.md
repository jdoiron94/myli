---
status: accepted
date: 2026-11-13
---

# Revision snapshots and optimistic concurrency

## Context and Problem Statement

Recipes need:
- draft and published states
- a full revision history recording which user made each change
- comparing any two revisions
- restoring an earlier revision

Editors can edit each other's shared recipes, so two people may edit the same recipe at once. How should history be stored, and how should simultaneous edits be handled?

## Decision Drivers

- **Simple, fast reads.** Search, lists, cook mode and public links read the published recipe from normal tables, with no history to replay.
- **History is immutable.** Restoring never rewrites or deletes it.
- **No silent lost updates** when two editors save overlapping changes.
- **Old revisions stay readable** as the recipe schema evolves.
- **Proportionate:** no real-time collaboration infrastructure for a household app.

## Considered Options

**History storage**
- A full-document snapshot per published revision
- Event sourcing
- Row-level history tables maintained by triggers
- Stored diffs or patches between revisions

**Handling simultaneous edits**
- Last write wins
- Pessimistic edit locks
- Optimistic concurrency with a version, `ETag` and `If-Match`
- Real-time collaborative editing (CRDTs)

## Decision Outcome

Chosen options: **full-document snapshots per publish** and **optimistic concurrency with `ETag`/`If-Match`**.

**How a recipe is stored**
- The live recipe tables hold the published version. `recipe.draft_json` holds the single draft, if one exists.
- Publishing, in one transaction:
  1. writes the draft into the live tables
  2. inserts a `recipe_revision` holding a full JSON snapshot, the author, the timestamp and an optional message
  3. clears the draft
  4. queues a search-index job ([ADR 0003](./0003-meilisearch-with-transactional-outbox.md))

**Snapshots**
- Every snapshot includes a `schemaVersion`.
- When the recipe schema changes, old snapshots are **upgraded when read**, by a chain of small, pure, tested functions. Stored snapshots are never rewritten.
- Snapshots refer to images by ID. An image is deleted only when no revision of any recipe refers to it ([ADR 0004](./0004-blob-storage-abstraction-without-minio.md)).

**Comparing revisions**
- Both snapshots are upgraded to the current schema, then diffed when viewed:
  - a structural diff: metadata fields, ingredients and steps added, removed, changed or moved
  - jsdiff for text inside markdown fields
- Diffs are never stored.

**Restore**
- Restoring publishes the old snapshot as a **new** revision, with the message "Restored from revision #n".
- An existing draft is kept. That draft is now out of date, so publishing it later hits the concurrency check below.

**Optimistic concurrency**
- `recipe.version` goes up by one on every write to the draft or the published state.
- Responses include a strong `ETag: "<version>"`.
- Every write to a recipe or its draft (edit, publish, restore, delete) must send `If-Match`. The update is conditional (`... WHERE id = ? AND version = ?`), so checking and writing can't race.

**Status codes**

| Situation | Response |
|---|---|
| `If-Match` header missing | `428 Precondition Required` |
| `If-Match` version is out of date | `412 Precondition Failed`, with a `problem+json` body containing the current version and the draft, so the client can show what changed and let the user reapply their edits |

These are the codes HTTP defines for conditional requests. They replace the `409` in the first draft of the spec.

### Consequences

- Good, because reads never touch history. The live tables are always the published recipe.
- Good, because each snapshot stands alone. Viewing, comparing or restoring any revision needs just one or two rows, with no replay.
- Good, because history is truly append-only, and restoring is just another publish.
- Good, because lost updates are impossible. A stale write always fails loudly, with what's needed to recover.
- Good, because using the standard HTTP conditional-request codes (`412`, `428`) means generic clients and tooling understand the behavior.
- Bad, because snapshots use more storage than diffs would. Recipe snapshots are only a few kilobytes, so keeping all of them costs little (spec open question 4).
- Bad, because schema changes need an upgrade function for snapshots, in addition to the database migration. It's a small, testable cost, and the alternative is unreadable history.
- Bad, because one editor can lose a save race and has to reapply their change. That's acceptable at household scale, and the conflict response makes it easy.

### Confirmation

- Publishing tests confirm that the live tables, the new revision, the cleared draft, and the search job are all written in one transaction.
- Concurrency tests:
  - a write without `If-Match` gets `428`
  - an out-of-date `If-Match` gets `412` with the current state
  - two simultaneous publishes with the same version: exactly one wins
- Restore tests confirm restoring creates a new revision, leaves earlier ones untouched, and makes an existing draft out of date.
- Upgrade tests: for every snapshot `schemaVersion`, a stored example upgrades to the current schema and gives the expected diff.
- A test confirms that images referenced by any revision survive cleanup.

## Pros and Cons of the Options

### Full-document snapshots

- Good, because they're simple, stand alone, and make every history operation cheap.
- Bad, because they cost more storage, and they need upgrading on read as the schema changes.

### Event sourcing

- Good, because it captures intent at the finest level and makes any past state reconstructible.
- Bad, because every read needs replaying or projections. That's heavy machinery for the problem.

### Trigger-maintained history tables

- Good, because history is captured automatically by the database.
- Bad, because changes are recorded per row, not per published version. Rebuilding a whole revision means joining history across several tables.
- Bad, because triggers are logic hidden outside the codebase.

### Stored diffs or patches

- Good, because they're compact.
- Bad, because seeing any revision means applying a chain of patches, and one corrupt patch breaks everything after it.

### Last write wins

- Good, because it's trivial.
- Bad, because edits are silently lost when two editors overlap.

### Pessimistic edit locks

- Good, because conflicts can't happen at all.
- Bad, because abandoned locks (a closed tab, a phone left in a drawer) block other editors, so it needs expiry and lock-breaking UI.

### Optimistic concurrency (`ETag`/`If-Match`)

- Good, because it's standard HTTP, stateless, and makes lost updates impossible.
- Bad, because the user who loses a race has to reapply their change.

### Real-time collaborative editing (CRDTs)

- Good, because it gives the best experience when several people edit at once.
- Bad, because it would need WebSockets, CRDT state and presence: far more than a household needs. Live sync was ruled out elsewhere in the spec too.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.3 drafts, revisions and history
