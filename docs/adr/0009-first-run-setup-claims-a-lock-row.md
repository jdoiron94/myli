---
status: accepted
date: 2026-11-14
---

# First-run setup takes a single-row claim instead of one transaction

Amends one point of [ADR 0005](./0005-better-auth-instance-roles-and-invitations.md). Everything else in ADR 0005 stands.

## Context and Problem Statement

ADR 0005 says the setup endpoint checks that the user table is empty and inserts the first admin "in one transaction, so two simultaneous setup requests can't both succeed".

That turned out not to be possible as written:
- Users are created through Better Auth's server-side API (`createUserWithPassword`), which is asynchronous.
- better-sqlite3 transactions are synchronous: a transaction can't wait for a promise.
- So the emptiness check and Better Auth's insert can't share a SQLite transaction.

How do we still guarantee that two simultaneous setups create exactly one admin?

## Decision Drivers

- **Exactly one first admin,** even when two setup requests arrive together.
- **Better Auth stays the only writer of its own tables,** so its hashing, ID format and hooks apply, and upgrades don't break hand-written inserts.
- **Setup can never get stuck,** even if the process crashes halfway.
- **The same pattern as invitations,** which ADR 0005 already protects with a claim that's released if user creation fails.

## Considered Options

- A single-row claim table, taken in a synchronous transaction together with the emptiness check
- Insert the user and credential rows directly with Drizzle inside one transaction, hashing the password first
- An in-process lock (a promise held while setup runs)

## Decision Outcome

Chosen option: **a single-row claim table.**

1. One synchronous transaction (`BEGIN IMMEDIATE`) checks that no user exists and inserts the only row of `setup_claim`, with the time it was taken.
   - If a user exists, setup answers `409`: already complete.
   - If the row already exists, another setup is running: `409`, already in progress.
2. The admin is created through `createUserWithPassword`.
3. The claim is released in a `finally`, whether that succeeded or failed. A setup only deletes the claim with its own timestamp.
4. A claim older than five minutes was left by a crash, and the next setup deletes it before taking its own.

Once the admin exists, the emptiness check alone keeps setup closed. Users are never hard-deleted, so it stays closed.

### Consequences

- Good, because two simultaneous setups produce exactly one admin and one `409`.
- Good, because Better Auth still creates the user, the same way invitations will.
- Good, because a crash mid-setup blocks setup for five minutes at most.
- Bad, because there's one more table, and the guarantee rests on the claim protocol rather than a single transaction.
- Neutral: Better Auth writes the user and their credential as two statements. A failure between them would leave a user without a password, which closes setup. That needs a hardware or disk failure at exactly that moment. An admin could then fix it from the database.

### Confirmation

Tests in `apps/api/src/setup/setup.test.ts` cover:
- two setups at once create exactly one admin
- a failed user creation releases the claim, and setup can be retried
- a recent claim blocks setup, and a stale one is taken over
- a setup never releases a claim that another one has taken over
- setup refuses once a user exists

## Pros and Cons of the Options

### Single-row claim table

- Good, because it works across processes, survives restarts, and keeps Better Auth in charge of its tables.
- Bad, because it needs the stale-claim rule for crash recovery.

### Direct inserts in one transaction

- Good, because the check and both inserts are truly atomic.
- Bad, because it duplicates Better Auth's internals: the ID format, the credential account's shape, and its hooks. An upgrade could silently diverge from it.

### In-process lock

- Good, because it's a few lines of code.
- Bad, because it only works within one process, and it doesn't stop a setup that runs while another process holds the database.

## More Information

- Implementation: `apps/api/src/setup/setup.ts`
- Spec: [`docs/spec.md`](../spec.md), §3.1 first-run setup
