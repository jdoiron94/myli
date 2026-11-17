# myli

myli is a self-hosted recipe app that runs with Docker Compose. It is built for real household use.

- Full feature spec: `docs/spec.md`
- Architecture decisions: `docs/adr/`

## Working agreement (non-negotiable)

- **Git: local, non-destructive use is fine. Get explicit permission first for anything destructive or remote:**
  - pushing to any remote
  - deleting remote branches
  - rewriting history (force push, rebase, amending pushed commits)
  - discarding work (`reset --hard`, `checkout -- .`, `clean`, `branch -D`, `stash drop`)
- **Work in small, atomic increments.** Each increment is one coherent change that can be reviewed on its own, committed locally with a conventional commit message once it's green. Example: "Drizzle setup + first migration", not "the whole data layer".
- **Plan each phase as a list of increments in groups** before writing its code. Each group, such as "shared scaling and parsing logic", gets its own branch from `main` and, once approved, its own PR.
- **Check in at the end of each group,** and sooner whenever a decision or feedback is needed before going on. Each check-in lists, for each increment:
  - which files changed
  - why
  - how to verify (commands to run, what to look for)
  - anything deferred or uncertain
- **Wait for approval before starting the next group.** Feedback on an earlier increment lands as a new commit, never by rewriting history.
- **Every increment ships its own tests and doc updates** and leaves lint, typecheck and tests green.

## Scope

`docs/spec.md` defines what is in scope and the phase order. These were deliberately rejected. Don't build them or suggest them unless the user brings them up:

- multi-tenancy or households (there is one instance with instance-wide roles)
- canonical ingredient catalog, pantry, "what can I make?"
- meal planner
- forking or copying recipes
- passkeys, 2FA, OIDC/social login
- PWA or offline support
- cook-mode timers, voice control, saved progress, one-step-at-a-time view (cook mode shows all steps on one page)
- automatic nutrition lookup (nutrition is entered by hand)

## Architecture at a glance

- **Monorepo** with pnpm workspaces:
  - `apps/web`: Vue 3 + TS + Vite + Vue Router, styled with Tailwind and shadcn-vue
  - `apps/api`: Node + TS + Hono
  - `packages/shared`: Zod schemas, types, permission policy, scaling/unit/aggregation logic
- **Runtime:** Node runs the API's and `shared`'s TypeScript source directly, using its built-in type stripping. There's no build step or `dist/` (ADR 0008).
- **Storage:**
  - SQLite (better-sqlite3 + Drizzle) is the **source of truth**
  - Meilisearch is a **derived** search index, rebuildable from SQLite
  - blobs go through a `BlobStore` interface: local volume by default, an S3 adapter optional
- **Services:** Caddy serves the SPA, proxies `/api`, and terminates HTTPS. HTTPS is required for the Screen Wake Lock API on the LAN.
- **Auth:** Better Auth (email + password) with the `admin` plugin for roles (`admin`, `editor`, `viewer`), plus a custom invite-only invitations module.

## Conventions and guardrails

### Types and contracts
- TypeScript `strict` everywhere. No `any` without a comment explaining why.
- Relative imports include the `.ts` extension, and only erasable TypeScript syntax is allowed (no enums, namespaces, parameter properties or decorators). Node can't run anything else (ADR 0008).
- `packages/shared` runs in both Node and the browser, so it gets neither Node nor DOM types.
- Zod schemas in `packages/shared` are the single source for validation and types.
- The API's OpenAPI 3.1 spec is generated from those schemas. Every versioned route is declared with `createRoute` in its feature module (e.g. `apps/api/src/setup/routes.ts`), registered on the router from `apps/api/src/v1.ts`, and spreads `errorResponses` into its `responses` (a test fails otherwise). Give shared schemas a component name with `.meta({ id })`, not `.openapi()`, because `packages/shared` doesn't depend on the OpenAPI library.
- The committed copy, `apps/api/openapi.json`, must match the generated one, and so must the web app's types generated from it with openapi-typescript, `apps/web/src/api/schema.ts`. Run `pnpm openapi:generate` after changing a route or schema, which rewrites both, or `pnpm test` fails.
- The web app calls the API only through its typed client (see Web app). Never hand-write API request or response types.
- API errors use RFC 9457 `application/problem+json`, matching `problemDetailsSchema` in `packages/shared`. Handlers fail by throwing `HttpProblem(status, detail)`, and `detail` goes to the client verbatim. Any other error becomes a generic 500 with only the request ID, and the details go to the log. Never put internals in a response.
  - A field that passed its schema but still can't be used, like a tag that no longer exists, fails with `InvalidFields([{ path, detail }])` (`problems.ts`): the same 422 `ValidationProblem` a schema failure gets, so forms show it next to the field.
- **The one exception is Better Auth's own routes** under `AUTH_BASE_PATH` (`/api/auth/*`). Better Auth answers them in its own format, and they're not in the OpenAPI document. The web app calls them through Better Auth's client, which ships its own types. Errors Better Auth didn't raise itself still become our generic 500 (`onAPIError.throw`). Never add app endpoints under `/api/auth`.

