# myli: Product Specification

| | |
|---|---|
| Status | Draft |
| Last updated | 2026-11-17 |
| Decisions | [`docs/adr/`](./adr/) |

## 1. Overview

myli is a self-hosted recipe manager for one household, run with Docker Compose. It stores structured recipes with revision history and finds them through fast faceted search. It scales recipes to any serving size, adds up a collection's recipes into one grocery list, and has a cook mode for use in the kitchen.

**Principles**

- **Self-hosted and free.** Every dependency is free, self-hostable, and runs in the Compose stack.
- **One instance, one household.** There is no multi-tenancy. All users belong to the same instance and have instance-wide roles.
- **SQLite is the source of truth.** Everything else, including the search index, is derived and can be rebuilt.
- **Structured data over free text.** Ingredients and steps are records, not one markdown blob, so scaling, search and grocery lists work.

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
| Upload photos | ✓ | ✓ | – |
| Edit or publish shared recipes (any author) | ✓ | ✓ | – |
| View private recipes | own | own | own¹ |
| Edit private recipes | own | own | – |
| Change a recipe's visibility | own | own | – |
| Delete or restore from trash | any | own | – |
| Restore a revision | ✓ | ✓ (recipes they can edit) | – |
| Create or revoke public links | any | own | – |
| Comment, rate | ✓ | ✓ | – |
| Favorites, collections and their grocery lists, personal notes | ✓ | ✓ | – |
| Create custom tags | ✓ | ✓ | – |
| Rename, merge or delete tags | ✓ | – | – |
| Delete others' comments | ✓ | – | – |
| Invite users, change roles, deactivate users | ✓ | – | – |
| View audit log; full-instance export | ✓ | – | – |
| Rebuild the search index | ✓ | – | – |

¹ Viewers can't create recipes. This covers the private recipes of an editor who was demoted to viewer: they can still read them, but no longer change them.

**Enforcement**

- The matrix is implemented once, as a policy module in `packages/shared`. The UI uses it to hide controls; the API uses it to enforce. Neither has inline role checks.
- Pages a role can't use, like the admin pages, aren't linked for it. Opening one anyway says the user doesn't have access, at the same address.
- The header links to search for everyone, to their favorites for those who keep them, and to a new recipe for those who can write one. It gathers the admin pages in one Admin menu, which shows only for a role that can open one of them.
- **Private recipes are visible only to their owner,** admins included, on every read path: direct ID, search, favorites, ratings, comments, revisions, public links and their photos.
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

- A public link is read-only and uses an unguessable token: `PUBLIC_URL/p/<token>`. Anyone with it can see the recipe as it's published, photos included, without signing in. It doesn't show who wrote the recipe, its ratings, comments, notes or history, nor any photo only an older revision or a draft uses.
- A shared recipe has one public link at most. Its owner or an admin creates it, copies it again whenever they like, and can revoke it at any time. A link created after one was revoked is a new one: the old one never works again. Creating or revoking it doesn't change the recipe, so it doesn't move its version.
- A recipe in the trash hides its public link, which works again if the recipe is restored.
- The token is kept out of logs and away from other sites ([ADR 0016](adr/0016-public-link-token-in-the-path.md)), and the audit log never records it.
- Only the owner can change a recipe's visibility. Making someone else's shared recipe private would hide it from everyone but its owner.
- A recipe's visibility is chosen when it's created and changed on its own afterwards: saving the recipe's content never changes it, so editors can edit any shared recipe without being able to hide it.
- A new recipe starts private in the editor, so nothing is shared by accident: sharing is a choice.
- The owner shares a recipe, or makes it private again, from its page, after a confirmation that says who will see it.
- Making a recipe private revokes its public link. Its confirmation says so when it has one.
- Whoever may share a recipe has a Public link button on its page, which creates the link, copies it, and revokes it after a confirmation.
- The link's page shows the recipe as its page does, without its actions, ratings or comments: its photos, ingredients scaled to any servings, steps and nutrition. Someone not signed in chooses metric or imperial there, for as long as the page is open.

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
  - comment deleted, by its author or an admin
  - public link created or revoked
  - tag renamed, merged or deleted
  - full-instance export
