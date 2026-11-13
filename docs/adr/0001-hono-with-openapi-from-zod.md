---
status: accepted
date: 2026-11-13
---

# Hono with OpenAPI generated from Zod

## Context and Problem Statement

myli needs a TypeScript backend that serves a REST API to the Vue frontend. The API has to be documented. Request and response shapes should be defined once and shared by validation, documentation and the frontend client, so the three can't drift apart. Which framework, and how should the API contract be produced?

## Decision Drivers

- **One source of truth** for validation, types, API docs and the frontend client.
- **Zod schemas shared** through `packages/shared`, so the frontend validates forms with the same schemas.
- **Easy integration testing** without starting an HTTP server.
- **Works well with Better Auth.**
- **Small and modern**, without heavy framework conventions to learn or maintain.
- **Free and permissively licensed.**

## Considered Options

- Hono + `@hono/zod-openapi`
- Fastify + `fastify-type-provider-zod` + `@fastify/swagger`
- NestJS + `@nestjs/swagger`
- Express + `@asteasolutions/zod-to-openapi`

## Decision Outcome

Chosen option: **Hono + `@hono/zod-openapi`**, running on Node LTS through `@hono/node-server`. Each route is declared with `createRoute` using Zod schemas. Those schemas drive request validation, the response types, and the generated OpenAPI 3.1 document.

**Contract pipeline**

1. Zod schemas live in `packages/shared` and are reused by API routes and frontend forms.
2. The API generates its OpenAPI 3.1 document from the route definitions and serves it at `/api/v1/openapi.json`.
3. Scalar renders interactive docs from that document at `/api/docs`.
4. `openapi-typescript` generates frontend types from the document. Requests go through `openapi-fetch`, so every call is type-checked against the contract.
5. The generated document is committed. CI regenerates it and fails if the committed copy is out of date.

**API conventions**
- Routes are versioned under `/api/v1`.
- Errors use RFC 9457 `application/problem+json`, built from a shared error schema.

### Consequences

- Good, because a schema change flows through validation, types, docs and the frontend client in one step, and CI catches anything that drifts.
- Good, because Hono uses standard `Request`/`Response`, so `app.request()` runs full integration tests in-process with no server or port.
- Good, because Better Auth's docs cover Hono directly, so the auth handler mounts with very little glue code.
- Good, because Hono is small, fast and has no runtime dependencies, which keeps the API image lean.
- Bad, because Hono's middleware ecosystem is smaller than Express's or Fastify's, so some things (e.g. specific rate-limit stores) may need small custom middleware.
- Bad, because `createRoute` definitions are more verbose than plain handlers. That's accepted as the cost of a documented contract.
- Bad, because the API depends on compatible versions of `zod` and `@hono/zod-openapi`, so both must be pinned and upgraded together.

### Confirmation

- CI fails when the committed OpenAPI document differs from the freshly generated one.
- The frontend type-checks (`vue-tsc`) against the generated client types, so contract changes break the build where they matter.
- Every route has integration tests written with `app.request()`.

## Pros and Cons of the Options

### Hono + `@hono/zod-openapi`

- Good, because the contract comes straight from Zod with first-party tooling.
- Good, because it uses standard Request/Response and tests run in-process.
- Good, because Better Auth documents it directly.
- Neutral, because it's younger than Express and Fastify, but widely used and actively maintained.
- Bad, because its middleware ecosystem is smaller.

### Fastify + `fastify-type-provider-zod` + `@fastify/swagger`

- Good, because it's mature, fast, and has a large plugin ecosystem.
- Good, because `inject()` also supports in-process testing.
- Neutral, because it would also have been a sound choice.
- Bad, because generating OpenAPI from Zod goes through a type provider plus a separate swagger plugin, with more parts to keep compatible.
- Bad, because its plugin and encapsulation model adds concepts that a small API doesn't need.

### NestJS + `@nestjs/swagger`

- Good, because its enterprise-style structure (modules, DI, decorators) is familiar to many teams.
- Bad, because its decorator- and class-based DTOs fit poorly with sharing Zod schemas. Bridges exist but are third-party.
- Bad, because it adds a lot of framework boilerplate for an app this size.

### Express + `@asteasolutions/zod-to-openapi`

- Good, because it has the largest ecosystem and is universally familiar.
- Bad, because the OpenAPI registry is maintained separately from the routes, so validation and docs can still drift.
- Bad, because there are no built-in types for requests and responses, and async error handling only arrived in Express 5.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §6, architecture summary
- Related: [ADR 0005](./0005-better-auth-instance-roles-and-invitations.md), Better Auth integration