### Authentication
- Better Auth is configured in `apps/api/src/auth/auth.ts`. Public sign-up is disabled. Create users only with `createUserWithPassword()` from `auth/users.ts`.
- Passwords follow `passwordSchema` from `@myli/shared`. A Better Auth hook enforces it on every path that sets a password (create-user, change, reset), and request bodies that carry a password validate it with `passwordSchema` too, for field-level 422s.
- The admin plugin stores each user's single role (a CHECK constraint enforces it). Its HTTP endpoints (`/api/auth/admin/*`) are blocked for everyone, so role changes and bans can't skip the policy module or the audit log.
- Role changes, deactivation and reactivation go only through `apps/api/src/users/manage.ts`, which writes the `role` and `banned` columns and deletes sessions directly. The check that the acting admin is still an active admin, the change and its audit event then share one transaction (ADR 0010). Don't use `auth.api.setRole`, `banUser` or `unbanUser` instead.
- No role has any admin-plugin permission, and none needs one: the only plugin call is `createUser`, made without a session, which the plugin allows without checking permissions. Don't add permissions. The roles still have to be listed in `auth.ts`: without them, admins would get the plugin's defaults, impersonation and hard deletes included.
- Better Auth reads `process.env` itself in places. Pass anything it would infer from there (rate limiting, the origin check) explicitly from our validated env.
- On `/api/v1` routes, `c.var.user` (`id`, `name`, `email`, `role`) and `c.var.session` are the signed-in user and session, or `null`. Routes that need a user add the `requireSession` middleware (401 otherwise), which also narrows the type.
- **Never turn on Better Auth's cookie cache.** Every request reads the session from SQLite, so sign-out, expiry and bans take effect on the next request. The cache would let a revoked cookie keep working until the cache expires.

### Authorization
- All authorization goes through the shared policy module: `can(user, action, resource?)` in `packages/shared/src/policy.ts`. Never write inline role checks in handlers or components.
- A new action gets a row in the `✓`/`–` tables in `policy.test.ts`, restating the spec's §2 table. A test fails if an action has no row.
- Guards, in `apps/api/src/auth/`:
  - `requireSession`: any signed-in user (401 otherwise).
  - `requirePermission(action)`: role-only actions such as `user.invite` (401, then 403). Add it to `createRoute({ middleware: [...] as const })`; it narrows `c.var.user` to non-null.
  - `authorize(c, action, resource)`: recipe and comment actions, called in the handler once the resource is loaded. It answers 404 when the user may not see the recipe, identical to `notFound()`, which handlers also throw for IDs they can't find. Never write a different 404 for a hidden resource.
- Every new endpoint gets an entry in `ENDPOINTS` in `apps/api/src/permission-matrix.ts`: its method, OpenAPI path, `access` and a valid request. The matrix test sends that request as anonymous, viewer, editor and admin and checks the status against `can()`. It also fails if an OpenAPI operation has no entry.
  - `access` is `public`, `signed-in`, a role-only action, or `{ recipe: action }` for an endpoint on one recipe.
  - An endpoint on one recipe is tried against the caller's own and someone else's private and shared recipe (`RECIPE_CASES`), and its `send` gets that recipe's ID. Where the policy hides the recipe, it must answer 404; where it shows it but forbids the action, 403.
- **Web pages** that need a role-only action set `meta.permission` (e.g. `'user.invite'`), which the router checks with `can()`. Someone without it sees the no-access page at the same address. Links to such a page show only when `can()` allows it: the header's links (`NAV_PAGES` in `AppLayout.vue`) read each page's `meta.permission` and `meta.title` from the router.
- **Viewers are strictly read-only.**
- **Private recipes must never leak** through direct ID access, search results, revision endpoints, public links or deactivating their owner. Each of those paths has a test.

### Database
- The Drizzle schema in `apps/api/src/db/schema.ts` is authoritative. After changing it, run `pnpm db:generate` and commit the new migration in `apps/api/drizzle/` (`pnpm test` fails if a schema change has no migration).
- Never edit a migration that has been committed; add a new one. The API applies pending migrations on startup, before it listens.
- Enumerated text columns get a CHECK constraint, not just a TypeScript type.

### Background jobs
- Side effects that can fail or are slow (sending email, updating Meilisearch) run as jobs, never inline in a request.
- Define a job type with `defineJob({ type, payload, handle })` from `jobs/define.ts`, in the feature module it belongs to (e.g. `invitationEmailJob` in `invitations/invitations.ts`), and add it to `allJobs` in `jobs/all.ts`. The worker dead-letters job types it doesn't know.
- Handlers get the database, the mailer and `publicUrl` (for links in emails) from `context.services` (`JobServices` in `jobs/define.ts`). `main.ts` builds it; tests pass their own. Never import or create a database or mailer in a job module.
- Queue a job with `enqueueJob(tx, definition, payload)` **inside the transaction of the write it belongs to**, so the job and the change commit or roll back together.
- Handlers must be idempotent. A job can run more than once: after a crash, or when it fails after its side effect happened.
- A job whose handler throws is retried with exponential backoff, then dead-lettered (`status = 'dead'`, error in `last_error`). Throw to retry. A payload that no longer matches its schema is dead-lettered without running.
- Keep payloads small and stable: IDs, not whole records. Handlers read current state from SQLite. If a payload schema changes, jobs already queued still have to parse.

### Email
- Email is sent only from job handlers, through `context.services.mailer`. It's `null` when `SMTP_HOST` isn't set, and every feature that sends email must still work without it (invitations fall back to a copy-link action). Route handlers decide whether to queue email from `SMTP_HOST`, the same condition `main.ts` uses to create the mailer.
- Never put a secret, such as an invitation token, in a job payload. Make it in the handler, store what the database needs (a hash) before sending, then send.
- Every message has a plain-text body; HTML is optional, and anything user-written in it is escaped.
- Log the `messageId` that `send()` returns, through the job's logger. Never log recipients, subjects or bodies.
- Sends are at-least-once: if the process dies after the server accepted a message but before the job was marked done, it's sent again.
- SMTP server certificates are always verified. Don't add an option to turn that off.

### Audit log
- Record an event with `recordAuditEvent(tx, auditOrigin(c), { action, target, metadata })` from `apps/api/src/audit/audit.ts`, **inside the transaction of the change it records**.
- Only when the change already happened outside our transaction (Better Auth created the user, signed them in or out), use `recordAuditEventAfterwards`, which logs a failure instead of failing the request.
- Actions are `AUDIT_ACTIONS` in `packages/shared/src/audit.ts`, the full list from spec §3.1, and a CHECK constraint enforces them. Adding one takes a migration.
- Metadata is for admins to read. Never put a secret in it: no tokens, hashes or passwords.
- `audit_event` is append-only: triggers refuse every UPDATE and DELETE. Rebuilding the table (which drizzle-kit does for some changes) drops them, so such a migration must create them again. `audit.test.ts` fails if they're missing.
- Sign-ins and sign-outs are recorded by `auditSignIns` and `auditSignOuts` (`audit/auth-events.ts`) in front of Better Auth's routes, from its HTTP responses, not its internals.

