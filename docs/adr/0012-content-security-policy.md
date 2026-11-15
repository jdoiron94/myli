---
status: accepted
date: 2026-11-15
---

# A strict Content Security Policy, with inline styles allowed on the API docs page

Amends one point of [ADR 0011](./0011-api-docs-as-a-separate-page.md): how the API docs page's policy treats Scalar's styles. Everything else in ADR 0011 stands.

## Context and Problem Statement

Increment 18b puts Caddy in front of the app and the API, in the web image. The spec asks for a Content Security Policy and the other standard security headers. ADR 0011 planned two policies: a strict one for the app, and one for `/api/docs/` that allows Scalar's two injected `<style>` elements by hash.

Loading the built pages under a strict policy in Chromium and Firefox (2026-11-15) found:

- **Zod** tests whether it may compile schemas with `new Function`, by calling `Function('')` inside a `try`, the first time it parses an object. Without `'unsafe-eval'` the test fails safely, but the browser still reports a violation, on the app's pages and the docs page alike.
- **Scalar adds more styles than ADR 0011 expected:**
  - the two `<style>` elements: its theme, and its toast library's CSS
  - `style` attributes: each code block's line count, and two elements it measures the scrollbar with
  - a third `<style>` element once a request is sent from the page: CodeMirror's, which it builds up as editors mount, so its content depends on which editors have been open
- **Scalar's Open API Client button** opens client.scalar.com in a new tab. That page fetched the instance's OpenAPI document and loaded several analytics scripts. A CSP can't stop a new tab.

What should each response's policy and headers be?

## Decision Drivers

- **Injected markup can't run a script** anywhere on the site.
- **The app's pages have no exceptions:** nothing inline, no eval.
- **The docs page works fully,** sending requests included, and contacts no other site.
- **Upgrading a dependency doesn't mean editing the policy,** as long as the dependency doesn't start using eval or inline scripts.

## Considered Options

For the docs page's styles, the only open question:

- Allow inline styles on the docs page
- Hashes for Scalar's styles, as ADR 0011 planned
- Nonces

## Decision Outcome

Chosen option: **allow inline styles on the docs page**, with everything else as strict as on the app's pages.

**The policies,** in `apps/web/Caddyfile`:

- **The app's pages:** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
- **`/api/docs/`:** the same, except `style-src 'self' 'unsafe-inline'`.
- **The API's answers** (the rest of `/api`, Better Auth's routes included): `default-src 'none'; frame-ancestors 'none'`. They're JSON, never pages.

**In the web app:**

- Each page's entry first imports `src/zod-jitless.ts`, which sets `z.config({ jitless: true })`, so Zod never tries `new Function`. Scalar uses the same copy of Zod.
- `hideClientButton: true` in `src/api-docs/ApiDocs.vue` removes the Open API Client button.

**The other headers,** on every response:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: same-origin`, so links to other sites, such as a recipe's source, don't send them this instance's address
- `Cross-Origin-Opener-Policy: same-origin`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(), screen-wake-lock=(self)`
- HSTS and `upgrade-insecure-requests` come with HTTPS in increment 18c.

**Caching:** files under `/assets` have a content hash in their names, so browsers keep them for a year (`immutable`). Pages and `theme.js` are `no-cache`, so a new release shows on the next load. A missing file under `/assets` is a 404 with no caching header, since it may exist after a deploy.

### Consequences

- Good, because no page runs inline scripts or eval, and the app's pages allow nothing inline at all.
- Good, because the docs page's policy doesn't change when Scalar's styles do. There are no hashes to update on upgrade.
- Good, because Zod never attempts eval in the browser. It parses the same way, a little more slowly, which doesn't matter for forms and API answers of this size.
- Bad, because injected markup could style the docs page. It still couldn't load anything from another site, which CSS-based data theft relies on: images, fonts and connections are limited to `'self'`. The page shows only the API's own document.
- Bad, because a dependency that starts injecting styles or using eval on the app's pages only shows up in the end-to-end tests against the images, not in `pnpm test`.

### Confirmation

- **Any CSP violation fails an end-to-end test** (`e2e/tests/fixtures.ts`). Against the images (`pnpm test:containers`):
  - the journey reaches every page and dialog it covers under the app's policy
  - `api-docs.spec.ts` loads the docs page and sends a request under its policy, checking that nothing goes to another site
- **`e2e/tests/web-server.spec.ts`** checks each kind of response's policy: no `'unsafe-'` source on the app's pages, and only `'unsafe-inline'` for styles on the docs page. It also checks the other headers, the caching and the routing.
- **`src/api-docs/ApiDocs.test.ts`** checks that there's no Open API Client button.

## Pros and Cons of the Options

### Allow inline styles on the docs page

- Good, because it covers everything Scalar does, now and after upgrades.
- Good, because scripts stay as strict as on the app's pages.
- Bad, because injected markup could style the docs page (see Consequences).

### Hashes for Scalar's styles

- Good, because only Scalar's known styles could apply.
- Bad, because no fixed list of hashes covers CodeMirror's `<style>` element, whose content depends on which editors have been open. A blocked one leaves the response viewer unstyled.
- Bad, because hashes only cover `style` attributes with `'unsafe-hashes'` and one hash per value, and the line counts vary.
- Bad, because any Scalar upgrade could change the hashes.

### Nonces

- Good, because only styles carrying the response's nonce would apply.
- Bad, because Caddy would have to put a new nonce into every response of a static page, and Scalar would have to pass it on to CodeMirror and its toast library, which it has no setting for.
- Bad, because nonces don't cover `style` attributes either.
