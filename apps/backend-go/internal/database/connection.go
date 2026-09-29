package database

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// Pool bounds. database/sql defaults to unlimited open connections. Combined
// with the per-request RLS transaction in middleware/rls.go (which pins one
// connection for the whole request) an unbounded pool lets a traffic spike open
// connections until Postgres reaches max_connections (100 by default) and
// refuses every new client. These are env-tunable so they can be raised without
// a rebuild.
const (
	defaultDBMaxOpenConns = 25
	dbConnMaxLifetime     = 30 * time.Minute
	dbConnMaxIdleTime     = 5 * time.Minute
)

func InitDB() (*sql.DB, error) {
	// For now, use environment variable or default
	databaseURL := getEnv("DATABASE_URL", "postgres://user:password@localhost/gomo6?sslmode=disable")

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Bound the pool. Default idle equals maxOpen so a steady load keeps warm
	// connections instead of re-dialing on every burst.
	maxOpen := getEnvInt("DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns)
	maxIdle := getEnvInt("DB_MAX_IDLE_CONNS", maxOpen)
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(dbConnMaxLifetime)
	db.SetConnMaxIdleTime(dbConnMaxIdleTime)
	log.Printf("Database pool: maxOpen=%d maxIdle=%d connMaxLifetime=%s", maxOpen, maxIdle, dbConnMaxLifetime)

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	if err := RunMigrations(db); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	log.Println("Database connected successfully")
	return db, nil
}
