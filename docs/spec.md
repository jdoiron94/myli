# myli: Product Specification

| | |
|---|---|
| Status | Draft |
| Last updated | 2026-11-13 |
| Decisions | [`docs/adr/`](./adr/) |

## 1. Overview

myli is a self-hosted recipe manager for one household, run with Docker Compose. It stores structured recipes with revision history and finds them through fast faceted search. It scales recipes to any serving size, builds shopping lists from selected recipes, and has a cook mode for use in the kitchen.

**Principles**

- **Self-hosted and free.** Every dependency is free, self-hostable, and runs in the Compose stack.
- **One instance, one household.** There is no multi-tenancy. All users belong to the same instance and have instance-wide roles.
- **SQLite is the source of truth.** Everything else, including the search index, is derived and can be rebuilt.
- **Structured data over free text.** Ingredients and steps are records, not one markdown blob, so scaling, search and shopping lists work.

## 2. Roles and permissions

There are three roles: **admin**, **editor** and **viewer**.

- **Viewers** are strictly read-only.
- **Editors** can edit any shared recipe, whoever created it.
- Only a recipe's owner or an admin can delete it.

| Action | Admin | Editor | Viewer |
|---|---|---|---|
| View shared recipes, search, cook mode, print/download | ✓ | ✓ | ✓ |
| Create recipes (private or shared) | ✓ | ✓ | – |
| Edit or publish shared recipes (any author) | ✓ | ✓ | – |
| View private recipes | own | own | own¹ |
| Edit private recipes | own | own | – |
| Delete or restore from trash | any | own | – |
| Restore a revision | ✓ | ✓ (recipes they can edit) | – |
| Create or revoke public links | any | own | – |
| Comment, rate | ✓ | ✓ | – |
| Favorites, collections, personal notes, shopping lists | ✓ | ✓ | – |
| Create custom tags | ✓ | ✓ | – |
| Rename, merge or delete tags | ✓ | – | – |
| Delete others' comments | ✓ | – | – |
| Invite users, change roles, deactivate users | ✓ | – | – |
| View audit log; full-instance export | ✓ | – | – |

¹ Viewers can't create recipes. This covers the private recipes of an editor who was demoted to viewer: they can still read them, but no longer change them.

**Enforcement**

- The matrix is implemented once, as a policy module in `packages/shared`. The UI uses it to hide controls; the API uses it to enforce. Neither has inline role checks.
- **Private recipes are visible only to their owner,** admins included, on every read path: direct ID, search, revisions and public links.
- No one can act on a recipe they can't see. An admin's "any" in the table means any recipe they can see: shared recipes and their own private ones.
- A request for a resource the caller may not see returns `404`, so its existence isn't revealed. A request the caller may see but not act on returns `403`.

**Testing**

- The authorization tests are generated from this matrix: each role × each endpoint.
- Separate IDOR tests cover every read path for private recipes.

## 3. Features

### 3.1 Accounts and access

**First-run setup**
- While no users exist, the app shows a one-time setup screen that creates the first admin.
- Alternatively, environment variables can seed the first admin on startup.
- Once any user exists, setup is permanently unavailable.
- Two setups at the same moment create exactly one admin (ADR 0009). After setup, the new admin signs in with the same email and password.

**Invitations (sign-up is invite-only)**
- Public sign-up is disabled. An admin invites people by email and assigns a role up front.
- **Tokens:**
  - 32 random bytes; only the SHA-256 hash is stored
  - expire after 7 days by default (configurable)
  - single-use and revocable
  - resending invalidates the previous token and issues a new one
- **Accepting:** the invitee follows the link, the token is checked, and the user is created through Better Auth's server API with the invited role.
- **Without SMTP:** if SMTP isn't configured, the admin gets a **copy invite link** action instead of an email.
- Accepting creates exactly one user; replaying a used token fails.

**Account basics**
- email + password login
- **Passwords:** 15 to 128 characters, with at least one lowercase letter, one uppercase letter, one number and one special character. A special character is anything but a letter or a number, and a space counts. Letters and numbers from any script count. The same rules apply everywhere a password is set: setup, invitations, changing it and resetting it.
- email verification
- password reset
- rate limiting: Better Auth's built-in limiter on auth routes, and a general limiter on the rest of the API

**User lifecycle**
- Admins change roles and deactivate users. Users are never hard-deleted, so revision and comment authorship stays intact.
- An editor demoted to viewer keeps read-only access to their own private recipes (§2).
- Deactivating a user ends their sessions immediately.
- Before deactivation finishes, the admin chooses for the user's private recipes: transfer them to another user, or make them shared.

