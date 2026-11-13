---
status: accepted
date: 2026-11-13
---

# Blob storage behind an interface, local volume by default, no MinIO

## Context and Problem Statement

myli stores user-uploaded images: recipe photos, step photos, and their resized versions. Some self-hosters will want files on a local disk. Others will want S3-compatible storage, e.g. an existing home NAS service. The original idea was MinIO, but MinIO's Community Edition is no longer viable (see "More Information"). Where should blobs live, and how should storage be swapped?

## Decision Drivers

- **Simplest default:** `docker compose up` works with no extra storage service.
- **Optional S3-compatible backend,** for anyone who wants it.
- **Images follow recipe visibility.** A private recipe's photos must never be readable by other users.
- **Free and self-hostable,** with a maintained project and published container images.
- **Testable:** both backends have to behave identically.

## Considered Options

- Local filesystem only
- MinIO Community Edition
- Garage
- SeaweedFS
- RustFS
- A `BlobStore` interface with a local-filesystem default and an S3 adapter

## Decision Outcome

Chosen option: **a `BlobStore` interface** with two implementations:
- **Local filesystem (the default):** files on a Docker volume mounted only by the `api` container.
- **S3 (optional):** using AWS SDK v3, configured by env vars, and tested against **Garage**, which is available as the `s3` Compose profile.

**The interface**

```ts
interface BlobStore {
  put(key: string, body: Readable | Buffer, opts: { contentType: string }): Promise<void>
  get(key: string): Promise<{ body: Readable; contentType: string; size: number } | null>
  delete(key: string): Promise<void>
}
```

**Keys**
- Keys are opaque and immutable, in the form `images/<uuid>/<variant>.webp`.
- A changed image gets a new key and is never overwritten. That makes caching safe.

**Serving**
- Blobs are always served **through the API**, after the same authorization check as the recipe they belong to.
- No bucket or directory is ever publicly readable. There are no presigned URLs.
- Responses use `Cache-Control: private, max-age=31536000, immutable`.

**Lifecycle**
- An image is deleted only when no revision of any recipe still refers to it ([ADR 0007](./0007-revision-snapshots-and-optimistic-concurrency.md)).
- Deletion is carried out by a background job.

**Garage setup**
- Garage needs a one-time cluster layout, an access key and a bucket.
- The `s3` profile includes an init container that does this idempotently.

### Consequences

- Good, because the default deployment has no storage service, and backups mean archiving one directory alongside the SQLite snapshot.
- Good, because anyone who wants S3 can use any S3-compatible store (Garage, SeaweedFS, a NAS, a cloud bucket) by setting env vars.
- Good, because serving through the API keeps image access tied to recipe permissions. A private recipe's images can't leak through a guessable URL.
- Good, because the storage choice is isolated. If Garage meets the same fate as MinIO, the adapter is still plain S3.
- Bad, because every image request goes through Node. Long-lived immutable caching limits the cost, and at household scale it doesn't matter.
- Bad, because there are two implementations to maintain. That's mitigated by one shared contract test suite that runs against both.
- Neutral, because Garage is AGPL-3.0. It runs as a separate, unmodified service, so the license doesn't affect myli's code.

### Confirmation

- One contract test suite runs against both implementations: the local one in a temp directory, and the S3 one against Garage via Testcontainers. It covers put, get, delete, missing keys, content types and streaming.
- Authorization tests confirm that an image belonging to a private recipe returns `404` for every user except the owner.
- A test confirms that images referenced by any revision survive the cleanup job.

## Pros and Cons of the Options

### Local filesystem only

- Good, because it's the simplest option, with nothing extra to run.
- Bad, because there's no path to S3-compatible storage for anyone who wants one.

### MinIO Community Edition

- Good, because it was historically the default S3-compatible store for self-hosting, with familiar tooling.
- Bad, because the Community Edition moved to source-only distribution in October 2025 and its official container images were discontinued.
- Bad, because the project went into maintenance mode in December 2025 and was archived in 2026. CVEs have been disclosed against the last community release.
- Bad, because the vendor's path forward is the commercial AIStor product.

### Garage

- Good, because it's lightweight, designed for self-hosting, and runs fine as a single node.
- Good, because it's actively maintained and publishes container images.
- Bad, because a one-time layout, key and bucket setup is required. The init container handles it.
- Neutral, because it's licensed AGPL-3.0, which is fine for running unmodified as a separate service.

### SeaweedFS

- Good, because it's Apache-2.0, mature, and has a built-in S3 gateway.
- Bad, because it has more moving parts (master, volume and filer servers) than a household app needs.

### RustFS

- Good, because it's Apache-2.0 and designed as a MinIO-compatible drop-in.
- Bad, because it's a young project with less of a track record. That's a risk right after being burned by MinIO.

### `BlobStore` interface: local default plus S3 adapter

- Good, because the default is simple and S3 is optional. The decision about storage stays reversible.
- Bad, because there are two implementations, kept in line by a shared contract test suite.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.2 images and §6 operations
- MinIO status sources:
  - [MinIO CE in 2026: Retired Upstream, Source-Only](https://glukhov.org/data-infrastructure/object-storage/minio-dead/)
  - [MinIO Ends Active Development](https://linuxiac.com/minio-ends-active-development/)
  - [MinIO Support After Project Archival](https://tuxcare.com/blog/minio-els/)