### Search
- The browser never talks to Meilisearch. All search goes through the API, which adds the authorization filter.
- Any write that affects a recipe's search document queues a job with `enqueueJob` **in the same SQLite transaction**. Never call Meilisearch inline from a request handler.
- Only published recipe versions are indexed; drafts never are.
- Index settings (searchable, filterable and sortable attributes, ranking rules, synonyms) are `RECIPES_SETTINGS` in `apps/api/src/search/settings.ts`, typed against `RecipeSearchDocument` (`search/document.ts`), so they can't name a field the document doesn't have. `setUpSearch()` (`search/setup.ts`) applies them on startup.
- **Keys:** the master key (`MEILI_MASTER_KEY`) is used only in `setUpSearch()`, to create the API's own key, `API_KEY` in `settings.ts`. Everything else uses that key, through `search.client`. Never log either key.
  - It's limited to the actions the API needs and to the `recipes*` indexes. When the API needs another action, add it to `API_KEY.actions`; the next startup replaces the key, since Meilisearch can't change a key's actions.
  - Meilisearch derives the key from its fixed `uid` and the master key, so it's the same after every restart and isn't stored anywhere.
  - Because of the index limit, the key can't read the task of an index swap, which belongs to no index (Meilisearch answers `task_not_found`). Tasks run in the order they were queued, so wait for the next task on the swapped indexes instead, such as deleting the old one.
- **Degraded mode:** the API starts and serves everything but search without Meilisearch. `createSearchService()` (`search/service.ts`) runs setup in the background, retrying with backoff, and runs it again when `/readyz` finds the key or the index gone, as after Meilisearch lost its data. `/readyz` answers 503 while the database or search is unavailable; `/healthz` only says the process is up.

### Content and security
- **Cross-site requests:** every `/api/v1` request other than GET, HEAD and OPTIONS must say `Content-Type: application/json`, even with no body. `jsonOnly()` (`apps/api/src/json-only.ts`) answers 415 otherwise, before any route runs. With no CORS headers, that's what stops another origin from making requests with a user's cookie: a form or a no-CORS fetch can only send form-encoded, multipart, `text/plain` or no content type. `SameSite=Lax` alone isn't enough, because other origins on the same site, like another app on a different port of the same host, still get the cookie. Never exempt a route from `jsonOnly()`, accept form-encoded or `text/plain` bodies, or add CORS headers on cookie-authenticated routes. Test requests to bodyless endpoints send the header too.
- User-written markdown (descriptions, steps, comments) is shown only through `MarkdownContent` (`apps/web/src/components/MarkdownContent.vue`), which renders it with `renderMarkdown()` (`src/lib/markdown.ts`): markdown-it with raw HTML off, then DOMPurify with an allowlist. Never `v-html` anything else.
  - No images (the CSP loads images only from this site; photos are uploaded), no tables, no `style` or `class` attributes, and links only to http(s), mailto or a path on this site.
  - Its `headingLevel` prop is the level a `#` becomes: one below the heading of the section it's in, so it never adds a second `<h1>`.
- Uploads are validated by reading the file's first bytes, size-limited, and stripped of EXIF data.
- Outbound fetches (URL import) go through the SSRF guard.
- **The client's address** is `c.var.clientIp`, set by `clientAddress()` (`apps/api/src/client-ip.ts`). It's the connection's address, unless the connection comes from a proxy listed in `TRUSTED_PROXIES`; then it's the rightmost address in `X-Forwarded-For` that isn't a trusted proxy.
  - The audit log records it. Before a request reaches Better Auth, `withClientIp()` sets `X-Forwarded-For` to exactly that address (or removes it), so the IP Better Auth stores on sessions and rate-limits by is the same one.
  - Never read `X-Forwarded-For` or the socket's address anywhere else. Don't use Better Auth's own `trustedProxies` option: it reads only the header, so it can't tell who sent it.
- The API logs through pino, never `console` (ESLint enforces this). Inside a request, use `c.var.logger`, which tags every line with the request ID. Never log query strings, headers, request bodies or secrets.
- Configuration comes from env vars, validated with Zod at startup in `apps/api/src/env.ts`. Every new var goes into that schema and into `.env.example`, with its default or, if it's required, an empty value. A test fails if the two differ.
  - Secrets can come from a file instead, for Docker secrets: `NAME_FILE` holds the path (`FILE_VARIABLES` in `env.ts`). A new secret goes into that list, and its `NAME_FILE=` line into `.env.example`.
  - Setting both `NAME` and `NAME_FILE` is an error. A problem with a file names its path, never its contents.

### Web app
- `@/` is `apps/web/src/`.
- **shadcn-vue components** live in `apps/web/src/components/ui/`, as its CLI writes them (style `reka-vega`, base color `neutral`, see `components.json`). The CLI never merges into them: `add` skips a file that already exists, and `add --overwrite` replaces it, dropping local edits. So keep edits to them to a minimum. To take an upstream update, overwrite the component, run `pnpm format`, and use `git diff` to re-apply the edits it dropped, such as the `cn` import below. A component with an edit beyond that says so in a comment, like `AlertDialogDescription.vue`'s line wrapping.
  - Add one from `apps/web` with `pnpm dlx shadcn-vue@2.9.0 add <name>`.
  - When the new component depends on one we already have (`alert-dialog` uses `button`), the CLI asks whether to overwrite it, even with `--yes`, and stops when it can't ask. Copy the existing component's folder aside, run with `--overwrite`, and copy it back.
  - The CLI installs shadcn's `cn` package and imports it in the new files. Remove that dependency, and import `cn` from `@/lib/utils` instead (clsx + tailwind-merge). ESLint flags the import.
  - Its other dependencies follow the usual rules: exact versions, at least a week old (pnpm refuses younger ones).