**Recipe visibility**

| Level | Who can see it |
|---|---|
| `private` | The owner only |
| `shared` | Every signed-in user |
| Public link | Anyone with the link. It's an add-on to a shared recipe, not a separate level. |

- A public link is read-only and uses an unguessable token.
- The owner or an admin can revoke it at any time.
- Making a recipe private revokes its public link.

**Audit log**
- Append-only; viewable by admins only.
- Records:
  - invitation created, resent, revoked, accepted
  - role changed
  - user deactivated or reactivated
  - successful and failed logins
  - recipe deleted, restored or purged
  - revision restored
  - public link created or revoked
  - full-instance export
- Each event stores actor, action, target, timestamp, IP address and user agent.
- The audit log is separate from revision history (§3.3), which records recipe content.

### 3.2 Recipes

**Fields**

| Field | Notes |
|---|---|
| Title | Required |
| Description | Markdown |
| Source | URL, book title, and/or author, all optional |
| Equipment | List of short strings |
| Yield | Free quantity + unit ("1 loaf", "24 cookies"), separate from servings |
| Servings | Integer; the baseline for scaling |
| Prep, cook, total time | Minutes. Total defaults to prep + cook and can be overridden. |
| Difficulty | `easy`, `medium`, `hard` |
| Nutrition (optional) | Per serving, entered by hand only: calories, protein, carbs, fat, fiber, sugar, sodium |
| Visibility | `private` or `shared` (§3.1) |

**Structured ingredients**
- Ingredients sit in ordered **groups**, e.g. "For the dough" and "For the filling". A recipe with one group shows no group heading.
- **Each line stores:**
  - `raw_text`: exactly what the user typed
  - `qty`, `unit`, `name`, `note`: parsed by a rule-based ingredient parser and shown for the user to confirm or correct
  - `normalized_name`: lowercase, singular, note removed. Used for search and shopping-list aggregation.
  - `scalable`: defaults to true; false for lines like "salt to taste"
- There is no canonical ingredient catalog. Ingredient identity is the normalized name (see the limitation in §3.4).

**Structured steps**
- Steps are ordered records. Each has a markdown body and an optional image.
- Steps can be reordered, inserted and removed.

**Scaling**
- Choosing a different serving count scales every scalable quantity by `new / baseline`.
- **Display rules:**
  - show common fractions (⅛, ¼, ⅓, ½, ⅔, ¾) instead of decimals
  - round to sensible precision for the unit
  - convert up to larger units within the same system (48 tsp → 1 cup)
- Lines that aren't scalable never change.
- Each user picks metric or imperial as a display preference. Conversion stays within one dimension (volume, mass, count). Volume is never converted to weight or back.
- Scaling changes only the display. It never changes the stored recipe.

**Tags**
- One tag system with a type on each tag:

| Type | Values | Who manages them |
|---|---|---|
| `cuisine` | user-defined | Editors create; admins rename, merge or delete |
| `meal_type` | user-defined | Same |
| `diet` | user-defined (e.g. vegetarian, gluten-free) | Same |
| `allergen` | **fixed** seeded list: milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame | Can't be edited |
| `custom` | user-defined | Editors create; admins rename, merge or delete |

- Allergen and diet tags are set by hand. The UI shows a disclaimer that this information is entered by users and not verified.

**Images**
- Several images per recipe, one marked as the cover. Each step can have one image.
- **On upload:**
  - check the real file type from the file's first bytes (JPEG, PNG, WebP)
  - enforce a maximum size
  - strip EXIF metadata
  - generate resized variants
- Stored through the `BlobStore` abstraction (§6).

**Personal organization (editors and admins)**
- **Favorites:** a per-user flag on a recipe.
- **Collections:** named, per-user, ordered groups of recipes. Other users never see them.
- **Personal notes:** one private markdown note per user per recipe.

**Ratings and comments (editors and admins)**
- **Ratings:**
  - one rating per user per recipe, 1–5 stars; users can change or remove theirs
  - a recipe shows its average and number of ratings
  - sorting uses a Bayesian average (§3.4)
- **Comments:**
  - markdown, sanitized when rendered
  - authors can edit or delete their own
  - admins can delete anyone's

**Trash**
- Deleting a recipe moves it to the trash. It disappears from search and lists immediately.
- The owner or an admin can restore it.
- A scheduled job permanently purges recipes after the retention period (see Open questions).

### 3.3 Drafts, revisions and history

