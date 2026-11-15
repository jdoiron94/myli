---
status: accepted
date: 2026-11-14
---

# Role changes and deactivation are written directly, in one transaction

Amends one point of [ADR 0005](./0005-better-auth-instance-roles-and-invitations.md), and narrows one decision driver of [ADR 0009](./0009-first-run-setup-claims-a-lock-row.md). Everything else in both stands.

## Context and Problem Statement

ADR 0005 chose Better Auth's admin plugin partly because "it provides user-management operations: set role, ban/unban". The plan was for server code to change roles and deactivate users through `auth.api.setRole` and `auth.api.banUser`.

Two rules have to hold around those changes:
- **At least one active admin remains.** First-run setup is closed for good once users exist, so an instance with no active admin couldn't be managed any more.
- **Every change is in the audit log** (spec §3.1).

`setRole` and `banUser` write in their own statements. better-sqlite3 transactions are synchronous, and the plugin's calls are asynchronous, so neither the last-admin check nor the audit event can share their transaction. Two admins demoting each other at the same moment would both pass the check, and both demotions would land: no admin left.

How do we make the check, the change and its audit event atomic?

## Decision Drivers

- **No interleaving can leave the instance without an active admin.**
- **A change and its audit event commit or roll back together,** as everywhere else (ADR 0003's outbox rule, applied to the audit log).
- **Better Auth keeps working unchanged:** its sign-in, session and ban checks must see the same data it would have written.

## Considered Options

- Write the `role` and `banned` columns and delete the user's sessions directly, in one `BEGIN IMMEDIATE` transaction with the checks and the audit event
- Keep `auth.api.setRole` and `banUser`, and serialize user-management requests with an in-process lock
- Keep the plugin calls, check afterwards, and undo a change that broke the rule

## Decision Outcome

Chosen option: **direct writes in one transaction**, in `apps/api/src/users/manage.ts`.

- **Role change:** `UPDATE user SET role`, the same column `setRole` writes.
- **Deactivation:** `banned = true`, with no reason and no expiry, plus `DELETE FROM session` for the user. That is what `banUser` does. The admin plugin then refuses the user's sign-ins, as it does for any ban.
- **Reactivation:** `banned = false`, clearing the reason and expiry, as `unbanUser` does.
- The check that the acting admin is still an active admin, the write and the audit event run in one `BEGIN IMMEDIATE` transaction. Two conflicting changes run one after the other, and the second sees the first.
- **That check is what keeps an active admin on the instance.** The request's guard saw the role the request started with. The transaction checks the actor again, through the policy module, as of now. The actor is then an active admin and can't change their own account, so they're still one when the change commits. When two admins demote or deactivate each other at the same moment, the second change finds its actor no longer an active admin and is refused with 403. A separate "is this the last active admin?" check could never fire, so there isn't one.
- **No role keeps any plugin permission.** The admin role held `set-role` and `ban` for these changes, plus `create`, `list`, `get` and the session permissions `list` and `revoke`. Nothing uses any of them now. The only plugin call left is `createUser`, made without a session, and the plugin skips the permission check for those. The plugin checks permissions only for calls made with a session, so with none granted, not even server code acting with an admin's session can change a role or ban someone through it.

ADR 0009's driver "Better Auth stays the only writer of its own tables" is narrowed: Better Auth stays the only writer of **users, credentials and new sessions**, where its hashing, ID format and hooks matter. The role and ban columns are plain state that the app owns. Deleting session rows is how Better Auth itself ends sessions.

This is safe because Better Auth keeps no copy of that state: its cookie cache is off (CLAUDE.md, Authentication) and there is no secondary storage. Every request reads the user and session from SQLite.

### Consequences

- Good, because no interleaving of role changes or deactivations can leave the instance without an active admin.
- Good, because each change and its audit event are atomic.
- Good, because the plugin's HTTP endpoints stay blocked, and its server-side calls are no longer needed for these changes, so no role needs any plugin permission.
- Bad, because a Better Auth upgrade that changed how the plugin stores roles or bans would need these writes updated. The schema check Better Auth runs on first use, and the tests for sign-in refusal and session revocation, would catch it.

### Confirmation

Tests in `apps/api/src/users/users.test.ts` cover:
- two admins demoting, or deactivating, each other at the same moment: exactly one succeeds, the other gets 403, and one active admin remains
- an admin demoted or deactivated just before their change runs is refused, whatever the target
- deactivation deletes every session of the user, refuses their sign-ins, and leaves other users' sessions alone
- a role change applies from the user's next request
- each change records its audit event

Tests in `apps/api/src/auth/auth.test.ts` check that no role has any plugin permission, and that the plugin refuses a role change or a ban even when server code passes an admin's session.

## Pros and Cons of the Options

### Direct writes in one transaction

- Good, because the database enforces the order of conflicting changes.
- Good, because it's the same pattern as invitations and setup: the decision and the write share a transaction.
- Bad, because it duplicates a few lines of what the plugin does.

### Plugin calls behind an in-process lock

- Good, because Better Auth still writes its own columns.
- Bad, because the audit event still can't share the change's transaction.
- Bad, because the guarantee would hold only within one API process. The database's lock holds across processes.

### Plugin calls, then check and undo

- Bad, because for a moment the instance can have no admin, and an undo can fail too.
- Bad, because the audit log would record changes that were then reverted.