- **Styling:** theme colors are CSS variables in `src/style.css`. They must meet WCAG AA contrast in both themes, which only the end-to-end tests can measure (jsdom has no layout); `--destructive` is darker than shadcn's for that reason. Text uses the system font stack; never load web fonts from a third party.
- **Every page has exactly one `<h1>`.** After each navigation the layout moves focus to it, for keyboard and screen-reader users. A route other than home sets `meta.title`, which becomes the browser tab's title.
  - A page whose heading comes from what it loads, like a recipe's title, renders its `<h1>` from the start with a placeholder ("Recipe"), so there's something to focus, and sets the tab's title with `documentTitle()` (`src/router.ts`) once loaded, only while its route is still the current one.
- **Dark mode** is `useTheme()` in `src/theme.ts`. `public/theme.js` applies the saved choice before the app loads, so the page doesn't flash. The two share a storage key and class names; a test runs the real file against the app.
- **API calls** go through `api` from `src/api/client.ts` (openapi-fetch, typed by the generated `schema.ts`), never a bare `fetch`. Paths are relative to `/api/v1`: `api.GET('/setup')`. It sends `Content-Type: application/json` on every write, bodyless ones included, which `jsonOnly()` requires. `responseData(await api.GET(...))` gives a successful call's body.
  - A failed call throws an `ApiProblem` (`src/api/problem.ts`) with the `status`, the `problem` the API sent, and for a 422, the `fieldErrors` a form shows next to each field. A response that isn't a problem, such as a proxy's error page, becomes a generic one with its status. A call that returns has succeeded.
- **Server state** goes through TanStack Query (`src/api/query.ts`). Queries retry network failures and 5xx responses twice, never a 4xx. Mutations never retry, since a retried write could happen twice. `installApp()` in `src/app.ts` installs the router and the query client, for `main.ts` and for tests.
  - A page that loads data shows a failure with `RetryableFailure` (`src/components/RetryableFailure.vue`), given its props by `useRetry(query)` (`src/api/retry.ts`). The failure stays on screen while it tries again, which a bare query wouldn't do, and focus moves to the page's heading once the button is gone.
  - A mutation that changes a list on the page uses `useRefreshingMutation(queryKey, fn)` (`src/api/refreshing-mutation.ts`), which refetches that list when the mutation settles, whether it succeeded or failed. `mutateAsync` returns only after the refetch, so the page can move focus within the new list.
- **Signing in and the session:** Better Auth's routes go through `authClient` from `src/auth/client.ts`, wrapped in `unwrap()`, which throws an `AuthProblem` (an `ApiProblem` with Better Auth's `code`) for an error answer.
  - The session is a TanStack query, `sessionQuery` in `src/auth/session.ts`: the signed-in `User` (role included, checked against `userSchema`) or `null`. Read it with `useQuery(sessionQuery)`; don't use Better Auth's own `useSession` store. It's fetched once and changed only by `useSignIn()`, `useSignOut()` and the session watcher below. Signing out also removes every other cached query.
  - `watchSession()` (`src/auth/session-watch.ts`, installed by `installApp()`) watches every query and mutation for `/api/v1` answers that mean the session is out of date. Better Auth's own errors, like a wrong password's 401, aren't counted.
  - **When the session ends** (it expired, the user was deactivated, or they signed out elsewhere), the next `/api/v1` call gets a 401. The watcher clears the session and every other query, and goes to sign-in, which explains, fills in the email and comes back afterwards. Pages don't handle 401s themselves.
  - **When the role changes,** the session goes on, but the cached `User` has the old role. After a 403, the watcher fetches the session again (several 403s share one request). If the role changed, it re-runs the router's checks on the current page, which shows the no-access page if the new role doesn't allow it. If the session is gone, it's a 401 as above. The page still explains the 403 itself, as any other refusal.
  - Pages are for signed-in users. The router waits for the session before each navigation and sends signed-out visitors to `/login?redirect=…`. A route sets `meta.access` to `'signed-out'` (only for signed-out visitors, like the sign-in page), `'setup'` (only while first-run setup is needed) or `'public'` (anyone; the session isn't checked). If the session can't be fetched, the router shows `/unavailable`, which tries again when asked.
  - **First-run setup:** when no one is signed in, the router also asks whether setup is needed (`setupStatusQuery` in `src/auth/setup.ts`). While it is, `/setup` is the only page. Someone signed in proves a user exists, so it doesn't ask then, and once setup is done it never asks again.
  - A page that sends someone on to sign in, like setup, uses `goToSignIn(router, { email, notice }, returnTo?)` from `src/auth/sign-in-handoff.ts`. The sign-in page fills in the email and shows the notice, and signing in goes back to `returnTo` if given. They travel in the navigation's history state: never put an email in the address, where server logs would keep it.
  - Only go to a `redirect` from the address through `safeRedirect()` (`src/auth/redirect.ts`), which allows only paths on this site, so a link can't send people to another site after signing in.
  - **A secret in a link,** like an invitation token, travels in the fragment (`#…`), which browsers never send to a server. The page reads it once, keeps it in memory, sends it only in a request body, and takes it out of the address with `router.replace` straight away, so it isn't left on screen or in the browser's history. Never put one in a path or query. `AcceptInvitationPage.vue` is the example.
- **Forms** use VeeValidate with a shared Zod schema, passed through `formSchema()` from `src/lib/forms.ts` (VeeValidate's own Zod adapter only supports Zod 3). Submitted values are the schema's output.
  - Text fields are `FormTextField` (`src/components/FormTextField.vue`): a label, the input, and its error, tied together with `aria-invalid` and `aria-describedby`. Fields are checked on submit, then as they're typed in until valid again, never while first filled in.
  - A role is chosen with `RoleChoice` (`src/components/RoleChoice.vue`): radios with what each role can do, least access first (`ROLES_BY_ACCESS` in `src/lib/roles.ts`, next to the labels).
  - A new password is a `PasswordField`, validated with `newPasswordSchema`: it lists the shared password rules (`passwordChecklist`), marking each one met as it's typed, and has a "Show password" toggle. The list isn't a live region; the input points to it with `aria-describedby`.
  - After a submit that fails validation, `focusFirstInvalidField()` moves focus to the first field with an error. A form doesn't start a second submit while one is under way (VeeValidate's `isSubmitting`); mark its button `aria-disabled` meanwhile, rather than `disabled`, so it keeps focus.
  - When the API refuses a submit, `apiFieldErrors(error, fields)` gives a 422's field errors for the form's `setErrors`, then focus the first one. Explain any other failure with `failureMessage(error)` from `src/api/failure.ts`, which shows the API's `detail` for a 4xx.
- **Content Security Policy:** Caddy sends it (`apps/web/Caddyfile`, ADR 0012). On the app's pages it allows nothing inline and no eval:
  - no inline scripts, no `<style>` elements, and no `style` attributes in markup, so markdown rendered with `v-html` can't carry styles either
  - no `eval` or `new Function`. Zod's compiled fast path is off for that reason (`src/zod-jitless.ts`, which each page's entry imports first).
  - Setting styles from code, as Vue's `:style` does, is fine.
  - The end-to-end tests against the images fail on any violation (see Testing). The API docs page is the one exception, with a CSP of its own (see below).
