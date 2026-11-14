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
- **Work in small, atomic increments.** Each increment is one coherent change that can be reviewed on its own. Example: "Drizzle setup + first migration", not "the whole data layer".
- **Stop and check in after every increment,** not at the end of a phase. Each check-in lists:
  - which files changed
  - why
  - how to verify (commands to run, what to look for)
  - anything deferred or uncertain
- **Wait for approval before starting the next increment.** Once an increment is approved, commit it locally with a conventional commit message.
- **Every increment ships its own tests and doc updates** and leaves lint, typecheck and tests green.
- **Plan each phase as a list of increments** before writing its code.

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
  - `apps/web`: Vue 3 + TS + Vite
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
- The committed copy, `apps/api/openapi.json`, must match the generated one: run `pnpm openapi:generate` after changing a route or schema, or `pnpm test` fails.
- The frontend's API client is generated from the OpenAPI spec. Never hand-write API request or response types.
- API errors use RFC 9457 `application/problem+json`, matching `problemDetailsSchema` in `packages/shared`. Handlers fail by throwing `HttpProblem(status, detail)`, and `detail` goes to the client verbatim. Any other error becomes a generic 500 with only the request ID, and the details go to the log. Never put internals in a response.
- **The one exception is Better Auth's own routes** under `AUTH_BASE_PATH` (`/api/auth/*`). Better Auth answers them in its own format, and they're not in the OpenAPI document. The web app calls them through Better Auth's client, which ships its own types. Errors Better Auth didn't raise itself still become our generic 500 (`onAPIError.throw`). Never add app endpoints under `/api/auth`.

### Authentication
- Better Auth is configured in `apps/api/src/auth/auth.ts`. Public sign-up is disabled. Create users only with `createUserWithPassword()` from `auth/users.ts`.
- Passwords follow `passwordSchema` from `@myli/shared`. A Better Auth hook enforces it on every path that sets a password (create-user, change, reset), and request bodies that carry a password validate it with `passwordSchema` too, for field-level 422s.
- The admin plugin stores each user's single role (a CHECK constraint enforces it). Its HTTP endpoints (`/api/auth/admin/*`) are blocked for everyone, so role changes and bans can't skip the policy module or the audit log. Server code calls them through `auth.api.*`.
- The admin role gets no plugin permission that could reach another user's private recipes or remove a user: no impersonation, no setting passwords or emails, no hard deletes. Don't add them.
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
- Every new endpoint gets an entry in `ENDPOINTS` in `apps/api/src/permission-matrix.ts`: its method, OpenAPI path, `access` (`public`, `signed-in` or an action) and a valid request. The matrix test sends that request as anonymous, viewer, editor and admin and checks the status against `can()`. It also fails if an OpenAPI operation has no entry.
- **Viewers are strictly read-only.**
- **Private recipes must never leak** through direct ID access, search results, revision endpoints or public links. Each of those paths has a test.

### Database
- The Drizzle schema in `apps/api/src/db/schema.ts` is authoritative. After changing it, run `pnpm db:generate` and commit the new migration in `apps/api/drizzle/` (`pnpm test` fails if a schema change has no migration).
- Never edit a migration that has been committed; add a new one. The API applies pending migrations on startup, before it listens.
- Enumerated text columns get a CHECK constraint, not just a TypeScript type.

### Background jobs
- Side effects that can fail or are slow (sending email, updating Meilisearch) run as jobs, never inline in a request.
- Define a job type with `defineJob({ type, payload, handle })` in `apps/api/src/jobs/`, and add it to `allJobs` in `jobs/all.ts`. The worker dead-letters job types it doesn't know.
- Handlers get the database and the mailer from `context.services` (`JobServices` in `jobs/define.ts`). `main.ts` builds it; tests pass their own. Never import or create either one in a job module.
- Queue a job with `enqueueJob(tx, definition, payload)` **inside the transaction of the write it belongs to**, so the job and the change commit or roll back together.
- Handlers must be idempotent. A job can run more than once: after a crash, or when it fails after its side effect happened.
- A job whose handler throws is retried with exponential backoff, then dead-lettered (`status = 'dead'`, error in `last_error`). Throw to retry. A payload that no longer matches its schema is dead-lettered without running.
- Keep payloads small and stable: IDs, not whole records. Handlers read current state from SQLite. If a payload schema changes, jobs already queued still have to parse.

### Email
- Email is sent only from job handlers, through `context.services.mailer`. It's `null` when `SMTP_HOST` isn't set, and every feature that sends email must still work without it (invitations fall back to a copy-link action).
- Every message has a plain-text body; HTML is optional, and anything user-written in it is escaped.
- Log the `messageId` that `send()` returns, through the job's logger. Never log recipients, subjects or bodies.
- Sends are at-least-once: if the process dies after the server accepted a message but before the job was marked done, it's sent again.
- SMTP server certificates are always verified. Don't add an option to turn that off.

