# The API, with the job worker inside it. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t myli-api .
#
# Node runs the TypeScript source as it is (ADR 0008), so nothing is compiled. The image keeps
# pnpm's workspace layout instead of using `pnpm deploy`: Node only strips types from files outside
# node_modules, and @myli/shared is a symlink to packages/shared.

# Node, at the version in .node-version, on Debian 13, pinned to one build. better-sqlite3 ships
# prebuilt binaries for glibc on x64 and arm64, so no compiler is needed.
ARG NODE_IMAGE=node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

FROM ${NODE_IMAGE} AS dependencies
# The pnpm version package.json pins in `packageManager`.
RUN npm install --global pnpm@12.18.0
WORKDIR /app
# Every workspace manifest, so the lockfile matches the workspace, then only the API's production
# dependencies, @myli/shared included.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.cache/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @myli/api... --store-dir /root/.cache/pnpm-store

FROM ${NODE_IMAGE}
# Shown on the image's page in GHCR, which `source` links to the repository.
LABEL org.opencontainers.image.title="myli API" \
      org.opencontainers.image.description="The API of myli, a self-hosted recipe app" \
      org.opencontainers.image.source="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.url="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.documentation="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/myli.db \
    BLOB_DIR=/data/blobs \
    BACKUP_DIR=/backups
WORKDIR /app
# The installed packages (symlinks into node_modules/.pnpm, kept as symlinks), then the source.
COPY --from=dependencies /app/node_modules node_modules
COPY --from=dependencies /app/apps/api/node_modules apps/api/node_modules
COPY --from=dependencies /app/packages/shared/node_modules packages/shared/node_modules
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/src apps/api/src

# The database lives on a volume at /data, and backups on another at /backups. The image's node
# user (uid 1000) owns both, and a new named volume takes that owner. A host directory mounted on
# either must be writable by uid 1000.
RUN mkdir /data /backups && chown node:node /data /backups
USER node
WORKDIR /app/apps/api
EXPOSE 3000

# Liveness only: /healthz answers while the process can serve HTTP. Checked every second while
# starting, so Compose sees it healthy as soon as it is.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]

# main.ts handles SIGTERM itself (it finishes in-flight requests and the running job), so it can
# run as PID 1.
CMD ["node", "src/main.ts"]
