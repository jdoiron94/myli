---
status: accepted
date: 2026-11-13
---

# Better Auth with instance-wide roles and custom invitations, no multi-tenancy

## Context and Problem Statement

myli is a single instance for one household, with no multi-tenancy. It needs:
- email + password authentication
- email verification and password reset
- three instance-wide roles: admin, editor, viewer
- invite-only sign-up, with invitations that expire, work once, and can be revoked
- a first-run setup that creates the first admin

Passkeys, 2FA and OIDC are explicitly out of scope. Which authentication library should we use, and how should roles and invitations be modeled without bringing in tenancy?

## Decision Drivers

- **No multi-tenancy concepts** anywhere in the data model or API.
- **No hand-rolled security code.** A maintained library handles password hashing, sessions, verification and reset.
- **Sessions stored in SQLite through Drizzle** ([ADR 0002](./0002-sqlite-as-source-of-truth.md)), with no external identity provider.
- **Works with Hono** ([ADR 0001](./0001-hono-with-openapi-from-zod.md)).
- **One authority for permissions:** the shared policy module, not several overlapping systems.
- **Free and self-hostable.**

## Considered Options

- Better Auth core + `admin` plugin + a custom invitations module
- Better Auth + `organization` plugin, used as one fixed organization
- Auth.js
- An external identity provider (Keycloak or Authentik)
- Hand-rolled authentication

## Decision Outcome

Chosen option: **Better Auth core** (email + password) with the **`admin` plugin** and a **custom invitations module**.

**Better Auth's job**
- password hashing
- cookie sessions, stored in SQLite through the Drizzle adapter
- email verification and password reset, sent through the app's mailer
- rate limiting on auth routes

**Roles**
- The `admin` plugin stores `role` (`admin`, `editor` or `viewer`) on the user.
- It provides user-management operations: set role, ban/unban, list users, revoke sessions. Only admins can call them.
- **Deactivation is a ban.** Banning a user revokes all of their sessions immediately.
- Better Auth only *stores* the role. **Every app-level permission decision goes through the shared policy module** (spec §2). Better Auth's own access-control features aren't used for recipe permissions.

**Public sign-up is disabled.** Accounts are created only in two ways:
- **First-run setup.**
  - A setup endpoint works only while the user table is empty.
  - The check and the insert run in one transaction, so two simultaneous setup requests can't both succeed.
  - Alternatively, env vars seed the first admin on startup.
- **Accepting an invitation:**
  1. The acceptance endpoint hashes the presented token.
  2. It claims the invitation atomically with a conditional update: `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now`. Exactly one request can win.
  3. It creates the user through Better Auth's server-side API, with the invited role. The email is marked verified, because following the link proves ownership of the address.
  4. If user creation fails, the claim is released.
  5. The exact Better Auth call for creating the user is chosen and tested in Phase 0.

**Invitation tokens**
- 32 random bytes; only the SHA-256 hash is stored
- expire after 7 days by default
- resending replaces the hash, which invalidates the earlier link
- if SMTP isn't configured, the admin can copy the link instead

### Consequences

- Good, because password storage, sessions, verification and reset come from a maintained library, not custom code.
- Good, because the data model stays tenant-free: no organization, member or active-organization concepts, and no organization IDs on queries.
- Good, because invitations are a small, fully owned module that's easy to reason about and test exhaustively: claiming, expiry, revocation, replay.
- Good, because there's only one permission authority (the policy module), so roles mean the same thing in the UI, the API and search.
- Bad, because we build invitations ourselves, when the organization plugin would have provided them. It's a small amount of code, and a clear boundary is worth it.
- Bad, because we depend on Better Auth's schema and upgrade path, so Better Auth versions must be pinned and its migrations reviewed when upgrading.

### Confirmation

- Invitation tests cover:
  - a valid acceptance creates exactly one user with the invited role
  - expired, revoked and already-used tokens are rejected
  - a resent invitation invalidates the old link
  - two simultaneous acceptances create one user
- Setup tests:
  - setup succeeds only while no users exist
  - two simultaneous setup requests create one admin
- Deactivation test: a banned user's existing session is rejected on its very next request.
- A test confirms that the public sign-up endpoint is disabled.

## Pros and Cons of the Options

### Better Auth core + `admin` plugin + custom invitations

- Good, because it covers exactly the requirements: roles without tenancy, with library-grade authentication.
- Bad, because the invitations module is ours to build and maintain.

### Better Auth + `organization` plugin (one fixed organization)

- Good, because invitations with expiry, roles and an invitation email hook come built in.
- Bad, because it brings in multi-tenancy anyway: organization and member tables, an "active organization" on every session, and organization IDs on every query. That contradicts the requirement to remove tenancy entirely.
- Bad, because roles would live on membership records instead of the user, so every permission check would need an extra join.

### Auth.js

- Good, because it's widely used and supports many OAuth providers.
- Bad, because it centers on OAuth, which is out of scope. Email + password through its credentials provider is discouraged, and features like database sessions are limited there.
- Bad, because there are no built-in roles or user-management features.

### External identity provider (Keycloak or Authentik)

- Good, because it's a full-featured, battle-tested identity platform.
- Bad, because it adds a heavy service to run, plus an OIDC integration. OIDC was explicitly ruled out.
- Bad, because it's far more than one household needs.

### Hand-rolled authentication

- Good, because we'd have full control.
- Bad, because security-critical code (hashing, sessions, reset flows) would be ours to get right and keep right. There's no good reason to take that on.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §2 roles and permissions, §3.1 accounts and access
