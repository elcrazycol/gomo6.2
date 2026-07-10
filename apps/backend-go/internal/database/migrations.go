package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunMigrations reads all .sql files from the migrations directory, sorts them
// by filename, and executes any not yet applied in a transaction. A
// schema_migrations table tracks which files have already been run.
func RunMigrations(db *sql.DB) error {
	migrationsDir := getEnv("MIGRATIONS_DIR", "./migrations")

	// Ensure the migration tracking table exists
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	// Read already-applied migrations
	applied, err := getAppliedMigrations(db)
	if err != nil {
		return err
	}

	// Discover migration files
	files, err := filepath.Glob(filepath.Join(migrationsDir, "*.sql"))
	if err != nil {
		return fmt.Errorf("read migrations directory %s: %w", migrationsDir, err)
	}
	if len(files) == 0 {
		log.Printf("RunMigrations: no .sql files found in %s — skipping", migrationsDir)
		return nil
	}

	sort.Strings(files) // numeric-prefix sort (001, 002, …, 028)

	// Build a set of available migration filenames for quick lookup.
	available := make(map[string]bool, len(files))
	for _, f := range files {
		available[filepath.Base(f)] = true
	}

	// If the database already has tables (pre-existing from a previous setup),
	// mark the initial schema migration as applied to avoid INSERT conflicts
	// with seed data (achievements, default boards). Only do this if
	// 001_initial_schema.sql actually exists in the migrations directory.
	if available["001_initial_schema.sql"] && !applied["001_initial_schema.sql"] {
		var usersExists bool
		if err := db.QueryRow(
			"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')",
		).Scan(&usersExists); err == nil && usersExists {
			log.Printf("RunMigrations: pre-existing database detected — marking 001_initial_schema.sql as applied")
			if _, err := db.Exec(
				"INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
				"001_initial_schema.sql",
			); err != nil {
				return fmt.Errorf("mark 001 as applied: %w", err)
			}
			applied["001_initial_schema.sql"] = true
		}
	}

	appliedCount := 0
	skippedCount := 0
	failedCount := 0
	for _, file := range files {
		name := filepath.Base(file)
		if applied[name] {
			skippedCount++
			continue
		}

		log.Printf("RunMigrations: applying %s", name)

		content, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read migration file %s: %w", file, err)
		}

		// Strip explicit BEGIN/COMMIT — the Go runner wraps in its own transaction.
		// Some older migrations (e.g. 013) embed their own transaction blocks,
		// which would cause "unexpected transaction status idle" errors.
		migrationSQL := stripTransactionWrappers(string(content))

		// Apply the migration in a transaction
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin transaction for %s: %w", name, err)
		}

		if _, err := tx.Exec(migrationSQL); err != nil {
			tx.Rollback()
			errMsg := err.Error()
			// If the error is about duplicate objects, the migration was partially
			// applied (e.g. by docker-entrypoint or manual SQL). Mark it as applied
			// so we don't retry on every startup.
			if isDuplicateObjectError(errMsg) {
				log.Printf("RunMigrations: %s — objects already exist, marking as applied", name)
				if _, markErr := db.Exec(
					"INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
					name,
				); markErr != nil {
					log.Printf("RunMigrations: WARNING failed to mark %s: %v", name, markErr)
				}
				failedCount++
				continue
			}
			return fmt.Errorf("execute migration %s: %w", name, err)
		}

		if _, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES ($1)", name); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", name, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}

		log.Printf("RunMigrations: %s applied successfully", name)
		appliedCount++
	}

	log.Printf("RunMigrations: complete — %d applied, %d skipped (already applied), %d previously applied",
		appliedCount, skippedCount, failedCount)
	return nil
}

// stripTransactionWrappers removes explicit BEGIN/COMMIT (and trailing whitespace
// variants) from a SQL string. Some older migrations embed their own transaction
// blocks, which conflict with the per-migration transaction managed by the runner.
func stripTransactionWrappers(sql string) string {
	s := strings.TrimSpace(sql)
	s = strings.TrimSuffix(s, "COMMIT;")
	s = strings.TrimPrefix(s, "BEGIN;")
	return strings.TrimSpace(s)
}

// isDuplicateObjectError checks if a PostgreSQL error indicates that the
// object (table, column, index, constraint) already exists.
func isDuplicateObjectError(errMsg string) bool {
	duplicatePatterns := []string{
		"already exists",
		"duplicate column",
		"duplicate key",
		"relation .* already exists",
		"column .* already exists",
		"index .* already exists",
		"constraint .* already exists",
		"type .* already exists",
	}
	for _, pattern := range duplicatePatterns {
		if strings.Contains(errMsg, pattern) {
			return true
		}
	}
	// PostgreSQL error codes for duplicate objects
	duplicateCodes := []string{
		"42710", // duplicate_object
		"42P07", // duplicate_table
		"42701", // duplicate_column
		"42P16", // invalid_table_definition (unique constraint exists)
		"23505", // unique_violation
	}
	for _, code := range duplicateCodes {
		if strings.Contains(errMsg, code) {
			return true
		}
	}
	return false
}

// getAppliedMigrations returns the set of migration filenames already recorded
// in schema_migrations.
func getAppliedMigrations(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan migration version: %w", err)
		}
		applied[version] = true
	}
	return applied, rows.Err()
}