### Search
- The browser never talks to Meilisearch. All search goes through the API, which adds the authorization filter.
- Any write that affects a recipe's search document queues a job with `enqueueJob` **in the same SQLite transaction**. Never call Meilisearch inline from a request handler.
- Only published recipe versions are indexed; drafts never are.
- Index settings (searchable, filterable and sortable attributes, synonyms) live in code and are applied on startup.

### Content and security
- **Cross-site requests:** routes that change data take `application/json` bodies only, and anything else gets 415. Together with `SameSite=Lax` session cookies and no CORS headers, that's what stops another site from making requests with a user's cookie, because an HTML form can't send JSON. Never accept form-encoded or `text/plain` bodies, or add CORS headers, on cookie-authenticated routes.
- User-written markdown (descriptions, steps, comments) is sanitized with DOMPurify when rendered.
- Uploads are validated by reading the file's first bytes, size-limited, and stripped of EXIF data.
- Outbound fetches (URL import) go through the SSRF guard.
- The API logs through pino, never `console` (ESLint enforces this). Inside a request, use `c.var.logger`, which tags every line with the request ID. Never log query strings, headers, request bodies or secrets.
- Configuration comes from env vars, validated with Zod at startup in `apps/api/src/env.ts`. Every new var goes into that schema and into `.env.example`, with its default or, if it's required, an empty value. A test fails if the two differ.

### Dependencies and Docker
- Every dependency must be free and self-hostable. Pin exact versions.
- A dependency used by more than one workspace package gets its version in the `catalog` in `pnpm-workspace.yaml`, and each package references it as `catalog:`.
- Don't use MinIO: its Community Edition is archived and no longer ships official images.
- Don't add Redis. Background jobs use the SQLite `job` table.
- Docker images use multi-stage builds, run as a non-root user, have healthchecks, and pin their base image versions.

### Tooling
- **Biome formats and sorts imports.** Its linter is off. It covers TS, JS, JSON, CSS, YAML, and the `<script>` and `<style>` blocks of `.vue` files. Markdown is left alone.
- **ESLint lints:** `@eslint/js` recommended, typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, and eslint-plugin-vue `recommended` with its layout rules off. Warnings fail the build.
- **Type checks:** `tsc` now; vue-tsc once `apps/web` has Vue components.
- **lefthook pre-commit,** in order: Biome fixes staged files and re-stages them, ESLint checks staged files, then the whole workspace is typechecked.

### Testing
- Vitest for unit tests.
- API integration tests use Hono's `app.request()` against in-memory SQLite. `createTestApp()` from `apps/api/src/testing.ts` builds the whole app (auth included) on a fresh, migrated database and returns `{ app, db, auth, logger, env, publicUrl }`. `signedInAs(t, role)` creates a user with that role, signs them in over HTTP and returns `{ user, cookie }`. `createTestDatabase()` from `apps/api/src/db/testing.ts` gives just the database.
- Job tests drive the worker one step at a time with `worker.runOnce()` and pass `now` to `createWorker`, so retries and scheduling are tested without real waiting (see `jobs/worker.test.ts`).
- Jobs that send email get `createMemoryMailer()` from `apps/api/src/mail/testing.ts`, which records messages and can be told to fail. The SMTP code itself is tested against an in-process `smtp-server`, with a throwaway certificate that `openssl` makes on each run (`mail/smtp.test.ts`).
- Scaling, unit conversion and shopping-list aggregation get property-based tests (fast-check).
- Meilisearch integration tests use Testcontainers.
- User flows get Playwright E2E tests with axe accessibility checks.

## Commands

Run these from the repo root:

- `pnpm install`: also installs the git hooks.
- `pnpm dev`: starts the API on port 3000 in watch mode, with logs pretty-printed, reading `.env` from the repo root if one exists.
- `pnpm test`: Vitest across every workspace package. Run one package with `pnpm test --project @myli/api`.
- `pnpm test:watch`: Vitest in watch mode.
- `pnpm typecheck`: `tsc --noEmit` for the root config files and every package.
- `pnpm lint`: ESLint over the whole repo. Add `--fix` to apply fixes.
- `pnpm format`: Biome formats and sorts imports in place. `pnpm format:check` only reports.
- `pnpm openapi:generate`: rewrites `apps/api/openapi.json` from the routes.
- `pnpm db:generate`: generates a SQL migration from changes to the Drizzle schema. Name it with `--name <what_changed>` (no `--` separator: pnpm passes arguments straight through, and drizzle-kit rejects a literal `--`).

## Docs

- `docs/spec.md` is the product spec. Update it in the same increment whenever behavior changes.
- `docs/adr/` holds architecture decisions in MADR format. When a decision changes, add a new ADR that supersedes the old one. Don't rewrite history.
