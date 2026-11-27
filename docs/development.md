# Developing myli

You need Node at the version in `.node-version`, and pnpm at the version in `packageManager` in `package.json` (any other pnpm version switches to it automatically).

```sh
pnpm install     # also installs the git hooks (lefthook)
cp .env.example .env   # then set PUBLIC_URL, BETTER_AUTH_SECRET and MEILI_MASTER_KEY, as the comments explain
pnpm dev         # web app on http://localhost:5173, API on :3000 behind it; both reload on change
pnpm dev:all     # the same, with Meilisearch for search, started in Docker and stopped with them
pnpm test        # Vitest, across every workspace package
pnpm test:e2e    # Playwright + axe, in Chromium and Firefox (first: pnpm --filter @myli/e2e exec playwright install chromium firefox)
pnpm test:containers   # the API against real Meilisearch and its built image, then Playwright against the Compose stack (needs Docker)
pnpm typecheck   # tsc and vue-tsc, for every workspace package
pnpm lint        # ESLint; --fix also formats Vue templates
pnpm format      # Biome
pnpm openapi:generate   # refresh apps/api/openapi.json and the web app's API types after changing the API
pnpm db:generate        # create a migration after changing the database schema
pnpm seed               # demo accounts, one per role, and demo recipes, on a database with no users yet; prints the passwords
pnpm reindex            # rebuild the search index, through the API that pnpm dev runs
pnpm backup             # back up now, through the API that pnpm dev runs, into apps/api/data/backups
pnpm screenshots        # retake the README's screenshots (docs/screenshots) from the demo recipes, in Chromium
```

The API docs are at http://localhost:5173/api/docs/ while `pnpm dev` runs.

In development, set `PUBLIC_URL=http://localhost:5173` in `.env`. Docker Compose reads the same file, and Caddy needs an `https://` address, so to run the whole stack as well, keep its settings in another file and pass it with `docker compose --env-file`. The browser reaches the API through the web app's dev server, and sign-in only accepts requests from `PUBLIC_URL`. The API reads `.env` if it's there and shows readable logs.

The first time you open the web app, it asks you to create the first admin, then to sign in. Instead, you can set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before starting the API, which creates that admin on startup.

The pre-commit hook formats staged files, lints them, and typechecks the workspace. [CI](../.github/workflows/ci.yml) runs every check above on each pull request to `main`, with `pnpm audit`, whose findings it reports without failing. [Renovate](../renovate.json) opens dependency PRs on Mondays, only for releases at least a week old, and each waits for review. pnpm refuses to install anything younger, dependencies of dependencies included.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), which decide each release's version: `feat` bumps the minor version and `fix` the patch, and before 1.0 a breaking change bumps the minor too. On every push to `main`, [release-please](../release-please-config.json) keeps a release PR open with the next version and its changelog. Merging it tags the release, creates the GitHub release, then [builds both images and publishes them](../.github/workflows/release.yml). They aren't tested again: the pull requests merged since the last release ran the container tests on the same build.

Search needs [Meilisearch](https://www.meilisearch.com/), which `pnpm dev:all` starts with the master key from your `.env`: Compose's own Meilisearch, published on 127.0.0.1:7700 by `compose.dev.yaml`, in a project of its own (`myli-dev`), so a stack you run from `compose.yaml` keeps its own. It waits until Meilisearch is healthy before starting the dev servers, and stops it once you stop them, keeping its index for next time. With `pnpm dev` alone, everything else works, and the API logs once that search is unavailable and keeps trying in the background.

To see the emails myli sends while developing, start [Mailpit](https://mailpit.axllent.org/) from the Compose file's `dev` profile, and open its inbox at http://localhost:8025:

```sh
docker compose --profile dev up --detach mailpit
```

Then add this to your `.env`:

```sh
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURITY=none
SMTP_FROM=myli <myli@example.com>
```

| Path | Contents |
|---|---|
| `apps/api` | Hono API |
| `apps/web` | Vue SPA |
| `packages/shared` | Zod schemas, types and logic used by both |
| `e2e` | Playwright end-to-end tests, against the dev servers or the Compose stack |