- **The API docs** are a separate page, `api/docs/index.html`, served at `/api/docs/`, where Scalar renders `/api/v1/openapi.json` (ADR 0011). Its CSP allows inline styles, because Scalar adds them as it runs; scripts are as strict as on the app's pages (ADR 0012). The app never imports Scalar, and a build test checks that. The dev server sends everything under `/api` to the API except `/api/docs`.
  - Keep Scalar's services off in `src/api-docs/ApiDocs.vue`: its default fonts, the AI agent and developer tools it turns on by default on a local address, and its Open API Client button, which opens client.scalar.com. Its tests render it at a local address.

### Dependencies and Docker
- Every dependency must be free and self-hostable. Pin exact versions.
- **Only releases at least a week old,** dependencies of dependencies included. pnpm enforces it (`minimumReleaseAge` in `pnpm-workspace.yaml`), and `release-age.test.ts` (in `apps/api/src`) checks the setting.
  - pnpm checks every lockfile entry on every install, `--frozen-lockfile` included, so a lockfile with a younger release fails locally, in CI and in the image builds.
  - Adding or updating, pnpm picks the newest release in range that's a week old, and fails (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`) when only a younger one fits: pin an older version, or wait.
  - To move indirect dependencies back to week-old releases, re-resolve them by name: `pnpm update -r --depth Infinity <names>`. pnpm otherwise keeps any lockfile entry that's still in range.
  - Never add an exception (`minimumReleaseAgeExclude`) without asking: it lets a release in before it's a week old. The test fails if there is one.
- A dependency used by more than one workspace package gets its version in the `catalog` in `pnpm-workspace.yaml`, and each package references it as `catalog:`.
- Don't use MinIO: its Community Edition is archived and no longer ships official images.
- Don't add Redis. Background jobs use the SQLite `job` table.
- Docker images use multi-stage builds, run as a non-root user, have healthchecks, and pin their base images by tag and digest. Third-party images in `compose.yaml` are pinned the same way.
- **Renovate** (`renovate.json`) opens dependency PRs on Mondays (before noon UTC), lockfile maintenance included, and only for releases at least a week old. It never merges one: every PR waits for review. `renovate.test.ts` (in `apps/api/src`) checks each of these.
  - Renovate reads its configuration only from the default branch, `main`.
  - Security fixes skip the schedule, which Renovate doesn't allow otherwise, but still wait a week. They need the repository's Dependabot alerts turned on.
  - `config:best-practices` sets 3 days for npm packages in a package rule, so the week-old rule is the last package rule. Keep it last.
  - A version Renovate can't find on its own gets a custom pattern (`customManagers`), and the test checks that the pattern still finds it: the Meilisearch image in `search/testing.ts`, and the pnpm the Dockerfiles install. Each is grouped with the copy it must match (`compose.yaml`, `packageManager`).
  - Renovate can't edit prose, so docs and comments point to where a version is pinned (`.node-version`, `packageManager`) instead of repeating it.
  - Holds: TypeScript stays below 7 (see `pnpm-workspace.yaml`), and `@types/node` below the next Node major. `engines` is raised by hand with a Node major; until then, pnpm refuses to install.
- Images build from the repo root. `.dockerignore` keeps `.env`, local databases (`apps/api/data`, `*.db`), `node_modules` and tests out of the build context; a test checks it.
- **The API image** (`apps/api/Dockerfile`) runs `node src/main.ts` as the `node` user (uid 1000), with the database at `/data/myli.db`.
  - It keeps pnpm's workspace layout, so Node finds `@myli/shared` outside `node_modules` (ADR 0008). Don't switch it to `pnpm deploy`.
  - It copies every workspace package's `package.json` before installing, so the lockfile matches. A new workspace package goes into that list.
  - `main.ts` handles SIGTERM itself, so the `CMD` stays in exec form: a shell in between wouldn't pass the signal on.
