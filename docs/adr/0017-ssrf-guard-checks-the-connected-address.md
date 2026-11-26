---
status: accepted
date: 2026-11-26
---

# The SSRF guard checks the address it connects to, on Node's own HTTP client

## Context and Problem Statement

URL import (spec §3.7) has the API fetch a page whose address someone typed, and then the recipe's photo that page names. The API runs inside the household's network, next to Meilisearch, the router's admin page and whatever else is on the LAN. A request it makes on someone's behalf must never reach any of those: that's server-side request forgery (SSRF).

Checking the address someone typed isn't enough. A public name can resolve to a private address. A name can resolve to a public address when it's checked and to a private one when it's connected to (DNS rebinding). A public page can redirect to a private address.

How should outbound requests be kept to public addresses?

## Decision Drivers

- **No request reaches a private address,** whether it's typed, resolved, re-resolved or redirected to.
- **No new service to run,** and preferably no new dependency.
- **Testable** without the internet: the tests can't count on reaching it, and CI can't either.

## Considered Options

- Node's `http` and `https` modules, with a `lookup` function that checks every address it hands over to connect to
- Node's `fetch`, with an undici dispatcher whose connect step checks the address
- Resolve the name and check the result, then fetch the URL
- A library that wraps an HTTP agent the same way, such as `request-filtering-agent`
- An egress proxy that filters requests, such as Smokescreen

## Decision Outcome

Chosen option: **Node's `http` and `https`, with a checking `lookup`,** in `apps/api/src/outbound/`.

- `isPublicAddress()` refuses the special-purpose ranges: private, loopback, link-local (the cloud metadata address included), shared (CGNAT), documentation, benchmarking, multicast and reserved IPv4, and their IPv6 counterparts. That includes unique local addresses, IPv4 written as IPv6 and the ranges that tunnel IPv4 (6to4, Teredo, NAT64). An IPv4 address is checked only against IPv4 ranges, and an IPv6 one only against IPv6 ranges: Node's `BlockList` matches IPv4 addresses against IPv6 ranges as IPv4-mapped ones otherwise.
- The `lookup` passed to each request resolves the name and refuses it if any address it gives isn't public. Node connects only to an address that `lookup` handed over, so what's checked is what's connected to. A host that's an IP address skips `lookup`, so it's checked before the request.
- Redirects are followed by hand, up to 5. Each new URL goes through the same checks.
- Responses are read up to a limit, counted after decompression, and the whole fetch, redirects included, has one timeout. No cookies or credentials are sent.
- Tests pass their own address check, so a server on the loopback address can stand in for a public site. Nothing else does.

### Consequences

- Good, because DNS rebinding can't get past it: there's no gap between the check and the connection.
- Good, because it needs no dependency and no service.
- Bad, because `http` doesn't decompress or follow redirects: the guard does both itself.
- Bad, because it ignores `HTTPS_PROXY`. An instance that can only reach the internet through a proxy can't import. That can be added if someone needs it.
- Neutral: requests use HTTP/1.1, which every recipe site serves.

### Confirmation

`addresses.test.ts` checks a table of addresses, allowed and refused, IPv4-mapped and tunnelled ones included. `fetch.test.ts` runs a local server and checks that a refused address is never connected to, whether it's typed, resolved or redirected to, and the redirect, size and time limits. The journey checks that importing from a loopback address is refused at the address field.

## Pros and Cons of the Options

### Node's `http` and `https`, with a checking `lookup`

- Good, because the address checked is the address connected to.
- Good, because it's part of Node.
- Bad, because redirects and decompression are ours to handle.

### Node's `fetch`, with an undici dispatcher

- Good, because `fetch` decompresses, and a dispatcher's connect step sees the address too.
- Bad, because Node doesn't export the undici it bundles: building a dispatcher takes the `undici` package, a second copy whose version has to match Node's.
- Bad, because redirects still have to be followed by hand to check each one.

### Resolve, check, then fetch

- Good, because it's the simplest to write.
- Bad, because the name is resolved again to connect, and it can resolve elsewhere then (DNS rebinding).

### A library around an HTTP agent

- Good, because someone else maintains the address list.
- Bad, because it's a dependency for about 40 lines, and the lists differ from one library to the next, so we'd still have to check what it refuses.

### An egress proxy

- Good, because it can guard every outbound request, whatever makes it.
- Bad, because it's another service to run and configure, for one feature of a household app.