- **Published version.** The live recipe tables always hold the **published** version. That's what search, lists, cook mode and public links show.
- **Drafts.**
  - Editing a recipe creates or updates a **draft**: a JSON working copy owned by the recipe, not by a user.
  - Only one draft exists per recipe at a time.
  - Discarding the draft leaves the published version unchanged.
- **Publishing:**
  - copies the draft into the live tables
  - saves an immutable **revision**: a full JSON snapshot of the recipe, plus the author, timestamp and an optional message
  - queues a search-index update (§4)
- **History.** Shows every revision, newest first, with author, timestamp and message.
- **Compare** any two revisions:
  - a field-level diff (metadata, ingredients and steps added, removed or changed)
  - a text diff for markdown fields
  - computed when viewed, never stored
- **Restore** publishes an older revision's snapshot as a **new** revision, with the automatic message "Restored from revision #n". History is never rewritten or deleted.
  - An existing draft is kept.
  - That draft is now based on an out-of-date version, so publishing it later hits the normal concurrency check below.
- **Optimistic concurrency:**
  - each recipe has a `version` that increases with every write to its draft or published state
  - responses include an `ETag`; writes must send `If-Match`
  - a write without `If-Match` gets `428 Precondition Required`
  - if the version is out of date, the API returns `412 Precondition Failed` with the current version, so the client can show what changed ([ADR 0007](./adr/0007-revision-snapshots-and-optimistic-concurrency.md))
  - this matters because editors can edit each other's recipes

### 3.4 Search and discovery

Search is served by Meilisearch through the API (§4).

**Text search**
- Typo-tolerant search across title, description, ingredient names, step text and tag names.
- Search can be limited to ingredient names only.

**Ingredient search**
- **Autocomplete:** Meilisearch facet search over the `normalized_name` values that recipes actually use.
- **Several ingredients:** picking more than one requires **all** of them (AND).
- **Synonyms:** configured in code to treat variants as equal (e.g. scallion ↔ green onion).
- **Known limitation:** without a catalog, "garlic" and "garlic clove" are different values. Accepted trade-off.

**Filters**

| Filter | Behavior |
|---|---|
| Cuisine, meal type, diet, custom tags | Include or exclude |
| Allergens | Exclude only ("contains none of") |
| Difficulty | One or more of easy, medium, hard |
| Total time | Numeric range in minutes |

**Sorting**

| Sort | Basis |
|---|---|
| Relevance | Default when there's a search query |
| Rating | Bayesian average, recomputed when a rating changes |
| Recently added | Date first published |
| Total time | Ascending or descending |

**Results**
- The full search state (query, filters, sort, page) lives in the URL, so searches can be bookmarked and shared.
- Results are paginated and show a count for each filter value.
- Results include only recipes the caller may see (§2). Drafts are never searchable.

### 3.5 Shopping lists (editors and admins)

- **Lists are personal.** Each user can keep several named lists. No live syncing.
- **Adding recipes:** pick recipes, each with its own serving count. Scalable quantities are scaled before they're added.
- **Manual items:** free-text lines that aren't tied to a recipe.
- **Using a list:** check items off and uncheck them; clear checked items; delete the list.
- **Aggregation rules:**
  1. Group lines by `normalized_name`.
  2. Within a group, convert and add quantities only when units share a dimension (volume, mass, count).
  3. If units can't be converted, keep separate lines under the same name, e.g. "garlic: 2 cloves; 1 tbsp".
  4. Lines without a quantity ("salt to taste") collapse into one unquantified line.
  5. Each line records the recipes that contributed to it, and the UI shows them.
- **Implementation:** the conversion and aggregation logic is a pure module in `packages/shared`, covered by unit tests and property-based tests:
  - scaling up then back down returns the original
  - the order recipes are added in doesn't change the result

### 3.6 Cook mode

- **Layout:**
  - a large-type, distraction-free view
  - a servings selector
  - scaled ingredients
  - **all steps on one page**
- **Screen stays awake** while cook mode is open, using the Screen Wake Lock API, and releases when cook mode closes.
  - The API only works in a secure context: HTTPS or `localhost`. Caddy serves HTTPS so this works on phones over the LAN.
  - If wake lock isn't available, the UI says so plainly; nothing else is affected.
- **Out of scope:** timers, voice control, saved progress, a one-step-at-a-time view (§7).

### 3.7 Import and export

**URL import (best effort)**
- The user pastes a recipe page URL.
- The server fetches it and pulls out schema.org/Recipe JSON-LD data.
- A successful import opens a **new draft** for the user to review before publishing. Ingredient lines go through the normal parser.
- If no structured data is found, the user sees a clear message. There is no fallback scraping.
- **SSRF guard:**
  - only `http` and `https` URLs
  - private, loopback and link-local addresses are blocked
  - the resolved address is re-checked on every redirect
  - a limit on redirects
  - limits on response size and timeout

