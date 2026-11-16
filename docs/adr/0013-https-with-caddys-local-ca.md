---
status: accepted
date: 2026-11-16
---

# HTTPS with Caddy's local certificate authority

## Context and Problem Statement

myli runs on a household's own server and is opened on its LAN, often from phones. Cook mode keeps the screen awake with the Screen Wake Lock API, which browsers allow only in a secure context: HTTPS, or `localhost`. So the web server has to serve HTTPS at whatever address the household uses, such as `myli.home.arpa` or the server's IP address. The address may not be in public DNS, and the server may not be reachable from the internet. The host gives myli ports 80 and 443.

Where do the certificates come from?

## Decision Drivers

- **Works on a LAN** with no public domain and no inbound traffic from the internet.
- **No third-party account,** API token or plugin to set up.
- **No manual renewals.**
- **Little to configure:** ideally only the address, which the API already needs (`PUBLIC_URL`).

## Considered Options

- Caddy's local CA (`tls internal`)
- Let's Encrypt with an HTTP or TLS-ALPN challenge
- Let's Encrypt with a DNS challenge
- A certificate the operator brings
- mkcert on the operator's computer

## Decision Outcome

Chosen option: **Caddy's local CA.** It's the only option that works on any LAN with nothing outside the stack.

**In the web image** (`apps/web/Caddyfile`, `apps/web/Dockerfile`):

- **The site address is `PUBLIC_URL`,** the variable the API reads, so the two can't disagree. Port 443 serves HTTPS, unless `PUBLIC_URL` names another port, and port 80 only redirects to it, keeping the path and query.
- **`docker-entrypoint.sh` checks `PUBLIC_URL`** before Caddy starts: it must be an `https://` origin. Caddy's own errors are cryptic when it's unset. A path would quietly limit the site to that path. The script strips one trailing slash, which the API accepts.
- **`tls internal`:** Caddy creates a root and an intermediate certificate in `/data` on first start, and issues the server's certificate from them. It renews them on its own: the server certificate lasts 12 hours, the intermediate 7 days, and the root 10 years. `/data` must be a volume, so the root survives new containers.
- **The image never holds a CA.** `caddy validate` creates one, so the build validates against throwaway storage. Otherwise, every installation would share the root's private key.
- **`skip_install_trust`:** Caddy doesn't try to add the root to the container's own trust store.
- **HSTS** (`Strict-Transport-Security: max-age=31536000`) on every HTTPS response:
  - It doesn't include subdomains, since other services on the household's domain may have no HTTPS.
  - It isn't preloaded, since the names are private.
- **`upgrade-insecure-requests`** in both Content Security Policies (ADR 0012).
- **HTTP/2 and HTTP/3,** Caddy's defaults over HTTPS. HTTP/3 needs the HTTPS port published for UDP too.

**On each device,** the household trusts the root certificate once. The README explains how, with the stack's setup in increment 18f.

### Consequences

- Good, because it works offline, on any name or IP address, with no account or token, and renews itself.
- Good, because one variable configures the API and the web server.
- Bad, because each device has to trust the root before myli works without warnings and cook mode can keep the screen on. Phones make that a few steps in their settings.
- Bad, because a device that trusts the root trusts it for every name, not only myli's. Whoever has the root's key, in the `/data` volume, could impersonate any site to those devices. The volume needs the same care as the server's other secrets.
- Bad, because losing the `/data` volume means a new root, which every device has to trust again. Until then, browsers that saw HSTS won't let anyone click past the warning. Back up the volume.
- Neutral, because browsers ignore HSTS from a certificate they don't trust, so it only takes effect once a device trusts the root.

### Confirmation

`e2e/tests/web-server.spec.ts`, against the images (`pnpm test:containers`), checks:

- the certificate comes from Caddy's local CA, over HTTP/2
- HTTP redirects to HTTPS, keeping the path and query
- HSTS and HTTP/3's `Alt-Svc` header are on every response, and `upgrade-insecure-requests` is in both policies
- the image holds no CA and no private key
- the image refuses a missing or invalid `PUBLIC_URL`, and says why
- the configuration Caddy would run (`caddy adapt`), with and without a trailing slash, serves the whole site and uses the local CA even for a public name

## Pros and Cons of the Options

### Caddy's local CA

- Good, because it needs nothing outside the stack.
- Bad, because every device has to trust its root, and that trust isn't limited to myli's name.

### Let's Encrypt with an HTTP or TLS-ALPN challenge

- Good, because browsers trust the certificates with no setup on any device.
- Bad, because it needs a public DNS name pointing at the server, and ports 80 or 443 open to the internet. That exposes a household app that has no reason to be public.

### Let's Encrypt with a DNS challenge

- Good, because browsers trust the certificates, and the server stays private.
- Bad, because it needs a domain at a DNS provider Caddy has a plugin for, a custom Caddy build with that plugin, and an API token for the provider in the stack. That's a different image for each provider.

### A certificate the operator brings

- Good, because it fits households that already run their own CA or have a wildcard certificate.
- Bad, because renewals are manual, and a missed one takes myli down. Few households have such a certificate.

### mkcert on the operator's computer

- Good, because it's a familiar tool for local HTTPS.
- Bad, because every device still has to trust its root, as with Caddy's. On top of that, the certificate has to be copied into the stack and renewed by hand.