- Each event stores actor, action, target, timestamp, IP address and user agent.
- **Recipe events** name the recipe by its title only while it's shared. Admins may not see private recipes (§2), so a private recipe's title never enters the log.
- **Comment events** target the comment's recipe, named as recipe events name it, and keep the comment's author, never what it said: a deleted comment is gone for good.
- **Tag events** keep the tag's type and name (and a rename's new name, a merge's other tag), and how many recipes had it, counting only those the admin may see.
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
| Source | URL, book title, and/or author, all optional. The page says "From" the title (or the URL's site) "by" the author, or "Recipe by" the author when that's all there is. |
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
  - `normalized_name`: lowercase, singular, note removed. Used for search and to add up grocery lists.
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
- Allergen and diet tags are set by hand.
- **On a recipe's page,** its tags show in one row. What it contains comes first, in one tag that stands out ("Contains milk, wheat"), then cuisine, meal type, diet and custom tags.
- **Admins manage tags** on the Tags page, in the Admin menu. It lists every tag by type, with how many recipes have each, counting only recipes the admin may see. The allergens are listed but can't be changed.
  - **Rename,** in a dialog: a name another tag of the type already has, ignoring case and spacing, is refused at the field, with a pointer to merging. Changing only a tag's case or spacing is a rename.
  - **Merge** a tag into another of its type, chosen in a dialog: every recipe that had it has the other instead, once, and it's gone. A type's only tag has nothing to merge into.
  - **Delete:** the tag comes off every recipe that had it. The admin confirms it first, told how many recipes they can see have it, and that private ones others keep may too.
  - Each is recorded in the audit log (§3.1), and every recipe with the tag, private ones included, is indexed again.
- **In the editor,** every tag of each type shows as a checkbox, so picking one is a click and what exists is in view. Under each type but the allergens, editors can add a new tag, which is checked straight away; a name the type already has checks that tag instead.
  - If an admin deletes or merges a checked tag while the editor is open, saving is refused at its checkbox. Once the editor fetches the tags again, that tag is unchecked, with a note saying so.

**Images**
- Up to 20 images per recipe, in order, one marked as the cover. Each step can have one image of its own. An image is used once: in the recipe's images or one step's.
- Each image has alt text, up to 300 characters, saying what it shows for people who can't see it. It's optional: one without any is left out by screen readers, for when the recipe's text already says what it shows. It's saved with the recipe, like the order and the cover.
- A recipe is saved with the images it has: its own, or uploads of whoever saves it that no recipe was saved with yet. An upload of someone else's, or another recipe's image, is refused at the field that names it. An image the recipe no longer has stays its own, since its older revisions show it, and a later save can use it again: restoring a revision does. It's deleted with the recipe, when the recipe is purged from the trash. An image only a draft had, once the draft is discarded or saved again without it, is shown by nothing, nor can be again: a daily job deletes such images a day after they were uploaded.
- Editors and admins upload them as the file itself, not in a form.
- **On upload:**
  - check the real file type from the file's first bytes (JPEG, PNG, WebP)
  - enforce a maximum size: 10 MB, and 100 megapixels, counted before decoding
  - turn it upright, and strip its metadata (EXIF, location included)
  - generate resized variants: WebP, 640, 1280 and 2048 pixels wide, never wider than the upload. The upload itself isn't kept.
- Until a recipe is saved with it, only its uploader can see or use an upload. One no recipe was saved with is deleted after a day.
- **In the editor,** on the new and edit pages, photos are uploaded from the device, several at a time, one after another. The first is the cover until another is chosen, and removing the cover makes the first one left the cover. Photos are put in order and removed there, and each has a field for its alt text. A step gets its photo from a button among its own, which moves with the step and is removed there, with its alt text field under it. Files the API would refuse are refused before they're sent, saying why for each, and the recipe isn't saved while a photo is uploading, which would leave it out.
- **In lists and search results,** each recipe's card shows its cover at the top.
- **On a recipe's page,** the cover shows at the top. With other images, they're a slideshow there, one at a time: the cover first, then the others in order, moved through with its previous and next buttons, by swiping, or with the arrow keys, and saying which it shows ("2 of 3"). Each step's image shows in its step, whole. The browser picks the size each needs from where it shows. Each image has its alt text wherever it shows, cards included; the editor's own thumbnails don't, since the field beside each says it.
- Served only through the API, to whoever may see the recipe, never from a public address. Browsers keep each size for good, since what its address serves never changes.
- Stored through the `BlobStore` abstraction (§6).

**Personal organization (editors and admins)**
- **Favorites:** a per-user flag on a recipe, for any recipe its user can see, set with the Favorite button on the recipe's page. The Favorites page, linked from the header, lists them most recently chosen first, from the database, 24 to a page. One they can no longer see, because it was deleted or made private by its owner, is left out and not counted, and shows again if the recipe comes back.
- **Collections:** named, per-user, ordered groups of recipes. Other users never see them, admins included.
  - listed by name; two can have the same name. Renaming or deleting one leaves its recipes as they are
  - any recipe its user can see can go in, once, at the end, with no limit on how many; its user moves each one place earlier or later, and takes them out, one at a time or all at once. All at once takes out those they can no longer see too, so none comes back later
  - one they can no longer see, because it was deleted or made private by its owner, is left out and not counted, keeps its place, and shows again if it comes back
  - the Collections page, linked from the header, lists them with how many recipes each shows, and creates one. A collection's page shows its recipes' cards in order, 24 to a page, each moved earlier or later (onto the next page or the one before, from either end of one) or taken out, asking first. It links to the collection's grocery list (§3.5), takes every recipe out with Remove all, asking first, and renames the collection or deletes it, asking first. On a recipe's page, the Collections menu has a checked item for each collection that holds it, which asks before taking the recipe out, and links to the Collections page to create one
- **Personal notes:** one private markdown note per user per recipe, for any recipe its user can see. No one else ever sees it, admins included. It's kept while the recipe is out of its writer's sight (made private by its owner, or in the trash) and shows again if it comes back. Like ratings and comments, it isn't part of the recipe: no revision, no search, no audit event.
  - written on the recipe's page, under its steps, and saved with Save note; Delete note asks first. Not printed

**Ratings and comments (editors and admins)**
- **Ratings:**
  - one rating per user per recipe, 1–5 stars; users can change or remove theirs
  - everyone who can see a recipe, viewers included, sees its average rating: on its page with how many ratings there are, and on its card alone. Neither is printed
  - on the recipe's page, whoever may rate it presses one of five stars, and can remove their rating
  - sorting uses a Bayesian average (§3.4)
- **Comments:**
  - markdown, sanitized when rendered
  - everyone who can see the recipe reads them, viewers included, oldest first, each with its author and when it was written
  - authors can edit or delete their own, while they may comment; an edited comment says so
  - admins can delete anyone's
  - they're below the recipe on its page, where whoever may comment writes one, and they aren't printed
  - a deleted comment is gone for good, and the audit log records who deleted it (§3.1). Comments aren't part of the recipe: they aren't searched or kept in its revisions

**Trash**
- Deleting a recipe moves it to the trash. It disappears from search and lists immediately.
- It's deleted from its page, after a confirmation that says it can be restored from the trash. The page then goes home, which says it's deleted, and the recipe's address shows it as not found.
- The trash lists the deleted recipes each person may restore, most recently deleted first: their own, and for admins, shared ones too. To everyone else a deleted recipe doesn't exist, even to someone who could read it before; an admin never sees someone else's private one.
- The Trash page is linked from the account menu for whoever may delete recipes. It shows each recipe's owner, when it was deleted and when it goes for good. Restoring needs no confirmation, since it takes nothing away; the page then says it's restored, with a link to it.
- Restoring brings it back as it was: who sees it, its draft, history, photos, favorites, ratings and comments, and when it was last changed. Like deleting, it's recorded in the audit log, with the title only if the recipe is shared.
- A recipe stays in the trash for `TRASH_RETENTION_DAYS` (30 by default), and the trash shows when each is due to go. A scheduled job then deletes it for good, with its revisions, draft, photos, ratings and comments, and records `recipe.purged` in the audit log, by no one. It runs daily at 03:30 server time, and when the API starts, so a recipe may stay up to a day longer, and lowering the retention purges what's now past it straight away.

### 3.3 Drafts, revisions and history

- **Published version.** The live recipe tables always hold the **published** version. That's what search, lists, cook mode and public links show.
- **Drafts.**
  - Editing a recipe creates or updates a **draft**: a JSON working copy owned by the recipe, not by a user.
  - Only one draft exists per recipe at a time. Anyone who may edit the recipe can see it and continue it; it says who saved it last, when, and which revision it started from.
  - Its tags and photos are checked as publishing would check them. The uploads it names become the recipe's, so they aren't discarded after a day, and whoever continues the draft sees them.
  - Saving it never changes the published recipe, its "Updated" date included, and it's never indexed for search.
  - Discarding the draft leaves the published version unchanged.
  - The editor has **Save draft** and **Publish**, with an optional "What changed" message for the revision, and no autosave. It opens on the recipe's draft when there is one, saying who saved it last and when, and, if the recipe was published since the draft started, that publishing the draft replaces what that revision changed. **Discard draft** asks first, then goes back to the recipe, which says it was discarded.
  - The recipe's page tells whoever may edit it that it has a draft, who saved it and when, and offers to continue it.
- **Publishing:**
  - copies the draft into the live tables, and discards the draft
  - saves an immutable **revision**: a full JSON snapshot of the recipe, plus the author, timestamp and an optional message
  - queues a search-index update (§4)
  - Creating a recipe records revision 1, and each publish the next. Changing who sees a recipe or deleting it records none, since neither changes its content.
  - A recipe saved before revisions were kept gets revision 1 when the API starts: the recipe as it was then, by its owner, dated when it last changed, with the message "As it was when myli started keeping revisions."
- **History.** Shows every revision, newest first, with author, timestamp and message, to anyone who may see the recipe.
  - A recipe says which revision it shows: its latest, the published one.
  - Each revision shows the recipe as it was then: its tags with the names they had, its photos with the alt text they had.
  - The recipe's page links to its history, which marks the revision published. Each revision's page says who saved it, when and why, and whether the recipe was published since.
- **Compare** any two revisions:
  - a field-level diff (metadata, ingredients and steps added, removed or changed)
  - a text diff for markdown fields
  - computed when viewed, never stored
  - The history compares any two revisions, the earlier first, and links each to a comparison with the one before it. Text shows as typed, markdown included: what was taken out struck through, what was put in underlined, each said for screen readers, never by color alone. A tag renamed in between counts as the same tag.
- **Restore** publishes an older revision's snapshot as a **new** revision, with the automatic message "Restored from revision #n". History is never rewritten or deleted.
  - Tags deleted since are left out.
  - A revision's page offers it to whoever may edit the recipe, unless it's the one published. It asks first, then goes to the recipe, which says which revision it's published as. Refused because someone changed the recipe meanwhile, it says so and shows the recipe as it is now.
  - It's recorded in the audit log, with the recipe's title only when it's shared, as deleting it is.
  - An existing draft is kept.
  - That draft now started from an older revision than the published one, which it says, so whoever opens it can tell the recipe was published since. An editor that had it open during the restore is refused by the concurrency check below.
- **Optimistic concurrency:**
  - each recipe has a `version` that increases with every write to its draft or published state: saving it, changing its visibility, deleting it. Setting the visibility it already has changes nothing, the version included.
  - responses include an `ETag` (`"3"`); writes must send `If-Match` with the version they're based on. Only that strong `ETag` will do: `*`, a weak one or a list counts as out of date.
  - a write without `If-Match` gets `428 Precondition Required`
  - if the version is out of date, the API returns `412 Precondition Failed` with the recipe as it is now, its version included, so the client can show what changed ([ADR 0007](./adr/0007-revision-snapshots-and-optimistic-concurrency.md))
  - this matters because editors can edit each other's recipes
  - The editor saves against the version it opened, or its own last draft save's, even if the recipe's page has loaded a newer one since. Refused, it keeps what was typed and says what changed: which parts of the published recipe, a draft someone saved or discarded, who can see it. It offers to do what was refused anyway, based on the recipe as it is now (published versions stay in the history; a draft is replaced), or to drop what was typed and load theirs. On the recipe's page, a refused change of visibility or deletion shows the recipe as it is now, and says so.

### 3.4 Search and discovery

Search is served by Meilisearch through the API (§4). Home's list of recipes isn't: it reads the database (Browsing, below).

**Text search**
- Typo-tolerant search across title, description, ingredient names, step text and tag names.
- Search can be limited to ingredient names only.

**Ingredient search**
- **Autocomplete:** the `normalized_name` values that recipes the caller may see actually use, most used first, ten at most. A name is suggested when any of its words starts like what's typed ("flour" suggests "bread flour"). Meilisearch's facet search finds names by their start, typos forgiven; it can't look inside a name, so a search on ingredient names adds those with a later word that matches.
- **Several ingredients:** picking more than one requires **all** of them (AND).
- **Synonyms:** configured in code as groups of names that mean the same, mostly American and British names (scallion ↔ green onion ↔ spring onion, zucchini ↔ courgette). Text search and picking an ingredient both treat each name as the others.
- **Known limitation:** without a catalog, "garlic" and "garlic clove" are different values. Accepted trade-off.

**Filters**

| Filter | Behavior |
|---|---|
| Cuisine, meal type | Include any of, or exclude |
| Diet, custom tags | Include all of, or exclude |
| Allergens | Exclude only ("contains none of") |
| Difficulty | One or more of easy, medium, hard |
| Total time | Numeric range in minutes. Recipes without a total time match no range. |

Different filters all apply. Excluding values leaves out recipes with any of them.

**Sorting**

| Sort | Basis |
|---|---|
| Relevance | Default when there's a search query |
| Rating | Bayesian average: a recipe's ratings plus three of 3 stars, `(sum + 9) / (count + 3)`, so a recipe nobody has rated scores 3. Recomputed when a rating changes. |
| Recently added | Date first published |
| Total time | Ascending or descending. Recipes without a total time come last either way. |

**Results**
- Search has its own page, linked from the header. Until something is searched, it lists every recipe the reader may see, newest first.
- The full search state (query, filters, sort, page) lives in the URL, so searches can be bookmarked and shared.
- The filters are beside the results, behind a Filters button on a phone. Each value shows how many results it would give, most common first; a long list shows the six most common, and every one chosen, until asked for all. A tag value can be checked to include it, or left out with the button beside it.
- Ingredients are picked in the filters, from suggestions as they're typed (Autocomplete, above), each with how many recipes use it. Each one chosen shows below, with a button to take it off.
- Total time is offered as a few ranges: 15 minutes or less, 30, an hour, two hours, or over two hours. A link can hold any range, which is then shown with them.
- The sorts are offered as best match, newest, top rated (by rating), quickest and longest. The best match is offered only for a search with words; without them, the newest come first.
- Results are paginated, 24 to a page, and show a count for each filter value. A filter that takes any of its values (cuisine, meal type, difficulty) is counted without its own choices, so each of its other values shows what adding it would give.
- Results include only recipes the caller may see (§2). Drafts are never searchable.
- Each result is checked against the database before it's shown, since the index can be behind: a recipe made private or deleted since never shows to anyone it no longer should. Nor is it counted, so the count matches what's shown.

**Browsing**
- Home lists every recipe the reader may see, newest first, 24 to a page, straight from the database (`GET /recipes`), so it works while search is unavailable. The page is in the address.
- Home may later gain curated categories above the list. They aren't planned for a phase yet.

### 3.5 Grocery lists (editors and admins)

- **From a collection.** A collection's page links to its grocery list: the ingredients of every recipe in it that its user can see, across the whole collection, added up. Nothing is stored. The list is worked out each time it's opened, from the recipes as published then, and a recipe left out of the collection (§3.2) is left out of the list.
  - To shop for a week, put its recipes in a collection, and empty it afterwards with Remove all.
- **Servings:** the list names each recipe with its servings, its own until others are chosen there. Scalable quantities are scaled before they're added up.
- **Using it:** each line has a checkbox, to tick off what's in the basket or already at home. The servings chosen and the lines ticked are kept in the page's address, so a reload or the back button keeps them; nothing is saved.
- **Printing:** the page has a Print button. What's printed is the list as shown: each line with a box, ticked if it's ticked, and the recipes with their servings, without the header or the page's controls. Always in the light theme, as recipes are (§3.7).
- **Aggregation rules:**
  1. Group lines by `normalized_name`: one line each, showing the name most of its lines use. If that's a tie, the longest, which is usually the plural ("eggs" for "2 eggs" and "1 egg"), then the first alphabetically.
  2. Within a group, convert and add quantities only when units share a dimension (volume, mass, count). A named unit (cloves, cans) adds up only with itself.
  3. Amounts that can't be added up are shown side by side on the group's line, e.g. "garlic: 2 cloves, 1 tbsp".
  4. Lines without a quantity ("salt to taste") add nothing to their group's amounts. A group with only those shows no amount.
  5. Each line records the recipes that contributed to it, and the list shows them.
  6. Ranges add up end to end: "2–3 cloves" and "1 clove" make "3–4 cloves".
  - Totals are shown in the reader's unit system, in the largest sensible unit, as scaled amounts are on a recipe's page (§3.2).
  - Lines are in alphabetical order. A ticked line stays where it is, crossed out.
- **Implementation:** the conversion and aggregation logic is a pure module in `packages/shared`, covered by unit tests and property-based tests:
  - scaling up then back down returns the original
  - the order of the recipes doesn't change the result
  - adding up scaled recipes gives the total scaled

### 3.6 Cook mode

- **Opened** from the Cook mode button on a recipe's page, by anyone who can see the recipe. It has its own address, under the recipe's, and a link back to it.
- **Layout:**
  - a large-type, distraction-free view, under the app's usual header
  - a servings selector, and the units switch
  - scaled ingredients, and the equipment the recipe needs
  - **all steps on one page**, with their photos
- **Servings go along:** cook mode opens at the servings chosen on the recipe's page, and the link back keeps those chosen in cook mode. The address holds them (`?servings=6`), so a reload keeps them too.
- **Screen stays awake** while cook mode is open, using the Screen Wake Lock API, and releases when cook mode closes.
  - The API only works in a secure context: HTTPS or `localhost`. Caddy serves HTTPS so this works on phones over the LAN, with certificates from its own local CA, which each device trusts once (ADR 0013).
  - The page says whether the screen stays on. If wake lock isn't available, or the browser refuses it (in battery saver mode, say), it says so plainly; nothing else is affected.
  - Browsers let go of the lock while the page is hidden, so it's asked for again each time the page shows.
- **Out of scope:** timers, voice control, saved progress, a one-step-at-a-time view (§7).

### 3.7 Import and export

**URL import (best effort, editors and admins)**
- On the New recipe page, whoever may create recipes pastes the address of a recipe's page.
- The server fetches it and reads the schema.org/Recipe data it holds as JSON-LD: the structured data recipe sites publish for search engines.
- A successful import fills in the New recipe form, to review and change before saving it, as with any new recipe. Nothing is saved until then, except the photo below. Ingredient lines go through the normal parser, as typed ones do.
- **What's imported:**
  - the title and description, as plain text
  - ingredients, in one group
  - steps; a section of them starts with its name, in bold
  - equipment, servings and yield, prep, cook and total times, and nutrition
  - the source: the page's address, its site's name and the recipe's author
  - tags it names (cuisine, category, diet) that already exist, never new ones
  - its first photo, uploaded as if the importer had added it. If it can't be fetched or isn't accepted, the import goes on without it.
- If the page has no recipe data, can't be fetched, or isn't at a public address, the address field says so. There is no fallback scraping.
- **SSRF guard:**
  - only `http` and `https` URLs
  - private, loopback, link-local and other special-purpose addresses are blocked, IPv4 and IPv6 alike. The check is on the address actually connected to, so a name that resolves elsewhere the second time can't get around it (ADR 0017).
  - every redirect is checked again, up to 5
  - pages up to 5 MB and photos up to the upload limit, counted after decompression, all within 10 seconds
  - no cookies or credentials are sent

**Downloads**
- **Print view:** a print stylesheet; the browser handles PDF. A recipe's page has a Print button, for anyone who can see it, which opens the browser's print dialog.
  - What's printed is the recipe as shown, at the servings and in the units chosen, without the header, the page's buttons and controls, or the slideshow's.
  - Always in the light theme, whichever is on screen: browsers leave out backgrounds when printing.
- **Per-recipe export:** anyone who can see a recipe downloads it from its page, as published:
  - as JSON, myli's own format, with its tags by name and a format version
  - as schema.org/Recipe JSON-LD, which other recipe apps import: its markdown as plain text, its cuisine and meal type tags as its cuisine and category, diets schema.org knows as its diets, and other tags but allergens as keywords
  - Neither holds its photos, whose addresses work only signed in to the instance.
- **Full-instance export (admins):** one zip archive, downloaded as it's made, recorded in the audit log:
  - every recipe the admin may see, as published, with all its revisions, each in a JSON file of its own
  - every tag, and each photo those recipes and revisions show, at its largest size
  - a manifest, saying what it holds and any photo whose file was missing
  - Other people's private recipes, and recipes in the trash, aren't in it: backups hold everything. Nor are ratings, comments, notes, favorites or collections, which belong to their readers.
  - It's one-way: myli doesn't read it back.

## 4. Search architecture

- **SQLite is authoritative.** Meilisearch is a derived read model. It is never backed up and can always be rebuilt from SQLite.
- **Sync through a transactional outbox.**
  - Every write that changes a recipe's search document inserts a `job` row in the same SQLite transaction. That includes publishing, rating changes, tag renames, merges and deletes, visibility changes, deleting, restoring and purging.
  - An in-process worker reads pending jobs and sends the full document to Meilisearch as an upsert or delete.
  - Jobs are idempotent, retried with backoff, and dead-lettered after a maximum number of attempts. Index updates keep trying for about thirteen hours, so a Meilisearch outage doesn't leave the index behind; other jobs give up after a few minutes.
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
  - an admin action (the Search index page, in the Admin menu) and a CLI command (`node src/reindex-search.ts` in the API's container) build a fresh index and swap it in atomically
  - the Search index page says whether search works and how the latest rebuild went, and keeps checking while a rebuild is under way
  - it runs as a background job, one at a time with the index updates, so no update is lost in the swap
  - each time search is set up (on startup, and again after Meilisearch lost its data), the API reindexes if the index is missing or empty while SQLite has recipes
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
| `recipe` | `owner_id`, `visibility`, `public_token`, `version`, `title`, `description_md`, `yield_qty`, `yield_unit`, `servings`, `prep_min`, `cook_min`, `total_min`, `difficulty`, nutrition columns, `source_url`, `source_title`, `source_author`, `equipment` (JSON), `cover_image_id`, `deleted_at` |
| `recipe_ingredient` | `recipe_id`, `group_label`, `group_position`, `position`, `raw_text`, `qty`, `qty_max` (the top of a range), `unit`, `name`, `normalized_name`, `note`, `scalable` |
| `recipe_step` | `recipe_id`, `position`, `body_md`, `image_id` |
| `recipe_draft` | `recipe_id` (one per recipe), `content` (JSON, as the API took it), `revision` (the one it started from), `author_id` (who saved it last), `updated_at` |
| `recipe_revision` | `recipe_id`, `number` (from 1, per recipe; the latest is the one published), `snapshot` (JSON, with its format's `schemaVersion`), `author_id`, `message`, `created_at` |
| `tag`, `recipe_tag` | `tag.type`, `tag.name`, `tag.name_key` (the name without case or extra spaces; unique per type). The allergen tags are seeded by a migration. |
| `image` | `recipe_id` (null until a recipe is saved with it), `position` (among the recipe's images; null for a step's), `alt_text` (empty for none), `uploader_id`, `mime`, `width`, `height`, `variants` (JSON, each with its blob key) |
| `favorite`, `rating`, `comment`, `user_note` | Per user, per recipe |
| `collection`, `collection_item` | Per user; items are ordered |
| `user_preference` | `user_id`, `unit_system`. No row means the defaults. The theme isn't here: it's chosen per browser (§6). |
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
- Mobile-first layouts, especially cook mode and grocery lists.
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
- **Demo data:** a seed script, for a new instance only, creates one account per role, with random passwords it prints once, and 20 recipes written by the admin and the editor, across cuisines, meals, diets and allergens. Each of the two keeps one private, which the other accounts never see.

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
- saved or shared shopping lists, and items added by hand: a grocery list is worked out from a collection when it's opened (§3.5)
- fallback HTML scraping for URL import

## 8. Delivery phases

Each phase is delivered as small, atomic increments, each reviewed on its own (see `CLAUDE.md`).

| Phase | Scope |
|---|---|
| **0. Foundation** | Monorepo; Compose (Caddy, API, Meilisearch, Mailpit); Hono + OpenAPI + Scalar; Drizzle + SQLite; Better Auth with roles, first-run setup and invitations; job/outbox worker; audit log; CI; seed script |
| **1. MVP** | Recipe create/edit/delete with ingredient groups, structured steps and ingredient parsing; tags, allergens, diet, nutrition; images; scaling and units; visibility; Meilisearch indexing, search, filters and sorting; favorites; cook mode; print view |
| **2. Collaboration** | Drafts, revisions, compare and restore; optimistic concurrency; comments; ratings; collections; personal notes; public links; trash |
| **3. Grocery lists** | A collection's grocery list: aggregation, normalization and dedup, servings per recipe, check-off, printing; emptying a collection |
| **4. Best effort and polish** | URL import; JSON and JSON-LD export; full-instance export; backup and restore tooling; the S3 blob storage adapter, tested against Garage; finished documentation |

Before Phase 2, saving a recipe changed its published version directly. Deleting one has always set `deleted_at`, so recipes deleted then are in the trash too, counted from when they were deleted.

## Open questions

These need decisions before or during the phase that uses them:

1. ~~**Trash retention period** before permanent purge (Phase 2).~~ Decided: 30 days by default, set with `TRASH_RETENTION_DAYS`.
2. ~~**Bayesian rating parameters** (Phase 2).~~ Decided: a fixed prior of 3 stars, weighted as 3 ratings. Unlike the instance-wide mean, a fixed prior means a rating changes only its own recipe's score.
3. ~~**Image limits** (Phase 1).~~ Decided: uploads up to 10 MB. Variants are served as WebP, at sizes chosen from the layouts images appear in, so they look good where they're shown: 640, 1280 and 2048 pixels wide.
4. ~~**Revision retention** (Phase 2).~~ Decided: keep every revision while its recipe exists; snapshots are small.
5. ~~**Failed-login audit events** may be noisy (Phase 0).~~ Decided in Phase 0: record every one and keep them. Revisit pruning when the Phase 2 purge job exists.
