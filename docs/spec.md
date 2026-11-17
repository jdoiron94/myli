# myli: Product Specification

| | |
|---|---|
| Status | Draft |
| Last updated | 2026-11-17 |
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
- Only a recipe's owner can change its visibility.

| Action | Admin | Editor | Viewer |
|---|---|---|---|
| View shared recipes, search, cook mode, print/download | ✓ | ✓ | ✓ |
| Create recipes (private or shared) | ✓ | ✓ | – |
| Edit or publish shared recipes (any author) | ✓ | ✓ | – |
| View private recipes | own | own | own¹ |
| Edit private recipes | own | own | – |
| Change a recipe's visibility | own | own | – |
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
- Pages a role can't use, like the admin pages, aren't linked for it. Opening one anyway says the user doesn't have access, at the same address.
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
- Alternatively, `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` seed the first admin on startup, before the API accepts requests:
  - all three or none; a partial set, an invalid email or a password that breaks the rules stops the API from starting
  - if users already exist, the variables are ignored with a warning, and no existing user is changed
  - the password is never logged
- Once any user exists, setup is permanently unavailable.
- Two setups at the same moment create exactly one admin (ADR 0009). After setup, the new admin signs in with the same email and password.

**Invitations (sign-up is invite-only)**
- Public sign-up is disabled. An admin invites people by email and assigns a role up front.
- **One open invitation per email.** An invitation is open until it's accepted or revoked; an expired one still counts, so the admin resends or revokes it. Inviting an email that already belongs to a user is refused.
- **Managing invitations:** admins see every open invitation, marked pending or expired.
  - Resending issues a new link that works for the full lifetime again and stops the old one. It works on expired invitations too.
  - Revoking stops the link and keeps the record, and the email can be invited again. The admin confirms it first.
  - Neither works on an invitation that's accepted, revoked, or being accepted at that moment.
- **Tokens:**
  - 32 random bytes; only the SHA-256 hash is stored, so a link can't be shown again later
  - never stored in the `job` table either: the email job carries only the invitation's ID and creates a fresh token when it runs
  - expire after 7 days by default (`INVITATION_TTL_DAYS`, 1 to 90)
  - single-use and revocable
  - resending invalidates the previous token and issues a new one
- **Links** look like `PUBLIC_URL/accept-invitation#<token>`. The token is in the fragment, which browsers never send to a server, so it stays out of access logs and Referer headers. The accept page sends it in a request body.
- **Accepting:** the invitee follows the link. The accept page takes the token out of the address as soon as it has read it, checks it, and shows the invited email, role and expiry. The invitee chooses a name and a password, and the user is created through Better Auth's server API with the invited email and role, already verified. Accepting doesn't sign them in: they sign in next with the same email and password.
  - The email can't be changed on the accept page: the account gets the address the invitation was sent to.
  - Someone already signed in is asked to sign out and open the link again, rather than creating a second account while signed in.
- Unknown, expired, revoked and used links all get the same answer, so they can't be told apart.
- **With SMTP:** creating or resending an invitation emails the link, and the admin never sees it.
  - The email job stores the hash of a fresh token first and only then sends, so an emailed link always works when it arrives.
  - If a send fails, the retry does the same with another token. When an invitation gets more than one email, only the newest link works.
  - Nothing is sent for an invitation that was accepted, revoked or expired before its job ran.
  - The email is plain text: who invited them, the role, the link, and when it expires (in UTC).
- **Without SMTP:** if SMTP isn't configured, creating or resending an invitation shows the admin its link once, with a copy button, to share however they like. It can't be shown again later, since only its hash is stored: to get a link for an existing invitation, the admin resends it, which stops the old one.
- Accepting creates exactly one user; replaying a used token fails.

