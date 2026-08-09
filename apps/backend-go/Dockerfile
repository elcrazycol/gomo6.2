# syntax=docker/dockerfile:1
# =============================================================================
# Backend — fast multi-arch build.
#
# The builder stage runs on the runner's NATIVE arch (`--platform=$BUILDPLATFORM`,
# i.e. arm64 on the M1 Mac), so the Go compiler is never emulated. The binary
# is simply cross-compiled for the VPS arch (GOOS/GOARCH are injected by
# BuildKit from `--platform linux/amd64`) — instant for pure-Go with CGO=0.
# Only the thin final stage (apk + COPY) runs under emulation, and BuildKit
# caches it after the first build.
#
# Caches that survive between builds on the runner's disk:
#   - /root/.cache/go-build — Go build cache: warm rebuilds take seconds
#   - /go/pkg/mod           — swag's module downloads (network only on 1st build)
# =============================================================================

# ---- Build stage: native arch on the runner --------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

WORKDIR /app

# BuildKit sets these automatically from --platform; used for cross-compilation.
ARG TARGETOS
ARG TARGETARCH

# HTTP mirror (fast apk everywhere) + git for go's vcs stamping.
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk add --no-cache git ca-certificates

# Vendored dependencies first — maximal layer caching.
COPY go.mod go.sum ./
COPY vendor/ ./vendor/

COPY . .

# Regenerate swagger docs. The swag binary is pinned to the version in go.mod
# and stays cached in the Go build cache after the first build.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go install github.com/swaggo/swag/cmd/swag@v1.16.4 && \
    swag init -g cmd/server/main.go -o docs/ --parseInternal

# Cross-compile for the VPS. Note: -trimpath, NOT -a — -a would recompile the
# whole stdlib on every push and destroy the cache. GOMEMLIMIT guards the
# low-RAM VPS during compilation. -ldflags="-s -w" strips debug info: the
# binary shrinks ~30MB → ~22MB, so the changed layer that travels to the VPS
# (and to the registry) is smaller. Panic stack traces still work (pclntab is
# kept); only dlv/profiling symbol info is dropped.
ENV CGO_ENABLED=0 GOMEMLIMIT=256MiB
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -mod=vendor -trimpath -ldflags="-s -w" -o main cmd/server/main.go

# ---- Runtime stage: VPS arch ------------------------------------------------
FROM --platform=$TARGETPLATFORM alpine:3.23

RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk --no-cache add ca-certificates curl
WORKDIR /root/

COPY --from=builder /app/main .
COPY --from=builder /app/.env .env
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/migrations ./migrations

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["./main"]
