package database

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RunMigrations reads all .sql files from the migrations directory, sorts them
// by filename, and executes any not yet applied in a transaction. A
// schema_migrations table tracks which files have already been run, and the
// SHA-256 of each file so a migration edited after it was applied is detected.
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
	// Checksums were added after the first deployments: pre-existing rows keep a
	// NULL checksum and are only verified once their file changes.
	if _, err := db.Exec(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`); err != nil {
		return fmt.Errorf("add schema_migrations.checksum: %w", err)
	}

	// Read already-applied migrations (version → recorded checksum, "" if none)
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

	type migrationFile struct {
		name     string
		checksum string
		content  string
	}
	migrations := make([]migrationFile, 0, len(files))
	available := make(map[string]string, len(files))
	for _, f := range files {
		content, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("read migration file %s: %w", f, err)
		}
		base := filepath.Base(f)
		migrations = append(migrations, migrationFile{
			name:     base,
			checksum: sha256Hex(content),
			content:  string(content),
		})
		available[base] = sha256Hex(content)
	}

	if err := verifyAppliedChecksums(applied, available); err != nil {
		return err
	}

	// If the database already has tables (pre-existing from a previous setup),
	// mark the initial schema migration as applied to avoid INSERT conflicts
	// with seed data (achievements, default boards). Only do this if
	// 001_initial_schema.sql actually exists in the migrations directory.
	if _, ok := available["001_initial_schema.sql"]; ok {
		if _, done := applied["001_initial_schema.sql"]; !done {
			var usersExists bool
			if err := db.QueryRow(
				"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')",
			).Scan(&usersExists); err == nil && usersExists {
				log.Printf("RunMigrations: pre-existing database detected — marking 001_initial_schema.sql as applied")
				if _, err := db.Exec(
					"INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
					"001_initial_schema.sql", available["001_initial_schema.sql"],
				); err != nil {
					return fmt.Errorf("mark 001 as applied: %w", err)
				}
				applied["001_initial_schema.sql"] = available["001_initial_schema.sql"]
			}
		}
	}

	appliedCount := 0
	skippedCount := 0
	for _, m := range migrations {
		if _, done := applied[m.name]; done {
			skippedCount++
			continue
		}

		log.Printf("RunMigrations: applying %s", m.name)

		// Strip explicit BEGIN/COMMIT — the Go runner wraps in its own transaction.
		// Some older migrations (e.g. 013) embed their own transaction blocks,
		// which would cause "unexpected transaction status idle" errors.
		migrationSQL := stripTransactionWrappers(m.content)

		if err := runMigration(db, m.name, migrationSQL, m.checksum); err != nil {
			return fmt.Errorf("execute migration %s: %w", m.name, err)
		}

		log.Printf("RunMigrations: %s applied successfully", m.name)
		appliedCount++
	}

	log.Printf("RunMigrations: complete — %d applied, %d skipped (already applied)",
		appliedCount, skippedCount)
	return nil
}

// recordMigrationSQL records a migration and (re)writes its checksum.
const recordMigrationSQL = `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)
ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum`

// runMigration applies one migration atomically and records it. If the whole
// migration fails because its objects already exist (a database initialised
// outside the runner), it is re-applied statement by statement, skipping only
// the statements whose object already exists — so a half-applied migration is
// COMPLETED instead of being recorded as done with the rest of the file skipped.
func runMigration(db *sql.DB, name, migrationSQL, checksum string) error {
	err := withTx(db, func(tx *sql.Tx) error {
		if _, err := tx.Exec(migrationSQL); err != nil {
			return err
		}
		_, err := tx.Exec(recordMigrationSQL, name, checksum)
		return err
	})
	if err == nil {
		return nil
	}
	if !isDuplicateObjectError(err.Error()) {
		return err
	}

	log.Printf("RunMigrations: %s — objects already exist, completing remaining statements", name)
	return withTx(db, func(tx *sql.Tx) error {
		if err := applyStatementsSkippingDuplicates(tx, migrationSQL); err != nil {
			return err
		}
		_, err := tx.Exec(recordMigrationSQL, name, checksum)
		return err
	})
}

// withTx runs fn in a transaction, committing on success and rolling back on
// error.
func withTx(db *sql.DB, fn func(*sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// applyStatementsSkippingDuplicates executes statements one at a time inside an
// existing transaction. A statement whose error is a duplicate-object error is
// rolled back to its savepoint and skipped; any other error aborts the whole
// migration (and therefore the transaction).
func applyStatementsSkippingDuplicates(tx *sql.Tx, migrationSQL string) error {
	for i, stmt := range splitSQLStatements(migrationSQL) {
		if _, err := tx.Exec("SAVEPOINT migration_stmt"); err != nil {
			return fmt.Errorf("savepoint: %w", err)
		}
		if _, err := tx.Exec(stmt); err != nil {
			if isDuplicateObjectError(err.Error()) {
				if _, rbErr := tx.Exec("ROLLBACK TO SAVEPOINT migration_stmt"); rbErr != nil {
					return fmt.Errorf("rollback savepoint: %w", rbErr)
				}
				continue
			}
			return fmt.Errorf("statement %d: %w", i+1, err)
		}
		if _, err := tx.Exec("RELEASE SAVEPOINT migration_stmt"); err != nil {
			return fmt.Errorf("release savepoint: %w", err)
		}
	}
	return nil
}

// verifyAppliedChecksums compares the checksum recorded when a migration was
// applied with the current file. A mismatch means an already-applied migration
// was edited — the database will not pick up that change, so it is warned about
// (or fatal with MIGRATIONS_STRICT=1) rather than silently ignored.
func verifyAppliedChecksums(applied, available map[string]string) error {
	var mismatched, missing []string
	for name, recorded := range applied {
		if recorded == "" {
			continue // recorded before checksums existed
		}
		current, ok := available[name]
		if !ok {
			missing = append(missing, name)
			continue
		}
		if current != recorded {
			mismatched = append(mismatched, name)
		}
	}
	if len(mismatched) == 0 && len(missing) == 0 {
		return nil
	}
	sort.Strings(mismatched)
	sort.Strings(missing)
	for _, name := range mismatched {
		log.Printf("RunMigrations: WARNING %s was modified after it was applied (checksum mismatch) — its changes are NOT re-run", name)
	}
	for _, name := range missing {
		log.Printf("RunMigrations: WARNING %s is recorded as applied but the file is missing", name)
	}
	if getEnvBool("MIGRATIONS_STRICT", false) {
		return fmt.Errorf("applied migrations changed since they were applied (strict mode): modified=%v missing=%v", mismatched, missing)
	}
	return nil
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
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

// splitSQLStatements splits a migration file into individual statements at
// top-level semicolons. It understands single/double-quoted strings, line and
// block comments, and PostgreSQL dollar-quoting ($$ … $$ and $tag$ … $tag$), so
// a semicolon inside a PL/pgSQL body or a string literal does not split a
// statement in half. Used only on the duplicate-recovery path.
func splitSQLStatements(src string) []string {
	var out []string
	var b strings.Builder
	n := len(src)

	flush := func() {
		if s := strings.TrimSpace(b.String()); s != "" {
			out = append(out, s)
		}
		b.Reset()
	}

	for i := 0; i < n; {
		c := src[i]
		switch {
		case c == '-' && i+1 < n && src[i+1] == '-':
			j := i
			for j < n && src[j] != '\n' {
				j++
			}
			b.WriteString(src[i:j])
			i = j

		case c == '/' && i+1 < n && src[i+1] == '*':
			j := i + 2
			for j+1 < n && !(src[j] == '*' && src[j+1] == '/') {
				j++
			}
			if j+1 < n {
				j += 2
			} else {
				j = n
			}
			b.WriteString(src[i:j])
			i = j

		case c == '\'' || c == '"':
			quote := c
			j := i + 1
			for j < n {
				if src[j] == quote {
					if j+1 < n && src[j+1] == quote { // doubled-quote escape
						j += 2
						continue
					}
					j++
					break
				}
				j++
			}
			b.WriteString(src[i:j])
			i = j

		case c == '$':
			if tag, ok := dollarTagAt(src, i); ok {
				j := i + len(tag)
				if end := strings.Index(src[j:], tag); end >= 0 {
					j += end + len(tag)
				} else {
					j = n
				}
				b.WriteString(src[i:j])
				i = j
				continue
			}
			b.WriteByte(c)
			i++

		case c == ';':
			flush()
			i++

		default:
			b.WriteByte(c)
			i++
		}
	}
	flush()
	return out
}

// dollarTagAt reports whether a dollar-quote opener ($$ or $tag$) starts at i,
// returning the full opening tag. It rejects $-parameters such as $1.
func dollarTagAt(src string, i int) (string, bool) {
	if i+1 < len(src) && src[i+1] == '$' {
		return "$$", true
	}
	j := i + 1
	if j >= len(src) {
		return "", false
	}
	c := src[j]
	if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
		return "", false // $1, $2, … are parameters, not dollar quotes
	}
	for j < len(src) {
		c = src[j]
		if c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			j++
			continue
		}
		break
	}
	if j < len(src) && src[j] == '$' {
		return src[i : j+1], true
	}
	return "", false
}

// isDuplicateObjectError checks if a PostgreSQL error means the object (table,
// column, index, constraint, function) already exists, which is safe to skip.
//
// It deliberately does NOT treat unique_violation (23505 / "duplicate key") as a
// duplicate object: that is a data conflict, and matching it used to make the
// runner record a seed migration as applied while silently skipping the rest of
// its statements.
func isDuplicateObjectError(errMsg string) bool {
	if strings.Contains(errMsg, "already exists") {
		return true
	}
	// PostgreSQL error codes for duplicate objects.
	for _, code := range []string{
		"42710", // duplicate_object
		"42P07", // duplicate_table
		"42701", // duplicate_column
		"42P16", // invalid_table_definition (unique/primary key constraint exists)
		"42723", // duplicate_function
	} {
		if strings.Contains(errMsg, code) {
			return true
		}
	}
	return false
}

// getAppliedMigrations returns the checksum recorded for each applied migration
// ("" for rows written before checksums existed).
func getAppliedMigrations(db *sql.DB) (map[string]string, error) {
	rows, err := db.Query("SELECT version, COALESCE(checksum, '') FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]string)
	for rows.Next() {
		var version, checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			return nil, fmt.Errorf("scan migration version: %w", err)
		}
		applied[version] = checksum
	}
	return applied, rows.Err()
}
