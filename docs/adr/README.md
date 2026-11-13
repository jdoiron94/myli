# Architecture Decision Records

This directory records significant architectural decisions, using [MADR 4](https://adr.github.io/madr/).

| # | Decision | Status |
|---|---|---|
| [0001](./0001-hono-with-openapi-from-zod.md) | Hono with OpenAPI generated from Zod | Accepted |
| [0002](./0002-sqlite-as-source-of-truth.md) | SQLite as the source of truth | Accepted |
| [0003](./0003-meilisearch-with-transactional-outbox.md) | Meilisearch as a separate search service, synced through a transactional outbox | Accepted |
| [0004](./0004-blob-storage-abstraction-without-minio.md) | Blob storage behind an interface, local volume by default, no MinIO | Accepted |
| [0005](./0005-better-auth-instance-roles-and-invitations.md) | Better Auth with instance-wide roles and custom invitations, no multi-tenancy | Accepted |
| [0006](./0006-structured-steps-and-milkdown.md) | Structured steps, with markdown edited in Milkdown | Accepted |
| [0007](./0007-revision-snapshots-and-optimistic-concurrency.md) | Revision snapshots and optimistic concurrency | Accepted |

## Adding an ADR

- **File name:** `NNNN-short-kebab-title.md`, numbered one higher than the latest.
- **Front matter:** `status` (`proposed`, `accepted`, `deprecated`, or `superseded by NNNN`) and `date`.
- **Sections:**
  - Context and Problem Statement
  - Decision Drivers
  - Considered Options
  - Decision Outcome, with Consequences and Confirmation
  - Pros and Cons of the Options
  - More Information (optional)
- **Accepted ADRs are never rewritten.** To change a decision, add a new ADR and mark the old one `superseded by NNNN`.
- **Add the new ADR to the table above.**
