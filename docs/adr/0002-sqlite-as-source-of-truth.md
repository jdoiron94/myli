---
status: accepted
date: 2026-11-13
---

# SQLite as the source of truth

## Context and Problem Statement

myli is a self-hosted, single-instance app for one household. It needs relational storage with transactions, foreign keys and migrations. Running it should be as simple as `docker compose up`, and backups should be easy for a non-specialist. Which database should be the system of record?

## Decision Drivers

- **Minimal operations:** no separate database server to provision, tune or upgrade.
- **Simple, reliable backups and restores.**
- **Fast, isolated tests** that need no external services.
- **Enough capacity** for one household: a handful of users and thousands of recipes, not millions.
- **Good TypeScript ORM support** with versioned migrations.
- **Free and self-hostable.**

## Considered Options

- SQLite via `better-sqlite3`
- PostgreSQL
- MariaDB / MySQL
- libSQL (SQLite fork) via `@libsql/client`

## Decision Outcome

Chosen option: **SQLite via `better-sqlite3`, accessed through Drizzle ORM**.

**Database file and connection**
- The database is a single file on a Docker volume that only the `api` container mounts.
- The `api` process, including its in-process job worker, is the only writer. The API runs as **exactly one replica**.
- Every connection opens with these PRAGMAs:
  - `journal_mode = WAL`
  - `busy_timeout = 5000`
  - `foreign_keys = ON`
  - `synchronous = NORMAL`

**Migrations**
- Drizzle defines the schema, and drizzle-kit generates versioned SQL migrations.
- Migrations are committed and applied automatically when the API starts, before it accepts traffic.

**Backups**
- A scheduled job writes a consistent snapshot with `VACUUM INTO`, alongside an archive of the uploads volume.
- The restore procedure is documented and tested.

**Scope**
- SQLite holds authoritative data only.
- It does **not** serve search, by explicit requirement ([ADR 0003](./0003-meilisearch-with-transactional-outbox.md)).

### Consequences

- Good, because nothing needs operating: no database container, credentials, connection pool or version upgrades.
- Good, because a backup is one consistent file plus the uploads directory, and restoring means copying them back.
- Good, because tests run against in-memory SQLite in milliseconds, each with a fresh, isolated database.
- Good, because `better-sqlite3` is synchronous and very fast for small queries, which keeps data-access code simple.
- Bad, because there is a single writer and no horizontal scaling. The API can't run multiple replicas. That's accepted for a single-household app.
- Bad, because `better-sqlite3` is synchronous, so a slow query blocks Node's event loop. Queries must stay small and indexed. Heavy work, like full exports, runs in the job worker in chunks.
- Bad, because SQLite's `ALTER TABLE` is limited. Some migrations need drizzle-kit's table-rebuild pattern, and they need reviewing before they're committed.
- Bad, because a later move to PostgreSQL wouldn't be a drop-in swap. Drizzle schemas are dialect-specific, so it would need a schema port and a data migration.
- Neutral, because SQLite has no row-level security. With no multi-tenancy, authorization lives in the application's policy layer anyway.

### Confirmation

- A startup test asserts that every PRAGMA is set as listed above.
- CI applies every migration to an empty database and runs the full test suite against the result.
- The backup job is tested end to end: create data, snapshot, restore into a fresh database, compare.
- Compose defines the `api` service with one replica and the only mount of the database volume.

## Pros and Cons of the Options

### SQLite via `better-sqlite3`

- Good, because it needs no server, lives in one file, and backs up trivially.
- Good, because it's the fastest SQLite driver for Node and Drizzle supports it fully.
- Good, because in-memory databases make integration tests quick and isolated.
- Bad, because it has a single writer, a synchronous API, and limited `ALTER TABLE`.

### PostgreSQL

- Good, because it's the most capable option: concurrency, row-level security, rich types, mature tooling.
- Good, because it's the most common production choice, and many readers know it.
- Bad, because it adds a container to run, upgrade (major versions need a dump and restore or `pg_upgrade`) and back up.
- Bad, because integration tests would need Testcontainers or a shared server, which makes them slower and more complex.
- Bad, because its capacity far exceeds what one household needs.

### MariaDB / MySQL

- Good, because it's mature and widely deployed.
- Bad, because it has the same operational cost as PostgreSQL, with weaker type and constraint support.
- Bad, because it offers no advantage here over either SQLite or PostgreSQL.

### libSQL via `@libsql/client`

- Good, because it's SQLite-compatible, async, and supports replication.
- Neutral, because its main advantages (remote and embedded replicas, edge deployment) don't apply to a single local instance.
- Bad, because it's a fork with a smaller ecosystem than upstream SQLite and `better-sqlite3`.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §5 data model and §6 operations
- Node's built-in `node:sqlite` module could replace `better-sqlite3` later, once Drizzle supports it well. That would be a driver change, not an architectural one.
