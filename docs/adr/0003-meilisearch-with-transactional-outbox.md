---
status: accepted
date: 2026-11-13
---

# Meilisearch as a separate search service, synced through a transactional outbox

## Context and Problem Statement

Search is central to myli:
- typo-tolerant full-text search
- autocomplete over ingredient names
- AND-filtering on several ingredients
- include and exclude filters on tags and allergens
- numeric range filters
- several sort orders
- counts for each filter value

A project requirement is that search runs as its own service, not inside the database. That raises two questions: which search engine to use, and how to keep it consistent with SQLite ([ADR 0002](./0002-sqlite-as-source-of-truth.md)), which remains authoritative.

## Decision Drivers

- **Requirement:** search is a separate service, not database full-text search.
- **Features out of the box:**
  - typo tolerance
  - facets with counts
  - facet-value search (ingredient autocomplete)
  - filters, including `NOT IN`
  - custom sorts
  - synonyms
- **Small footprint** for a home server: low memory, one container.
- **Consistency:** a committed recipe change must reach the index eventually, even if the search service was down at the time.
- **Authorization:** users must never see private recipes they don't own in search results.
- **Free and self-hostable**, with a license that will last.

## Considered Options

**Engine**
- Meilisearch Community Edition
- Typesense
- OpenSearch

**Sync strategy**
- Dual write: call the search engine inline in the request handler after the database commit
- Transactional outbox: write a job row in the same database transaction, and have a worker push it to the engine

## Decision Outcome

Chosen options: **Meilisearch Community Edition (MIT)**, kept in sync through a **transactional outbox** in SQLite.

**Engine**
- Meilisearch runs as the `meilisearch` service in Compose, with a pinned version and a persistent volume.
- Index settings are defined in code and applied idempotently on startup:
  - searchable attributes
  - filterable attributes
  - sortable attributes
  - ranking rules
  - synonyms
- Only the API talks to Meilisearch. It uses a scoped API key limited to the actions it needs. The master key is used only to create that key.

**Outbox**
- Every write that changes a recipe's search document inserts a row into the `job` table **in the same SQLite transaction** as the write itself. That includes publishing, rating changes, tag renames and merges, visibility changes, deleting, restoring and purging.
- An in-process worker in the API claims pending jobs, builds the recipe's full search document from SQLite, and sends it to Meilisearch as an upsert or delete.
- Jobs are idempotent: they always send the whole current document, never a delta. They retry with exponential backoff and are dead-lettered after a maximum number of attempts.

**Query path**
- The browser calls the API's search endpoint. The API turns query parameters into a Meilisearch query.
- The API always adds this filter:

  ```
  deleted = false AND (visibility = "shared" OR ownerId = <caller>)
  ```

**Rebuilding the index**
- Meilisearch is a derived read model and is never backed up.
- An admin action and a CLI command rebuild everything into a fresh index and swap it in atomically with `swap-indexes`.
- On startup, the API reindexes if the index is missing or empty.

### Consequences

- Good, because typo tolerance, facet counts, facet search and synonyms come built in. That would have been substantial custom work otherwise.
- Good, because the outbox guarantees that every committed change produces exactly one pending job. Nothing is lost if Meilisearch is down or the process crashes after commit.
- Good, because recipe writes never depend on search being available. If Meilisearch is down, only the search endpoints degrade (`503`).
- Good, because the index can always be rebuilt. Upgrading Meilisearch or recovering a corrupt index means "start fresh and reindex", with no dump or restore procedure.
- Bad, because there's one more service to run and monitor. It's light: a single small container.
- Bad, because search is **eventually consistent**. A newly published recipe takes a moment to appear in results. That's mitigated because after publishing, the UI goes to the recipe page, which reads from SQLite.
- Bad, because authorization is enforced in two places: the policy module, and the search filter. A mistake in the search filter would leak private recipes. That's mitigated by dedicated IDOR tests that run through search.
- Bad, because every new searchable or filterable field has to be added in three places: the document builder, the index settings, and a reindex.

### Confirmation

- **Outbox tests:**
  - a recipe write and its job commit together
  - a rolled-back write leaves no job
  - running a job twice gives the same index state
- **Integration tests** run against a real Meilisearch container (Testcontainers), covering:
  - each filter, sort and facet
  - ingredient AND-filtering and autocomplete
  - synonyms
- **IDOR tests** confirm that another user's private recipes, deleted recipes and drafts never show up in search results, for every role.
- **Degraded-mode test:** with Meilisearch unavailable, search returns `503` problem details, and recipe writes still succeed and queue jobs.

## Pros and Cons of the Options

### Meilisearch Community Edition

- Good, because it covers every search requirement without plugins, including facet search for autocomplete.
- Good, because it's a single binary and a small container, needs no schema definition, and is simple to configure.
- Good, because the Community Edition has been MIT-licensed since 2018. Only sharding is Enterprise-only (BUSL), and myli doesn't need it.
- Bad, because it runs on one node in the Community Edition. That doesn't matter at this scale.

### Typesense

- Good, because its features are comparable (typo tolerance, facets, synonyms) and it's also a single container.
- Neutral, because it's licensed GPL-3.0. That's fine for self-hosting, but more restrictive than MIT.
- Bad, because it needs an explicit collection schema up front, and its filter syntax is stricter. That adds a bit of friction as the document shape changes.

### OpenSearch

- Good, because it's the most powerful and flexible engine, and widely recognized.
- Bad, because it's JVM-based and needs 1–2 GB of memory even for a tiny index. That's heavy for a home server.
- Bad, because typo tolerance, autocomplete and facets all need hand-tuned analyzers and mappings.

### Dual write (inline in the request handler)

- Good, because it's the simplest to build, with no worker or job table.
- Bad, because a crash or network failure between the database commit and the search call leaves the index silently stale.
- Bad, because it couples request latency and success to the search service's availability.

### Transactional outbox

- Good, because index updates are guaranteed to happen eventually, with retries and visibility through the `job` table.
- Good, because the same `job` table also serves email, image processing and scheduled purges, with no Redis or broker needed.
- Bad, because it means a worker, retry and dead-letter handling, and eventual consistency.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.4 search and discovery, §4 search architecture
- Database full-text search (SQLite FTS5) was excluded by requirement and wasn't evaluated as an option.