**Account basics**
- email + password login
- **Passwords:** 15 to 128 characters, with at least one lowercase letter, one uppercase letter, one number and one special character. A special character is anything but a letter or a number, and a space counts. Letters and numbers from any script count. The same rules apply everywhere a password is set: setup, invitations, changing it and resetting it.
- email verification
- password reset
- rate limiting: Better Auth's built-in limiter on auth routes, and a general limiter on the rest of the API
- **When a session ends** (it expires, the user is deactivated, or they sign out on another device), the web app finds out from its next request. It goes to the sign-in page, which says they've been signed out and fills in their email, and back to the same page once they've signed in. Nothing the app had loaded stays behind.

**User lifecycle**
- Admins change roles and deactivate users. Users are never hard-deleted, so revision and comment authorship stays intact.
- **The Users page** lists everyone with an account, oldest first, with their email, role, whether they're active, and when they joined.
  - Changing a role opens a dialog with the current role chosen. Saving the role they already have changes nothing.
  - Deactivating asks the admin to confirm first, and says what it does. Reactivating doesn't ask.
  - The admin's own row is marked and has no controls (see lockout protection below).
- A role change applies from the user's next request.
  - The web app fetches the session once, so a page already open learns of a lower role when the API refuses a request. It then fetches the session again and checks the current page: a page the new role doesn't allow shows the no-access page instead, and links to such pages go.
  - A user given a higher role sees the links it adds after reloading the page.
- An editor demoted to viewer keeps read-only access to their own private recipes (§2).
- Deactivating a user ends all of their sessions immediately and refuses their sign-ins until an admin reactivates them.
- **Deactivation leaves the user's recipes exactly as they are.** Private recipes stay private, visible to no one, and are the user's again if they're reactivated. Shared recipes stay shared. An admin can never use deactivation to reach someone's private recipes. A member who wants others to keep their recipes makes them shared before they leave.
- **Lockout protection:** admins can't change their own role or deactivate themselves; another admin has to. Each change also checks, as it's made, that the admin making it is still an active admin, so a change from an admin who was demoted or deactivated a moment earlier is refused. Together, these keep at least one active admin, even when two admins change each other at the same moment.
- Setting a role a user already has, deactivating a deactivated user, or reactivating an active one changes nothing and records nothing.

**Recipe visibility**

| Level | Who can see it |
|---|---|
| `private` | The owner only |
| `shared` | Every signed-in user |
| Public link | Anyone with the link. It's an add-on to a shared recipe, not a separate level. |

- A public link is read-only and uses an unguessable token.
- The owner or an admin can revoke it at any time.
- Only the owner can change a recipe's visibility. Making someone else's shared recipe private would hide it from everyone but its owner.
- A recipe's visibility is chosen when it's created and changed on its own afterwards: saving the recipe's content never changes it, so editors can edit any shared recipe without being able to hide it.
- A new recipe starts private in the editor, so nothing is shared by accident: sharing is a choice.
- Making a recipe private revokes its public link.

**Audit log**
- Append-only, enforced by the database: triggers refuse every change to a recorded event. Viewable by admins only, newest first, a page at a time, optionally filtered by action.
- Records:
  - first-run setup creating the first admin, through the setup screen or from the environment
  - invitation created, resent, revoked, accepted
  - role changed
  - user deactivated or reactivated
  - successful and failed logins, and sign-outs
  - recipe deleted, restored or purged
  - revision restored
  - public link created or revoked
  - full-instance export
- Each event stores actor, action, target, timestamp, IP address and user agent.
- **Recipe events** name the recipe by its title only while it's shared. Admins may not see private recipes (§2), so a private recipe's title never enters the log.
- **Sign-ins:**
  - Only email-and-password sign-ins whose credentials were checked are recorded. Requests refused for coming from another origin, being malformed or being rate limited are not.
  - A failed sign-in has no actor. It keeps the email that was tried and the reason (wrong email or password, or a deactivated account), and targets the account when that email has one.
  - A sign-out is recorded only when it ended a session.
  - Every failed sign-in is recorded and kept (open question 5). Rate limiting bounds how fast they accumulate. Pruning old ones can come with the scheduled purge job in Phase 2.