- **The web image** (`apps/web/Dockerfile`) builds the app with Vite and serves it with Caddy, as the `caddy` user (uid 1000).
  - Its configuration is `apps/web/Caddyfile`, which the build checks with `caddy validate`. Headers, the CSP, caching and routing are all set there. It sends `/api` to `API_UPSTREAM` (`api:3000` unless set), except the docs page.
  - It serves HTTPS at `PUBLIC_URL`, the same variable the API reads, with certificates from Caddy's local CA (ADR 0013). Port 80 only redirects. `docker-entrypoint.sh` refuses to start unless `PUBLIC_URL` is an `https://` origin.
  - The CA lives in `/data`, which must be a volume. **The image must never contain a CA:** `caddy validate` creates one, so the build validates against throwaway storage, and a test checks the image.
  - Its healthcheck asks Caddy on an address only reachable inside the container (`127.0.0.1:2020`), so it doesn't depend on the site's address.
  - It has no admin endpoint (`admin off`): a configuration change means a new image. It saves no copy of its configuration either (`persist_config off`), so `/data` is all it writes to, and Compose runs it read-only.
  - Its build stage runs on the build machine's platform (`--platform=$BUILDPLATFORM`), since its output is static files.
- **Compose** (`compose.yaml`, at the repo root) runs `caddy` (the web image), `api` and `meilisearch`, and `mailpit` in the `dev` profile. It reads `.env`, as `pnpm dev` does; its own variables (`MYLI_*`) are in the last section of `.env.example`, and a test fails if `.env.example` misses one or shows another default.
  - Only `caddy` publishes ports (Mailpit's are on 127.0.0.1). Images are `${MYLI_IMAGE_PREFIX}myli-api:${MYLI_VERSION}` and `…myli-web…`, with `build:` for local use.
  - **Networks:** `proxy` holds only Caddy and the API, on a fixed subnet (`MYLI_PROXY_SUBNET`) that is also the API's `TRUSTED_PROXIES`. Never add another service to it: the API believes what anything there says about the client. `backend` holds the API, Meilisearch and Mailpit, so Caddy can't reach Meilisearch.
  - **Secrets** are Compose secrets taken from the variable of the same name, which the API reads through `NAME_FILE`. Its `NAME_FILE` is `${NAME:+/run/secrets/name}`, so an empty secret counts as unset, whether Compose leaves its file out (Compose 5) or mounts it empty (older versions, like the 2.38 on GitHub's runners). A secret's variable must be listed, even empty, or Compose refuses to start. Meilisearch reads its key file through an `sh -c` wrapper, since it only takes the key from its environment.
  - Every API variable must be passed through (`NAME: ${NAME:-}`), come from a secret, or be set by the image or `compose.yaml`; `apps/api/src/compose.container.test.ts` fails otherwise, and checks the networks, ports, images and hardening below.
  - **Hardening:** every service drops all capabilities and sets `no-new-privileges`. Caddy and Mailpit are read-only. The API can't be: Compose copies secrets into the container, which it refuses for a read-only one.
  - Meilisearch is the image the container tests use, `MEILISEARCH_IMAGE` (tag and digest), with analytics off.

### Tooling
- **Biome formats and sorts imports.** Its linter is off. It covers TS, JS, JSON, CSS (with Tailwind's directives), YAML, and the `<script>` and `<style>` blocks of `.vue` files. Markdown, `apps/web/index.html` and the generated `apps/web/src/api/schema.ts` are left alone (ESLint skips that file too).
- **`<template>` blocks are formatted by eslint-plugin-vue's layout rules,** because Biome's template formatter is still experimental. `pnpm lint --fix` and the pre-commit hook apply them. They're the only layout rules turned on, and they never look at `<script>` or `<style>`, so they can't overlap with Biome.
- **ESLint lints:** `@eslint/js` recommended, typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, and eslint-plugin-vue `recommended`, layout rules included. Warnings fail the build.
- **Type checks:** `tsc` for the API, `shared` and config files; `vue-tsc` for the web app. `apps/web/src` has its own `tsconfig.json`, with browser types and no Node types; `apps/web/tsconfig.json` covers the Node-side config files next to it, such as `vite.config.ts`.
- **lefthook pre-commit,** in order: Biome fixes staged files and re-stages them, ESLint checks staged files (fixing only template layout, then re-staging), then the whole workspace is typechecked.

### CI and releases
- `.github/workflows/ci.yml` runs on every push to a branch, and on pull requests from forks (a branch of this repository was already checked when it was pushed). Three jobs run side by side on `ubuntu-24.04`:
  - format, lint, typecheck, `pnpm test` and `pnpm audit`
  - `pnpm test:e2e`
  - `pnpm test:containers`
- The runner's tools aren't yours: `ubuntu-24.04` has Docker Compose 2.38, for one. Don't make a test depend on behavior only a newer version has.
- It runs the same commands as here, nothing CI-only. Every root script that's a check must run in it, and `workflows.test.ts` (in `apps/api/src`) fails otherwise; the scripts that aren't checks are listed there, with why.
- A failed end-to-end run keeps `e2e/test-results/` as an artifact for 7 days.
- The jobs share their setup, `.github/actions/setup`: pnpm from `packageManager`, Node from `.node-version`, `pnpm install --frozen-lockfile`, and Playwright's browsers when asked.
- **`pnpm audit` never fails CI.** It lists advisories in the run's summary, with a warning. Don't make it, or any other vulnerability scan, a gate.
- **Supply chain,** in every workflow (`workflows.test.ts` checks each):
  - Actions are pinned by commit SHA, with the version in a comment: `actions/checkout@<sha> # v7.0.1`.
  - In-repo actions use GitHub's self-repository syntax, `uses: $/.github/actions/...`, never `./...`, which would load whatever an earlier step left in the workspace.
  - Each job's token gets only the access it needs, with a comment saying why. `ci.yml` can only read the repository. `ACCESS` in `workflows.test.ts` lists every workflow's and job's access, so more access shows in review.
  - Checkout keeps no credentials (`persist-credentials: false`).
- **Releases** (`.github/workflows/release.yml`, with `release-please-config.json`):
  - On every push to `main`, release-please keeps a release PR open with the next version and `CHANGELOG.md`, from the conventional commits since the last release.
  - Merging it tags the commit (`v0.1.0`) and creates the GitHub release. Only then does the `publish` job check out that commit, run `pnpm test:containers`, and push exactly the images it tested (`myli-api:e2e`, `myli-web:e2e`) to GHCR as `ghcr.io/jdoiron94/myli-api` and `…/myli-web`, tagged with the version and `latest`, for linux/amd64 only. New GHCR packages are private.
  - The first release is 0.1.0 because of `initial-version` in `release-please-config.json`: without it, release-please starts at 1.0.0, whatever the manifest says.
  - The commit type decides the version: `feat` bumps the minor, `fix` the patch. Before 1.0, a breaking change bumps the minor too: going to 1.0.0 is a decision, made with `release-as` in `release-please-config.json` (and removed after that release). `docs`, `chore`, `ci`, `test` and `refactor` commits don't release anything; Renovate's `fix(deps)` does.
  - Never edit `CHANGELOG.md`, the `version` in `package.json` or `.release-please-manifest.json` by hand: release-please owns them.
  - It uses GitHub's own token, which starts no workflow runs, so CI doesn't run on release PRs. That's also why publishing is a job in the same workflow, not a workflow started by the tag. The repository must allow GitHub Actions to create pull requests (Settings > Actions > General).
  - The images' OCI labels (title, description, `source`, license) are what GHCR shows, and `source` links each package to the repository. The web image replaces every label of the Caddy image it builds on. The image tests check them.
- Check a workflow change with zizmor, which should find nothing, and actionlint, whose 1.7.12 doesn't know the `$/` syntax yet:
  - `docker run --rm --network none -v "$PWD:/repo:ro" ghcr.io/zizmorcore/zizmor:1.32.0 --offline --persona pedantic /repo/.github`
  - `docker run --rm --network none -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.12 -ignore 'ref is missing'`

### Testing
- Vitest for unit tests.
- Web components are tested with `@testing-library/vue` in jsdom: query by role and accessible name, and interact through `@testing-library/user-event`. `apps/web/src/testing.ts` has the helpers:
  - `renderApp(path, { signedInAs, setupNeeded })` renders the whole app, mounting it as `main.ts` does, and returns `{ router, queryClient, user }`. An editor from `testUsers` is signed in by default; pass a role, or `null` for no one. `setupNeeded` (false by default) is what `GET /setup` answers when no one is signed in. Its queries retry without waiting.
  - `renderApp` answers the session and `GET /setup` only if the test doesn't already: a test that needs other answers registers its own handlers first. `answerSession(user)`, `sessionResponse(user)` and `answerSetup(needed)` help.
  - `apiServer` is the MSW server that stands in for the API. A test answers the requests it expects with `apiServer.use(http.get('/api/v1/...', ...))`, and `problemResponse(status, detail)` builds an error answer. Handlers reset after each test, and a request no handler answered fails the test, even if the code under test caught the error. A test that opens a page waits for what the page loads before it ends: a request sent after the handlers reset fails the next test instead.
  - `fakeDeviceScheme()` stands in for the device's light or dark setting.
  - Pages that show ingredient amounts load the reader's unit system (`useUnitSystem()`, `src/account/preferences.ts`). Their tests answer it with `answerPreferences(system)` from `src/account/testing.ts`.
  - `accessibilityViolations()` runs axe on the page. jsdom can't measure color contrast, so that rule is off there.
  - `describedBy(input)` gives the text of each element an input points to with `aria-describedby`, which is how a test checks a field's error and hints; `describedElements(input)` gives the elements, and `listItems(element)` the items of a list in one.
- Web tests that need no page, such as `vite.config.test.ts`, which starts the dev server and runs a build, start with `// @vitest-environment node`. `test-setup.ts` skips the page cleanup and the fake API for them.
- API integration tests use Hono's `app.request()` against in-memory SQLite. `createTestApp()` from `apps/api/src/testing.ts` builds the whole app (auth included) on a fresh, migrated database and returns `{ app, db, auth, logger, env, publicUrl }`. `signedInAs(t, role)` creates a user with that role, signs them in over HTTP and returns `{ user, cookie }`. `createTestDatabase()` from `apps/api/src/db/testing.ts` gives just the database. `freePort()` gives a port nothing listens on.
  - The test app's search is ready unless the test passes `createTestApp({ search })`, which is what `/readyz` asks.
- Job tests drive the worker one step at a time with `worker.runOnce()` and pass `now` to `createWorker`, so retries and scheduling are tested without real waiting (see `jobs/worker.test.ts`).
- Jobs that send email get `createMemoryMailer()` from `apps/api/src/mail/testing.ts`, which records messages and can be told to fail. The SMTP code itself is tested against an in-process `smtp-server`, with a throwaway certificate that `openssl` makes on each run (`mail/smtp.test.ts`).
- Scaling, unit conversion and shopping-list aggregation get property-based tests (fast-check).
- Meilisearch integration tests use Testcontainers, against the same image production uses (`MEILISEARCH_IMAGE` and `meilisearchContainer()` in `apps/api/src/search/testing.ts`). `image.container.test.ts` builds the API image, runs it next to Meilisearch, and checks the build context. `compose.container.test.ts` checks `compose.yaml` as `docker compose config` reads it. They're named `*.container.test.ts`, and `pnpm test:containers` runs them. `pnpm test` leaves them out, since they need Docker (`apps/api/vitest.config.ts`). The first run pulls the images; Testcontainers' reaper container (Ryuk) removes the containers when the run ends, even if it crashes.
- User flows get Playwright E2E tests with axe accessibility checks, in the `e2e/` workspace package (outside `apps/*`, so Vitest's projects don't pick up its specs). `tests/journey.spec.ts` follows one journey: first-run setup, sign-in, inviting someone, accepting, deactivating and reactivating them, and a role change reaching a page they already have open. `tests/api-docs.spec.ts` loads the API docs page and sends a request from it.
  - Specs import `test` and `expect` from `tests/fixtures.ts`, which fails a test on any Content Security Policy violation in its pages. Open another browser context with its `newContext` fixture, so that one is watched too.
  - **Two runs.** `pnpm test:e2e` runs against the dev servers. `pnpm test:containers` runs against the Compose stack, where Caddy sends the real headers and CSP; only that run includes `tests/web-server.spec.ts`, which checks Caddy's headers, caching and routing, and `tests/compose.spec.ts`, which checks the running stack.
  - The journey checks that the audit log records the browser's address: through the dev server's proxy, the loopback address; through Caddy, the proxy network's gateway, where Docker forwards published ports from. Each project sets it as the `clientAddress` option (`tests/fixtures.ts`).
  - **Against the dev servers,** each browser gets its own API, database and Vite dev server, on ports 3100+ and 5180+, so a run doesn't clash with `pnpm dev`. `e2e/start-api.ts` starts the API on an empty temporary database, deleted afterwards, with no first admin and no SMTP. It passes the API only its own variables, never the shell's or `.env`.
  - **Against the Compose stack,** `e2e/build-images.ts` builds `myli-api:e2e` and `myli-web:e2e` with `compose.yaml`'s build settings, and `e2e/start-compose.ts` starts `compose.yaml` for each browser as its own project (`myli-e2e-<browser>`), with `e2e/compose.e2e.yaml` on top (`playwright.containers.config.ts`). It serves HTTPS on ports 5190+, with HTTP's redirect 100 ports above, and each stack gets its own proxy subnet (10.89.1.0/29, 10.89.2.0/29).
    - Compose gets only the docker CLI's own variables and the stack's, with `--env-file /dev/null`, never the shell's or `.env`. As with `start-api.ts`, there's no first admin and no SMTP.
    - Stopping the launcher removes the stack, volumes included. If it's killed, or stopped while still starting the stack, the stack keeps running, and Playwright would refuse to start on its port. `build-images.ts` removes such stacks before Playwright starts, so `pnpm test:containers` always begins clean.
    - Each run's CA is new, so the browsers ignore certificate errors there; `web-server.spec.ts` checks the certificate itself.
  - `checkPage(page)` (`e2e/tests/accessibility.ts`) runs axe in the light and dark themes, color contrast included, and checks that the page doesn't scroll sideways at a phone's width. With a dialog or menu open, `checkPage(page, { popup: true })` checks just the popup, since reka-ui hides the rest of the page while one is open.
  - axe runs in Chromium only: running it over the Invitations page crashes the page's process in Playwright's Firefox 159 build. Firefox still goes through every step, both themes and the phone width.
  - A failed run keeps a trace and a screenshot in `e2e/test-results/`. Open the trace with `pnpm --filter @myli/e2e exec playwright show-trace <path>`.

## Commands

Run these from the repo root:

- `pnpm install`: also installs the git hooks.
- `pnpm dev`: starts the API on port 3000 in watch mode, with logs pretty-printed, reading `.env` from the repo root if one exists. It also starts the web app's Vite dev server on http://localhost:5173, which proxies `/api` to the API. Set `PUBLIC_URL=http://localhost:5173` in development: that's the origin the browser uses.
- `pnpm test`: Vitest across every workspace package. Run one package with `pnpm test --project @myli/api`.
- `pnpm test:watch`: Vitest in watch mode.
- `pnpm test:containers`: the API's tests against real services in Docker containers, then the end-to-end tests against the Compose stack (see Testing). Docker must be running, and Playwright's browsers installed. Not part of `pnpm test` or the pre-commit hook.
- `pnpm test:e2e`: Playwright's end-to-end tests, in Chromium and Firefox (see Testing). Not part of `pnpm test` or the pre-commit hook. Install the browsers once with `pnpm --filter @myli/e2e exec playwright install chromium firefox`. Arguments pass through: `pnpm test:e2e --project=firefox`, or `--headed` to watch.
- `pnpm typecheck`: `tsc --noEmit` for the root config files and every package, and `vue-tsc` for the web app.
- `pnpm lint`: ESLint over the whole repo. Add `--fix` to apply fixes, which also formats `<template>` blocks.
- `pnpm format`: Biome formats and sorts imports in place. `pnpm format:check` only reports.
- `pnpm openapi:generate`: rewrites `apps/api/openapi.json` from the routes, then the web app's API types (`apps/web/src/api/schema.ts`) from that.
- `pnpm seed`: creates the demo accounts (`setup/demo.ts`), one per role at example.com addresses, on a database with no users yet, and prints their random passwords once. It reads `.env`, like `pnpm dev`. In the API's container: `docker compose exec api node src/seed-demo.ts`.
  - It creates them the way people would: the admin through first-run setup (`runSetup`), the others by invitation from the admin, so the audit log shows how each came to be. Never give it a shortcut around those.
  - It logs to stderr, so stdout holds only the accounts. Phase 1 adds the demo recipes there.
- `docker compose up --detach --build`: the whole stack, as deployed (README's "Getting started"). It reads `.env`, where `PUBLIC_URL` must be `https://` for Caddy, unlike `pnpm dev`'s; pass another file with `--env-file` to keep both.
- `pnpm db:generate`: generates a SQL migration from changes to the Drizzle schema. Name it with `--name <what_changed>` (no `--` separator: pnpm passes arguments straight through, and drizzle-kit rejects a literal `--`).

## Docs

- `docs/spec.md` is the product spec. Update it in the same increment whenever behavior changes.
- `docs/adr/` holds architecture decisions in MADR format. When a decision changes, add a new ADR that supersedes the old one. Don't rewrite history.