**Downloads**
- **Print view:** a print stylesheet; the browser handles PDF.
- **Per-recipe export:** JSON (the native format) or schema.org/Recipe JSON-LD.
- **Full-instance export (admins):** all recipes, revisions, tags and images as one archive.

## 4. Search architecture

- **SQLite is authoritative.** Meilisearch is a derived read model. It is never backed up and can always be rebuilt from SQLite.
- **Sync through a transactional outbox.**
  - Every write that changes a recipe's search document inserts a `job` row in the same SQLite transaction. That includes publishing, rating changes, tag renames and merges, visibility changes, deleting, restoring and purging.
  - An in-process worker reads pending jobs and sends the full document to Meilisearch as an upsert or delete.
  - Jobs are idempotent, retried with backoff, and dead-lettered after a maximum number of attempts.
  - Recipe writes succeed even while Meilisearch is down.
- **Index document.** One document per recipe, built from the **published** version only:
  - `id`, `title`, `description`, `stepText`
  - `ingredientNames`, `normalizedIngredientNames`
  - `cuisine`, `mealType`, `diet`, `allergens`, `customTags`
  - `difficulty`, `totalMinutes`
  - `visibility`, `ownerId`
  - `ratingScore`, `publishedAt`
  - `deleted`
- **Index settings live in code** and are applied on startup: searchable, filterable and sortable attributes, ranking rules, synonyms.
- **Access control:**
  - The browser never talks to Meilisearch directly.
  - The API adds `deleted = false AND (visibility = "shared" OR ownerId = <caller>)` to every query.
  - The API uses a scoped key limited to the actions it needs. The master key is used only to create that key.
- **Reindexing:**
  - an admin action and a CLI command build a fresh index and swap it in atomically
  - on startup, the API reindexes if the index is missing or empty
- **Degraded mode.**
  - `/readyz` reports Meilisearch health.
  - If Meilisearch is unavailable, search endpoints return `503` with `application/problem+json`. The rest of the app keeps working.

## 5. Data model

The schema is defined in Drizzle and is authoritative. This section is a sketch.

| Table | Key columns |
|---|---|
| `user`, `session`, `account`, `verification` | Managed by Better Auth. `user` gains `role` and ban/deactivation fields from the admin plugin. |
| `invitation` | `email`, `role`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`, `revoked_at` |
| `recipe` | `owner_id`, `visibility`, `public_token`, `version`, `published_revision_id`, `draft_json`, `title`, `description_md`, `yield_qty`, `yield_unit`, `servings`, `prep_min`, `cook_min`, `total_min`, `difficulty`, nutrition columns, `source_url`, `source_title`, `source_author`, `equipment` (JSON), `cover_image_id`, `deleted_at` |
| `recipe_ingredient` | `recipe_id`, `group_label`, `group_position`, `position`, `raw_text`, `qty`, `unit`, `name`, `normalized_name`, `note`, `scalable` |
| `recipe_step` | `recipe_id`, `position`, `body_md`, `image_id` |
| `recipe_revision` | `recipe_id`, `snapshot_json`, `author_id`, `message`, `created_at` |
| `tag`, `recipe_tag` | `tag.type`, `tag.name` (unique per type) |
| `image` | `recipe_id`, `blob_key`, `mime`, `width`, `height`, `variants` (JSON) |
| `favorite`, `rating`, `comment`, `user_note` | Per user, per recipe |
| `collection`, `collection_item` | Per user; items are ordered |
| `user_preference` | `unit_system`, theme |
| `shopping_list`, `shopping_list_item` | `normalized_name`, `qty`, `unit`, `display_text`, `checked`, `is_manual`, `sources` (JSON) |
| `audit_event` | `actor_id`, `action`, `target_type`, `target_id`, `metadata` (JSON), `ip`, `user_agent`, `created_at` |
| `job` | `type`, `payload` (JSON), `status`, `attempts`, `run_after`, `last_error` |

## 6. Non-functional requirements

**Architecture summary**

| Concern | Choice |
|---|---|
| Repo layout | pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` |
| Frontend | Vue 3, TypeScript, Vite, Vue Router, Pinia, TanStack Query, VueUse; shadcn-vue + Tailwind; VeeValidate + Zod |
| Backend | Node LTS, TypeScript, Hono |
| API | REST under `/api/v1`; OpenAPI 3.1 generated from Zod; RFC 9457 errors; Scalar docs at `/api/docs`; typed client generated for the frontend. Better Auth's routes live under `/api/auth`, in Better Auth's own format, and the frontend calls them through Better Auth's client |
| Database | SQLite (better-sqlite3, WAL, `busy_timeout`) with Drizzle and drizzle-kit migrations, run when the container starts |
| Search | Meilisearch Community Edition |
| Blob storage | `BlobStore` interface: local volume by default, optional S3 adapter tested against Garage |
| Auth | Better Auth (email + password, `admin` plugin) plus a custom invitations module |
| Email | Nodemailer to any SMTP server; Mailpit in development |
| Markdown | Milkdown (Crepe) editor; markdown-it + DOMPurify for rendering |
| Background jobs | SQLite `job` table + in-process worker; croner for schedules |
| Reverse proxy | Caddy: serves the SPA, proxies the API, provides HTTPS |
| Observability | pino structured logs with request IDs; `/healthz` and `/readyz` |
| Testing | Vitest, @testing-library/vue, MSW, fast-check, Testcontainers, Playwright + axe |
| Code quality | Biome (formatting), ESLint (linting), vue-tsc; lefthook |
| CI | GitHub Actions; images published to GHCR; Renovate |

