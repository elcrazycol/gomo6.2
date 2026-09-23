# Self-hosted Codeberg Actions runner (the project Mac)

The **project Mac is the CI/CD runner**. All workflows in `.forgejo/workflows/`
run on it (host mode); the VPS never builds anything — it only pulls images
from the Codeberg registry and restarts containers. This file is the
"how do I turn the Mac back into the build machine" cheat-sheet.

## What it is

| Thing | Where |
|---|---|
| Runner binary | `~/bin/forgejo-runner` (native arm64) |
| Runner config | `~/forgejo-runner/.forgejo-runner.yaml` |
| Go caches (persist between jobs) | `~/.cache/gomo6-ci/{gocache,gomodcache}` |
| Codeberg project | `codeberg.org/crazycol/gomo6.2` |

The config registers the runner against `https://codeberg.org` via
`server.connections.codeberg` (uuid + token — no `.runner` file needed) and
advertises the labels `self-hosted`, `macos`, `arm64`, `macos-arm64` (all
`:host`). `capacity: 4` lets the four build matrix jobs (backend / web / docs /
dev-dashboard) run in parallel. Timeouts are set to 3h.

## Start it

**1. Start Docker Desktop first.** The build jobs use `docker buildx`; without a
running daemon every job fails with `failed to connect to the docker API`.

```bash
docker info >/dev/null && echo "docker: UP"
```

**2. Start the runner daemon:**

```bash
cd ~/forgejo-runner && ~/bin/forgejo-runner daemon --config .forgejo-runner.yaml
```

There is **no launchd agent** — it has always been started by hand in a
terminal. To keep it alive after closing the window, run it inside `tmux` or
with `nohup`:

```bash
tmux new -s runner   # then run the command above inside
# or:
cd ~/forgejo-runner && nohup ~/bin/forgejo-runner daemon --config .forgejo-runner.yaml >/tmp/forgejo-runner.log 2>&1 &
```

## Verify

```bash
ps aux | grep forgejo-runner | grep -v grep   # daemon alive?
docker info >/dev/null && echo "docker: UP"   # builds can run?
```

## Prerequisites

- **Docker Desktop** (running) — needed for `docker buildx build --push`.
- **Go 1.26+** and **Node 22+** installed **system-wide** — that is why
  `coverage.yml` skips `setup-go` / `setup-node`.
- `ffmpeg` / `ffprobe` for video uploads in e2e/local dev.

## If the runner does not pick up jobs

The registration token in the config can go stale (there is a TODO next to it).
Create a fresh runner token in Codeberg → repo Settings → Actions → Runners →
**Create new runner**, then re-register:

```bash
~/bin/forgejo-runner register --instance https://codeberg.org \
  --token <FRESH_TOKEN> --name mac-m1-host \
  --labels "self-hosted:host,macos:host,arm64:host,macos-arm64:host" --no-interactive
```

## What runs here

- `deploy.yml` — push to `main` / manual: change detection via the Codeberg
  compare API → incremental checkout into `$HOME/gomo6-src` → buildx build &
  push to `codeberg.org/crazycol/gomo6-*` → per-service pull + restart on the VPS.
- `coverage.yml` — PR (incremental) and `main` (full Go + TS coverage → badges
  → Codeberg Pages).
- `mirror.yml` — mirrors the repo to GitHub / GitLab.

## Trivia

`~/forgejo-runner/.forgejo-runner.yaml` reads its connection token from the
config file; treat it like a secret. The VPS repo lives at `/root/gomo6.2` (or
`/home/*/gomo6.2`) and tracks the **public HTTPS** Codeberg origin, so no git
credentials are needed on the server.
