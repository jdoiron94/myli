# The web server: Caddy with the built app and API docs page, sending /api to the API. Build from
# the repo root:
#   docker build -f apps/web/Dockerfile -t myli-web .
#
# It needs PUBLIC_URL, the address people open myli at, like https://myli.home.arpa: the same as
# the API's. It serves HTTPS there, with certificates from Caddy's own local CA (ADR 0013), on port
# 443 (TCP, and UDP for HTTP/3) unless PUBLIC_URL names another, and redirects port 80 to it.
# Mount a volume at /data: the CA lives there, and devices trust its root.
#
# The API's address is API_UPSTREAM (host:port), `api:3000` unless set.

# Node, at the version in .node-version, on Debian 13, pinned to one build. It only builds the static
# files, so it runs on the build machine's platform, whatever platform the image is for.
ARG NODE_IMAGE=node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
# Caddy 2.11.9 on Alpine, pinned to one build.
ARG CADDY_IMAGE=caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
# The pnpm version package.json pins in `packageManager`.
RUN npm install --global pnpm@12.18.0
WORKDIR /app
# Every workspace manifest, so the lockfile matches the workspace, then what the web app's build
# needs, dev dependencies included.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/root/.cache/pnpm-store \
    pnpm install --frozen-lockfile --filter @myli/web... --store-dir /root/.cache/pnpm-store
# The TypeScript settings Vite reads, the shared package's source, and the web app.
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/web apps/web
RUN pnpm --filter @myli/web build

FROM ${CADDY_IMAGE}
# Shown on the image's page in GHCR, which `source` links to the repository. They replace each of
# the Caddy image's own, which describe Caddy. The image's tag is its version.
LABEL org.opencontainers.image.title="myli web" \
      org.opencontainers.image.description="The web app of myli, a self-hosted recipe app, served over HTTPS by Caddy" \
      org.opencontainers.image.source="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.url="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.documentation="https://github.com/jdoiron94/myli" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.vendor="" \
      org.opencontainers.image.version=""
# Caddy runs as an unprivileged user (uid 1000), which owns its data (certificates) and config
# directories. It can still listen on ports 80 and 443: since Docker 20.10, any user in a
# container can (net.ipv4.ip_unprivileged_port_start=0), except with host networking.
RUN addgroup -S -g 1000 caddy \
 && adduser -S -D -H -u 1000 -G caddy -h /data caddy \
 && chown -R caddy:caddy /data /config
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
# Fails the build if the Caddyfile is invalid. Validating also creates the local CA, so it uses
# storage that's thrown away: the image must never hold a CA, or every installation would share
# its key. Each one creates its own in /data on first start.
RUN PUBLIC_URL=https://myli.example XDG_DATA_HOME=/tmp/validate XDG_CONFIG_HOME=/tmp/validate \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
 && rm -rf /tmp/validate
COPY --chmod=755 apps/web/docker-entrypoint.sh /usr/local/bin/
COPY --from=build /app/apps/web/dist /srv
USER caddy

# Liveness only: Caddy answers on its own healthcheck address while it runs. Checked every second
# while starting, so Compose sees it healthy as soon as it is.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2020/healthz"]

# Checks PUBLIC_URL, then runs the CMD in its place, so Caddy gets Docker's stop signal and
# finishes open requests.
ENTRYPOINT ["docker-entrypoint.sh"]
# The base image's CMD, which setting ENTRYPOINT clears.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
