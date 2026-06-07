FROM golang:1.26-alpine AS builder

WORKDIR /app

# Install git and ca-certificates (use HTTP mirror — VPS has TLS issues with CDN)
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk add --no-cache git ca-certificates

# Copy go mod files + vendor (all deps vendored — no network needed for build)
COPY go.mod go.sum ./
COPY vendor/ ./vendor/

# Copy source code
COPY . .

# Build using vendored dependencies (no network)
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -a -installsuffix cgo -o main cmd/server/main.go

# Final stage
FROM alpine:3.23

RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk --no-cache add ca-certificates curl
WORKDIR /root/

# Copy the binary from builder stage
COPY --from=builder /app/main .
COPY --from=builder /app/.env .env
COPY --from=builder /app/migrations ./migrations

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run the binary
CMD ["./main"]
