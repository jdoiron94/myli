---
status: accepted
date: 2026-11-14
---

# Run the API's TypeScript directly on Node, without a build step

## Context and Problem Statement

The API and `packages/shared` are written in TypeScript, and Node can only run them once the types are removed. That can be done by a compiler, a loader, a bundler, or by Node itself: Node 26, which the repo pins, strips types natively by default. How should the API run in development and production, and how should workspace packages reach it?

## Decision Drivers

- **Few moving parts** between the source and the running process.
- **One execution path** for development, tests and production.
- **Readable production stack traces.**
- **Workspace packages** (`@myli/shared`) usable by both the API (Node) and the web app (Vite) without building them first.
- **A simple Docker image.**

## Considered Options

- Node's built-in type stripping
- tsx (esbuild-based loader)
- Bundle for production with tsdown
- Compile with `tsc` to `dist/`

## Decision Outcome

Chosen option: **Node's built-in type stripping.** Production runs `node src/main.ts` and development runs `node --watch src/main.ts`. There is no build step and no `dist/`.

**Rules that make it work,** all set in `tsconfig.base.json`
- `erasableSyntaxOnly`: no enums, namespaces, parameter properties or other syntax that needs code generation.
- `verbatimModuleSyntax`: type-only imports are written `import type`, so stripping never leaves an import of something that doesn't exist at runtime.
- `allowImportingTsExtensions`: relative imports end in `.ts`, because Node resolves files exactly as written.
- `noEmit`: `tsc` only type-checks.

**Workspace packages**
- `@myli/shared` points its `exports` at its `.ts` source. Node and Vite both consume it directly.
- Node refuses to strip types from files whose path is inside `node_modules`. pnpm links workspace packages with symlinks, and Node resolves them to their real path under `packages/`, which is outside `node_modules`, so this works.
- The API's Docker image must keep that layout. It can't use `pnpm deploy`, injected workspace packages or `--preserve-symlinks`, because each of those puts the source under a `node_modules` path.

### Consequences

- Good, because there's no build tool, build config or output directory to maintain, and production runs exactly the source in the repo.
- Good, because type stripping replaces types with whitespace, so stack-trace line and column numbers match the source without source maps.
- Good, because development, tests and production execute the same files the same way.
- Good, because a change in `shared` reaches the API and the web app immediately, with no package build in between.
- Bad, because some TypeScript syntax is off limits: enums, namespaces, parameter properties and decorators. Unions and `as const` objects replace enums, which suits Zod anyway.
- Bad, because `tsconfig` `paths` aliases don't work at runtime. Imports are relative, or use `package.json` `imports` (`#…`) if aliases are ever needed.
- Bad, because the Docker image has to preserve the pnpm workspace layout instead of using `pnpm deploy`.
- Bad, because the API is tied to what Node's type stripping supports. New TypeScript syntax can only be used once Node can strip it.

### Confirmation

- `pnpm typecheck` rejects code Node can't run, through the `tsconfig.base.json` options above.
- `apps/api/src/main.test.ts` starts the real entry point under plain Node, without Vitest's transform.
- `apps/api/src/workspace.test.ts` imports `@myli/shared` under plain Node. It fails if the package ever resolves to a path inside `node_modules`.
- The API image runs `node src/main.ts`, and its healthcheck shows the image layout works.

## Pros and Cons of the Options

### Node's built-in type stripping

- Good, because it needs no dependency and no build step.
- Good, because stack traces match the source without source maps.
- Bad, because only erasable syntax is allowed, and files under `node_modules` aren't stripped.

### tsx (esbuild-based loader)

- Good, because it supports all TypeScript syntax and `tsconfig` paths, including files under `node_modules`.
- Bad, because production either ships esbuild as a runtime loader, or runs differently from development.
- Bad, because it duplicates what Node now does natively.

### Bundle for production with tsdown

- Good, because the image gets one JavaScript file with workspace packages inlined, so its layout is trivial.
- Bad, because it adds a build step, bundler config and source maps, and production runs different code from development.
- Bad, because native and dynamically loaded dependencies, such as better-sqlite3 and pino's worker-thread transports, must be kept external. That's a common source of bundling bugs.

### Compile with `tsc` to `dist/`

- Good, because it's the most conventional setup.
- Bad, because every workspace package has to be built before the API starts, and development needs compilers running in watch mode.
- Bad, because `.ts` import specifiers have to be rewritten on emit, and a stale `dist/` causes confusing bugs.

## More Information

- Node.js documentation: [Modules: TypeScript](https://nodejs.org/api/typescript.html)
- Related: [ADR 0001](./0001-hono-with-openapi-from-zod.md), Hono running on Node
