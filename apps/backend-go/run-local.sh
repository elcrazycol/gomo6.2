#!/bin/sh
# Local dev backend launcher.
# Loads .env.local (dev secrets) then .env (defaults) into the environment and
# execs the server binary — the same env the developer gets when running
# `go run cmd/server/main.go` from apps/backend-go with .env.local sourced.
#
# DATABASE_URL/REDIS_URL are forced to 127.0.0.1: on macOS `localhost` resolves
# to ::1 first, and a native Postgres may be listening there with a different
# schema — the dev stack (gomo6-dev-pg / gomo6-dev-redis) binds 127.0.0.1.
cd "$(dirname "$0")"

set -a
[ -f .env.local ] && . ./.env.local
[ -f .env ] && . ./.env
set +a

export DATABASE_URL="postgres://gomo6:gomo6password@127.0.0.1:5432/gomo6?sslmode=disable"
export REDIS_URL="redis://127.0.0.1:6379"

exec /tmp/gomo6-server-new
