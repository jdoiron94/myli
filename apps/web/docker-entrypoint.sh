#!/bin/sh
# Checks PUBLIC_URL before Caddy starts (apps/web/Dockerfile), because Caddy's own handling of a
# bad site address is cryptic or silent: unset, it complains about global options, and with a path
# it serves only that path.
set -eu

fail() {
  echo "PUBLIC_URL $1. Set it to the address people open myli at, like https://myli.home.arpa: the same as the API's." >&2
  exit 1
}

# The API accepts one trailing slash, so the same value works here. To Caddy, it would be a path.
PUBLIC_URL="${PUBLIC_URL:-}"
PUBLIC_URL="${PUBLIC_URL%/}"
case "$PUBLIC_URL" in
  "") fail "is not set" ;;
  https://*/* | https://*\?* | https://*#*) fail "must be an origin only, without a path" ;;
  https://?*) ;;
  *) fail "must start with https://" ;;
esac
export PUBLIC_URL

exec "$@"