- An event and the change it records are saved together, in one transaction. Setup, sign-ins, sign-outs and accepted invitations are the exception, because Better Auth makes those changes itself: their events are written right after, and if that write fails, the error is logged and the request still succeeds.
- **IP address:** the address the connection came from. Behind a reverse proxy such as Caddy, it's read from `X-Forwarded-For`, trusted only from the proxies listed in `TRUSTED_PROXIES`. Sessions and sign-in rate limiting use the same address.
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
- **The parser** reads:
  - quantities written as whole numbers, decimals, fractions ("3/4", "¾"), mixed numbers ("1 1/2", "1-1/2", "1½"), number words up to twelve, and "a" or "an" meaning one
  - ranges ("2-3", "2–3", "2 to 3", "1 or 2"), stored as `qty` and a top end; one written backwards is turned around
  - a unit from the unit table, also when written straight after the number ("200g"); without a quantity, only before "of" ("pinch of salt")
  - a note from anything in parentheses ("1 (14 oz) can") and anything after the first comma, plus phrases like "to taste", "for garnish" and "optional" at the end
  - not scalable: lines with "to taste" or "as needed", and amounts that depend on the pan rather than the servings ("for frying", "for greasing", "for dusting")
  - whatever it can't read ("a few sprigs of thyme", "juice of 1 lemon") stays in the name for the user to correct
- **The normalized name** also drops accents, apostrophes and other punctuation ("Jalapeños" and "jalapeno" are both "jalapeno"; "all-purpose" is "all purpose"). Only its last word is made singular: "cherry tomatoes" is "cherry tomato".
- There is no canonical ingredient catalog. Ingredient identity is the normalized name (see the limitation in §3.4).
- **In the editor,** each line is typed as it would be written, with how myli reads it shown under it as it's typed. Enter starts the next line, a pasted list becomes a line each, and blank lines are left out. A group with a name needs at least one line.
- **Correcting a line:** its amount, the top of its range, its unit, name and note, and whether it changes with servings can each be corrected, starting from what was read. Amounts are typed as lines are ("1½", "1 1/2"). A corrected line keeps its corrections when its text changes, until its author asks for it to be read again.

**Structured steps**
- Steps are ordered records. Each has a markdown body and an optional image.
- Steps can be reordered, inserted and removed.
- **In the editor,** each step is a markdown field (see Markdown below), numbered as the recipe shows it. A new recipe starts with one to write in. A step can be added at the end or after any step, and moved up or down. Blank steps are left out when the recipe is saved.

