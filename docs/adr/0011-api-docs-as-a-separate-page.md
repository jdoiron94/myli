---
status: accepted
date: 2026-11-15
---

# The API docs are a separate page of the web app

Settles where the interactive docs from [ADR 0001](./0001-hono-with-openapi-from-zod.md) ("Scalar renders interactive docs from that document at `/api/docs`") are served. Everything else in ADR 0001 stands.

## Context and Problem Statement

Scalar renders the OpenAPI document as interactive docs. ADR 0001 put them at `/api/docs` without saying what serves them. Three findings shape the choice:

- **Served by the API,** `@scalar/api-reference` added about 300 packages and 370 MB to the API's production install (measured 2026-11-14). Scalar's Hono integration avoids that by loading Scalar from a CDN instead, which is a third-party request on every visit.
- **Inside the single-page app,** Scalar adds two `<style>` elements at runtime: its theme, and its toast library's CSS. No setting turns either off (`theme: 'none'` falls back to the basic theme). The Content Security Policy planned for increment 18 forbids injected styles. Scalar's stylesheet also declares cascade layers that rank above Tailwind's for the rest of the session. It puts a `light-mode` or `dark-mode` class on `<body>`, and can save a `colorMode` key in localStorage. It leaves all of these behind when it unmounts.
- **Scalar calls its own services by default.** It loads fonts from fonts.scalar.com. On a local address, as in development, it also turns on an AI chat that runs on Scalar's servers, and developer tools whose Share button uploads the document to Scalar.

Where should the docs live, and how do they stay self-contained?

## Decision Drivers

- **The app's CSP needs no exceptions,** so it can forbid injected styles everywhere the app runs.
- **The API image stays small,** and the docs make no third-party requests.
- **Nothing on the docs page talks to Scalar's services.**
- **The docs are at `/api/docs`,** next to the API they describe.

## Considered Options

- A separate page of the web app, built by Vite next to the app
- A lazily loaded route inside the single-page app
- Served by the API, through Scalar's Hono integration

## Decision Outcome

Chosen option: **a separate page of the web app.**

- **The page** is `apps/web/api/docs/index.html`, a second Vite build input, built to `dist/api/docs/index.html`. Its entry, `src/api-docs/main.ts`, mounts Scalar's Vue component. The app imports nothing from it.
- **Serving:** the web server serves it as a static file at `/api/docs/`, and redirects `/api/docs` there. Caddy's file server does both for a directory (increment 18). In development, the Vite dev server sends everything under `/api` to the API except `/api/docs`, and a small plugin adds the redirect.
- **Scalar's settings** (`src/api-docs/ApiDocs.vue`):
  - it loads `/api/v1/openapi.json`
  - default fonts are off, and the page sets the system font stacks, as the app does
  - the AI agent and developer tools are off
  - telemetry is off, which only matters if its analytics plugin is ever loaded
  - light or dark follows the app's saved theme, which `public/theme.js` applies before the first paint, instead of Scalar's own toggle
- **In increment 18,** `/api/docs/` gets its own CSP, which allows Scalar's two styles by hash, pinned by a test. The app's CSP keeps no exception.

### Consequences

- Good, because the app never loads Scalar's code, its global styles or its injected `<style>` elements, so its CSP can stay strict.
- Good, because the API image doesn't grow, and no third-party CDN is involved.
- Good, because Scalar owns its whole page. Its full-width layout doesn't have to fit inside the app's header and content width.
- Bad, because the two pages share a chunk of common libraries, and that chunk keeps the parts of Vue that Scalar uses: about 12 kB more gzipped JavaScript on the app's first load.
- Bad, because the docs page is large (about 476 kB of gzipped JavaScript). Only people who open it download it.
- Bad, because links from the app to the docs are full page loads.
- Bad, because the page reads the theme once, when it loads. A device switching between light and dark while it's open takes effect on the next load.
- Bad, because the CSP hashes for `/api/docs/` change whenever Scalar's injected styles do. The test increment 18 adds catches that on upgrade.

### Confirmation

- `apps/web/vite.config.test.ts` checks:
  - the dev server sends `/api/v1/*` and `/api/auth/*` to the API, serves the docs page at `/api/docs/`, and redirects `/api/docs` there
  - the build makes `api/docs/index.html`, and no file the app's page loads mentions Scalar
- `apps/web/src/api-docs/ApiDocs.test.ts` renders the page at a local address, where Scalar's defaults turn the most on. It checks:
  - there's one `<h1>`
  - there's no AI chat or developer tools, and no injected style refers to scalar.com
  - the page follows the app's light or dark theme
  - no request is made besides the document's

## Pros and Cons of the Options

### A separate page of the web app

- Good, because it isolates Scalar from the app completely, CSP included.
- Good, because Vite builds and serves it like the app, with no extra tooling.
- Bad, because it shares some library code with the app, and links to it reload the page.

### A lazily loaded route inside the single-page app

- Good, because it's one app: client-side navigation, and the app's header and theme menu.
- Bad, because the app-wide CSP would have to allow Scalar's injected styles on every page.
- Bad, because Scalar's global CSS, cascade layers, body class and storage key stay behind after leaving the docs.

### Served by the API, through Scalar's Hono integration

- Good, because the docs sit next to the routes they describe, with no web-server rule.
- Bad, because bundling Scalar adds about 370 MB to the API's production install, and loading it from a CDN is a third-party request.