**Security**
- Content Security Policy and the other standard security headers.
- Session cookies are `HttpOnly`, `Secure` and `SameSite`; Better Auth checks the request origin.
- All input is validated with Zod at the API boundary.
- All user markdown is sanitized when rendered.
- Upload validation (§3.2) and the SSRF guard (§3.7).
- Rate limiting (§3.1).
- `pnpm audit` runs in CI.

**Accessibility and usability**
- WCAG 2.2 AA.
- Full keyboard navigation.
- Mobile-first layouts, especially cook mode and shopping lists.
- Dark mode.

**Operations**
- **Configuration** comes from environment variables, validated with Zod at startup and documented in `.env.example`. An invalid config stops startup with a clear error.
- **Compose services:**
  - `caddy`
  - `api` (the job worker runs inside it)
  - `meilisearch`
  - the `dev` profile adds `mailpit`
  - the `s3` profile adds `garage` and an init container that sets it up
- **Images:** multi-stage builds, non-root user, healthchecks, pinned versions.
- **Backups:** a scheduled `VACUUM INTO` snapshot of SQLite plus an archive of the uploads volume, with a documented restore procedure. Meilisearch isn't backed up (§4).
- **Demo data:** a seed script creates about 20 recipes and one account per role.

## 7. Out of scope

These were considered and deliberately excluded:

- multi-tenancy or households
- canonical ingredient catalog, pantry tracking, "what can I make?"
- meal planning
- forking or copying recipes
- passkeys, two-factor authentication, OIDC/social login
- PWA or offline support
- cook-mode timers, voice control, saved progress, one-step-at-a-time view
- automatic nutrition lookup
- volume ↔ weight conversion
- live-synced or shared shopping lists
- fallback HTML scraping for URL import

## 8. Delivery phases

Each phase is delivered as small, atomic increments, each reviewed on its own (see `CLAUDE.md`).

| Phase | Scope |
|---|---|
| **0. Foundation** | Monorepo; Compose (Caddy, API, Meilisearch, Mailpit); Hono + OpenAPI + Scalar; Drizzle + SQLite; Better Auth with roles, first-run setup and invitations; job/outbox worker; audit log; CI; seed script |
| **1. MVP** | Recipe create/edit/delete with ingredient groups, structured steps and ingredient parsing; tags, allergens, diet, nutrition; images; scaling and units; visibility; Meilisearch indexing, search, filters and sorting; favorites; cook mode; print view |
| **2. Collaboration** | Drafts, revisions, compare and restore; optimistic concurrency; comments; ratings; collections; personal notes; public links; trash |
| **3. Shopping lists** | Aggregation, normalization and dedup; manual items; multiple lists; check-off |
| **4. Best effort and polish** | URL import; JSON and JSON-LD export; full-instance export; backup and restore tooling; finished documentation |

## Open questions

These need decisions before or during the phase that uses them:

1. **Trash retention period** before permanent purge (Phase 2). Suggestion: 30 days, configurable.
2. **Bayesian rating parameters** (Phase 2). Suggestion: prior = the instance-wide mean rating, weight = 3 ratings.
3. **Image limits** (Phase 1). Suggestion: 10 MB max upload, variants at 400 px and 1200 px wide, served as WebP.
4. **Revision retention** (Phase 2). Suggestion: keep all revisions; snapshots are small.
5. **Failed-login audit events** may be noisy (Phase 0). Possibly sample them or keep them for a limited time.