**Markdown**
- Descriptions and steps (and later comments and notes) are markdown, in a deliberately small subset (ADR 0006): bold, italic, lists, links and inline code. A line break is kept as typed.
- Anything else, like a heading, a quote, a table, an image or raw HTML, is shown as the text that was typed, never run. Images come only from uploads (§3.2 Images).
- Links go only to web or email addresses, or to pages on the instance. They're marked as user-written (`rel="ugc nofollow noopener noreferrer"`), so the sites they lead to aren't told which recipe sent the reader.
- **In the editor** (ADR 0014), formatting comes from a toolbar (bold, italic, code, link, bulleted and numbered lists) or its shortcuts (Ctrl/⌘ with B, I, E or K; with Alt and 8 or 7 for the lists), or from typing it as markdown (`**bold**`, `- ` to start a list). Nothing outside the subset can be made: typed or pasted in, it stays text. Shift+Enter breaks a line, Tab moves on to the next field, and Ctrl/⌘ with ] or [ indents a list item or brings it back.
  - A link's address can be typed as people would ("example.com/bread", "sam@example.com"). Anything that isn't a web or email address, or a path on the instance, is refused.
  - Each markdown field shows the markdown as the recipe will until it's focused; then the editor takes its place. One field is edited at a time.
  - Markdown outside the subset, saved before or written through the API, opens just as the recipe shows it (ADR 0015).

**Scaling**
- Choosing a different serving count scales every scalable quantity by `new / baseline`. A recipe always opens at its own servings: the count chosen isn't saved.
- **Display rules:**
  - show common fractions (⅛, ¼, ⅓, ½, ⅔, ¾) instead of decimals
  - round to sensible precision for the unit
  - convert up to larger units within the same system (48 tsp → 1 cup), choosing the largest unit where the amount comes out as one of those fractions
- At the recipe's own servings, in the reader's own system, every line is shown in the unit it was written in: "8 tbsp" stays "8 tbsp".
- A quantity can be a range ("2–3 cloves"). Both ends scale, and are shown in a unit the smaller end reaches.
- Lines that aren't scalable never change.
- Each user picks metric or imperial as a display preference, imperial until they choose. It's saved to their account, so it follows them from device to device, and viewers have one too: it changes only what they see. Imperial means the US customary measures American recipes use: a cup is 236.6 ml. Conversion stays within one dimension (volume, mass, count). Volume is never converted to weight or back.
- Named units, like a clove or a can, scale but never convert.
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

- A tag's name is unique within its type, ignoring case and extra spaces: creating "italian" when "Italian" exists gives back the existing tag rather than a second one. The same name can exist in two types. Names are 1–50 characters.
- Allergen and diet tags are set by hand. The UI shows a disclaimer that this information is entered by users and not verified.
- **In the editor,** every tag of each type shows as a checkbox, so picking one is a click and what exists is in view. Under each type but the allergens, editors can add a new tag, which is checked straight away; a name the type already has checks that tag instead.

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
  - The API only works in a secure context: HTTPS or `localhost`. Caddy serves HTTPS so this works on phones over the LAN, with certificates from its own local CA, which each device trusts once (ADR 0013).
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
  - The API starts without Meilisearch and keeps trying to set it up in the background: its key, the index and the index settings. If Meilisearch loses its data, the API sets them up again.
  - `/readyz` reports whether SQLite and Meilisearch are available: `200`, or `503` with `application/problem+json` naming what isn't. `/healthz` only reports that the process is up.
  - If Meilisearch is unavailable, search endpoints return `503` with `application/problem+json`. The rest of the app keeps working.

## 5. Data model

The schema is defined in Drizzle and is authoritative. This section is a sketch.

| Table | Key columns |
|---|---|
| `user`, `session`, `account`, `verification` | Managed by Better Auth. `user` gains `role` and ban/deactivation fields from the admin plugin. |
| `invitation` | `email`, `role`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`, `revoked_at` |
| `recipe` | `owner_id`, `visibility`, `public_token`, `version`, `published_revision_id`, `draft_json`, `title`, `description_md`, `yield_qty`, `yield_unit`, `servings`, `prep_min`, `cook_min`, `total_min`, `difficulty`, nutrition columns, `source_url`, `source_title`, `source_author`, `equipment` (JSON), `cover_image_id`, `deleted_at` |
| `recipe_ingredient` | `recipe_id`, `group_label`, `group_position`, `position`, `raw_text`, `qty`, `qty_max` (the top of a range), `unit`, `name`, `normalized_name`, `note`, `scalable` |
| `recipe_step` | `recipe_id`, `position`, `body_md`, `image_id` |
| `recipe_revision` | `recipe_id`, `snapshot_json`, `author_id`, `message`, `created_at` |
| `tag`, `recipe_tag` | `tag.type`, `tag.name`, `tag.name_key` (the name without case or extra spaces; unique per type). The allergen tags are seeded by a migration. |
| `image` | `recipe_id`, `blob_key`, `mime`, `width`, `height`, `variants` (JSON) |
| `favorite`, `rating`, `comment`, `user_note` | Per user, per recipe |
| `collection`, `collection_item` | Per user; items are ordered |
| `user_preference` | `user_id`, `unit_system`. No row means the defaults. The theme isn't here: it's chosen per browser (§6). |
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
| Markdown | Milkdown's kit, held to the subset (ADR 0014), for editing; markdown-it + DOMPurify for rendering |
| Background jobs | SQLite `job` table + in-process worker; croner for schedules |
| Reverse proxy | Caddy: serves the SPA, proxies the API, provides HTTPS |
| Observability | pino structured logs with request IDs; `/healthz` and `/readyz` |
| Testing | Vitest, @testing-library/vue, MSW, fast-check, Testcontainers, Playwright + axe |
| Code quality | Biome (formatting), ESLint (linting), vue-tsc; lefthook |
| CI | GitHub Actions; images published to GHCR; Renovate |

**Security**
- Content Security Policy and the other standard security headers, sent by Caddy. The app's pages allow no inline scripts or styles and no eval (ADR 0012).
- HTTPS only: HTTP redirects to it, and HSTS tells browsers to come back over HTTPS (ADR 0013).
- Session cookies are `HttpOnly`, `Secure` and `SameSite`; Better Auth checks the request origin.
- Every API request that changes data must be sent as JSON, even without a body, so no other origin can make one with a user's cookie.
- All input is validated with Zod at the API boundary.
- All user markdown is sanitized when rendered.
- Upload validation (§3.2) and the SSRF guard (§3.7).
- Rate limiting (§3.1).
- `pnpm audit` runs in CI, which lists any advisories in the run's summary. They never fail the build.

**Accessibility and usability**
- WCAG 2.2 AA.
- Full keyboard navigation. A skip link leads to the main content, and after moving to another page, focus moves to its heading.
- Mobile-first layouts, especially cook mode and shopping lists.
- Dark mode. It follows the device's setting by default. Anyone can choose light or dark instead, and the choice is remembered in that browser.

**Operations**
- **Configuration** comes from environment variables, validated with Zod at startup and documented in `.env.example`. An invalid config stops startup with a clear error.
  - Each secret can be read from a file instead, such as a Docker secret, by setting `NAME_FILE` to its path: `BETTER_AUTH_SECRET`, `MEILI_MASTER_KEY`, `ADMIN_PASSWORD` and `SMTP_PASSWORD`.
- **Compose services:**
  - `caddy`, the only service that publishes ports (80 and 443)
  - `api` (the job worker runs inside it)
  - `meilisearch`, which Caddy can't reach
  - the `dev` profile adds `mailpit`
  - the `s3` profile adds `garage` and an init container that sets it up
- **In Compose,** secrets reach the containers as files, never in their environment, and the API trusts `X-Forwarded-For` only from Caddy's network. No service has Linux capabilities.
- **Images:** multi-stage builds, non-root user, healthchecks, pinned versions.
- **Releases:** versions follow the conventional commits (release-please). Each release tags the commit, creates a GitHub release with its changelog, and publishes both images to GHCR, privately, for linux/amd64, tagged with the version and `latest`.
- **Backups:** a scheduled `VACUUM INTO` snapshot of SQLite plus an archive of the uploads volume, with a documented restore procedure. Meilisearch isn't backed up (§4).
- **Demo data:** a seed script, for a new instance only, creates one account per role, with random passwords it prints once, and about 20 recipes.

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
| **4. Best effort and polish** | URL import; JSON and JSON-LD export; full-instance export; backup and restore tooling; the S3 blob storage adapter, tested against Garage; finished documentation |

Until Phase 2, saving a recipe changes its published version directly, and deleting one sets `deleted_at`, which hides it everywhere. Drafts, the trash page, restoring and purging come with Phase 2.

## Open questions

These need decisions before or during the phase that uses them:

1. **Trash retention period** before permanent purge (Phase 2). Suggestion: 30 days, configurable.
2. **Bayesian rating parameters** (Phase 2). Suggestion: prior = the instance-wide mean rating, weight = 3 ratings.
3. ~~**Image limits** (Phase 1).~~ Decided: uploads up to 10 MB. Variants are served as WebP, at sizes chosen from the layouts images appear in, so they look good where they're shown.
4. **Revision retention** (Phase 2). Suggestion: keep all revisions; snapshots are small.
5. ~~**Failed-login audit events** may be noisy (Phase 0).~~ Decided in Phase 0: record every one and keep them. Revisit pruning when the Phase 2 purge job exists.
