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

# Video uploads transcode on the server, and the handler shell-outs to
# `ffprobe`/`ffmpeg` by bare name (resolved via PATH). When this launcher runs
# outside a normal login shell (launchd, cron, IDE task, CI) the PATH can be a
# bare /usr/bin:/bin that omits Homebrew's bin, so the server would fail every
# video upload with "Failed to process video". Prepend the Homebrew bin dir so
# the binaries are always visible regardless of how the server was started.
for _brew in /opt/homebrew/bin /usr/local/bin; do
  if [ -x "$_brew/ffmpeg" ] && [ -x "$_brew/ffprobe" ]; then
    case ":$PATH:" in
      *":$_brew:"*) : ;;              # already on PATH
      *) PATH="$_brew:$PATH" ; export PATH ;;  # keep existing PATH intact
    esac
    break
  fi
done

exec /tmp/gomo6-server-new
