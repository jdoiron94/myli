---
status: accepted
date: 2026-11-26
---

# Nightly backups in the worker: one zip of the database and the photos on disk

## Context and Problem Statement

ADR 0002 chose SQLite partly for its backups: a scheduled `VACUUM INTO` snapshot alongside an archive of the uploads. It left open what makes them, where they go, what they hold once photos can live in S3 (ADR 0004), and how many are kept.

Until now the README told operators to stop the stack and archive its volumes with `tar`. Few households will do that every night, and copying a live SQLite file in WAL mode can give a copy that won't open.

How should myli back itself up?

## Decision Drivers

- **Nothing to set up:** an instance that runs is backed up, with no extra service, cron entry or credentials.
- **Consistent:** the database as it was at one moment, and every photo that copy names.
- **Not duplicating what a store does already:** an S3 bucket has its own ways to keep objects safe.
- **One file to keep or copy elsewhere,** and one command to restore it.
- **A household's worth of data:** megabytes of database and up to a few gigabytes of photos.

## Considered Options

- A job in the API's worker, writing one zip to a directory of its own
- A sidecar container that archives the volumes on a schedule, such as docker-volume-backup
- Litestream, replicating the database continuously to a bucket
- Leave it to the operator: volume snapshots, or the README's `tar` loop

## Decision Outcome

Chosen option: **a job in the worker** (`backups/backup.ts`).

- `backupJob` runs first in the daily jobs at 03:30, before the trash purge deletes anything, and when the API starts if the newest backup is more than a day old. It doesn't run on every start: a container that keeps restarting would push out the week's backups with copies of whatever is wrong.
- It copies the database with `VACUUM INTO`, then reads the photo keys that copy names. Both are synchronous on the API's one connection, so nothing changes in between. No photo the copy names can be deleted meanwhile: only jobs delete photos, and the worker runs one at a time.
- The zip holds `myli.db`, compressed, and `manifest.json`. When photos are kept in a directory (`BLOB_STORE=local`), it holds every size of every photo the copy names too, under `photos/`, stored as it is, read through the `BlobStore`, and the manifest names any the store didn't have.
- When photos are kept in S3, it holds none, and never reads the bucket. The manifest says so (`includesPhotos`). A bucket keeps its objects safe its own ways, such as versioning and replication, and reading every photo from it every night costs requests, and on AWS egress, for copies the bucket keeps already. Garage in Compose's `s3` profile is a single node with one copy of each photo, on the same machine: its volume is the operator's to back up, as the README says.
- It's written beside its final name and renamed once complete. Files are named after the time they were taken, in UTC (`myli-backup-2026-11-26T033000Z.zip`), so they sort by time. The newest `BACKUP_KEEP` are kept (7 by default; 0 turns backups off), and nothing else in `BACKUP_DIR` is touched.
- Run again, as after a crash or a restore, the job saves nothing if its file is already there.
- In Compose, `BACKUP_DIR` is `/backups`, a volume of its own, which an operator can swap for a directory on another disk.
- It refuses to write an archive zip can't hold without ZIP64, which fflate doesn't write: more than 4 GB, or more than 65,535 files.

### Consequences

- Good, because every instance is backed up by default, with nothing more to run.
- Good, because with photos on disk, one file holds everything a restore needs.
- Good, because with S3, a backup is the database alone, a few megabytes, and the bucket isn't read.
- Bad, because each backup is a full copy: seven backups that hold photos take seven times their space. `BACKUP_KEEP` trades history for space.
- Bad, because with S3, the photos are only as safe as the bucket keeps them. A restored backup can name photos deleted from the bucket since: those of recipes purged from the trash meanwhile, and photos dropped from drafts. A bucket that keeps old versions still has them.
- Bad, because `VACUUM INTO` blocks the API's event loop while it copies the database: well under a second for a household's, at 03:30.
- Bad, because a backup fails past 4 GB. That's thousands of photos; an instance that gets there needs ZIP64 or another format.
- Neutral: backups sit on the same machine unless the operator mounts another disk there or copies them off. The README says how.
- Neutral: Meilisearch isn't backed up (§4 of the spec); a restore queues a rebuild of the index. Nor is Caddy's certificate authority, which never changes once created.

### Confirmation

`backup.test.ts` runs the job and opens its zip: the database copy holds what the database did, every photo the store had is there, and the manifest names the one it lost; with photos in S3, it holds none and never reads the store. It checks that the newest are kept, that other files are left, that a second run saves nothing, and that a backup on startup is skipped after a recent one. The Compose stack's test checks that the API backs up on its first start, onto its volume, with photos on the stack that keeps them on disk and without on the one that keeps them in Garage.

## Pros and Cons of the Options

### A job in the worker

- Good, because it has the database connection and the blob store already, so the database and its photos are copied consistently.
- Good, because the job queue retries it and logs its failures like any other job.
- Bad, because it shares the API's process: a slow backup holds up other jobs while it runs.

### A sidecar container archiving the volumes

- Good, because it's generic, and can copy archives off the machine.
- Bad, because it can't copy SQLite consistently without stopping the API.
- Bad, because it's another service, which needs the Docker socket to stop containers.

### Litestream

- Good, because it replicates every change within seconds, so almost nothing is lost.
- Bad, because it needs a bucket to replicate to, and covers only the database.
- Bad, because it's another process to run, and its restores are its own.

### Leave it to the operator

- Good, because it's nothing to build.
- Bad, because most households won't, and a copy of a live database in WAL mode may not open.
