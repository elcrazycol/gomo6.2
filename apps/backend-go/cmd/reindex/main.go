// Command reindex rebuilds the Meilisearch indexes from PostgreSQL.
//
// It is the recovery/backfill path for the best-effort write-path sync: run it
// once after enabling the engine, and again whenever the index is suspected to
// have drifted (restored database, dropped events, schema change).
//
// Usage:
//
//	DATABASE_URL=... MEILISEARCH_URL=http://127.0.0.1:7700 \
//	  MEILI_MASTER_KEY=... go run ./cmd/reindex
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"github.com/gomo6/backend/internal/search"
)

func main() {
	timeout := flag.Duration("timeout", 10*time.Minute, "overall timeout")
	flag.Parse()

	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is not set")
		os.Exit(2)
	}

	svc := search.New(search.Config{
		URL:         os.Getenv("MEILISEARCH_URL"),
		MasterKey:   os.Getenv("MEILI_MASTER_KEY"),
		IndexPrefix: os.Getenv("MEILISEARCH_INDEX_PREFIX"),
	})
	if !svc.Enabled() {
		fmt.Fprintln(os.Stderr, "MEILISEARCH_URL is not set — nothing to reindex")
		os.Exit(2)
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db: %v\n", err)
		os.Exit(2)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "ping db: %v\n", err)
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	if err := svc.Health(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "meilisearch is not reachable: %v\n", err)
		os.Exit(2)
	}

	fmt.Println("Rebuilding search indexes...")
	stats, err := svc.ReindexAll(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "reindex failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✓ reindexed: %s\n", stats.String())
}
