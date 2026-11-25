---
status: accepted
date: 2026-11-25
---

# A public link carries its token in the path

## Context and Problem Statement

A public link lets anyone see a shared recipe as it's published, without signing in (spec §2). It needs a secret, an unguessable token, since anyone who has the link can open it.

myli's rule for a secret in a link (CLAUDE.md, Web app) is to put it in the fragment, `#…`, which browsers never send to a server. The page reads it, sends it only in a request body, and takes it out of the address. Invitations work that way. It keeps the token out of every server's logs and every Referer header.

A public link's page shows the recipe's photos, though. A photo is an `<img>`, which the browser fetches by its address. It sends no body and no header of ours, and the public visitor has no session cookie. So the API has to tell from the photo's address alone that the visitor may have it.

Where should a public link's token go?

## Decision Drivers

- **The token stays out of logs and other sites.** It's a lasting secret: whoever finds it can open the recipe until it's revoked.
- **Photos keep working as they do elsewhere:** sizes for `srcset`, and browsers keeping each one for good.
- **The CSP stays as strict as it is** (ADR 0012).
- **The link is easy to share:** it's meant to be pasted into a chat or an email.

## Considered Options

- The token in the path, `PUBLIC_URL/p/<token>`, and in the API's paths for the recipe and its photos
- The token in the fragment, with the page fetching each photo through `fetch` and showing it from a `blob:` URL
- The token in the fragment, with the recipe's answer giving each photo a short-lived address of its own, signed by the API

## Decision Outcome

Chosen option: **the token in the path.**

- The page is `PUBLIC_URL/p/<token>`. The API answers `GET /api/v1/public/recipes/{token}` and `GET /api/v1/public/recipes/{token}/images/{id}/{width}`, for anyone.
- The API's request log writes `/api/v1/public/recipes/{token}` in place of the token (`request-logging.ts`). Caddy keeps no access log. Its `Referrer-Policy: same-origin` keeps the page's address from every other site, a recipe's source included.
- The token is 256 random bits. It's stored as it is, so whoever may share the recipe can copy the link again. The audit log records each link created and revoked, never its token.
- Only photos the recipe uses as published are served this way, not ones only its older revisions or its draft use.

### Consequences

- Good, because photos are plain `<img>` elements, with `srcset` and the browser's cache, as on every other page.
- Good, because the CSP doesn't change: no `blob:` images.
- Good, because the link is an ordinary address, which opens in any browser and survives being copied around.
- Bad, because the token reaches the server, and the browser keeps it in its history. Our own server is where the page and the API are anyway: we keep it out of what's logged. The history is the visitor's own. They were given the link to keep.
- Bad, because a proxy in front of Caddy, set up by someone running myli, could log paths. The README asks them to keep it from logging these.
- Neutral: invitations keep their token in the fragment. An invitation is used once, by one person, and creates an account. A public link is for anyone it's given to, until it's revoked.

### Confirmation

The public link's API tests check that the request log never holds the token and writes `{token}` in its place, that the audit log never holds it, and that photos only an older revision uses aren't served. The journey opens a link in a browser that isn't signed in, its photos included, under the app's CSP.

## Pros and Cons of the Options

### The token in the path

- Good, because photos, sizes and caching work as everywhere else.
- Good, because the CSP stays as it is.
- Bad, because the token reaches the server, which has to keep it out of what it logs.

### The token in the fragment, photos as `blob:` URLs

- Good, because the token never reaches a server in an address.
- Bad, because the page fetches every size of every photo itself, or gives up `srcset`, and the browser's cache no longer applies.
- Bad, because the CSP has to allow `blob:` images.

### The token in the fragment, signed photo addresses

- Good, because the token stays in the fragment, and photos are plain `<img>` elements.
- Bad, because the photos' addresses then change every time, so browsers can't keep them, and each signature expires while the page is open.
- Bad, because it adds a signing key to manage, for photos of recipes that anyone with the link may see anyway.
