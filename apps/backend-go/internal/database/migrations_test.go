package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	_ "github.com/lib/pq"
)

// =============================================================================
// Unit: stripTransactionWrappers
// =============================================================================

func TestStripTransactionWrappers(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "whitespace only",
			input:    "  \n  \t ",
			expected: "",
		},
		{
			name:     "simple SQL without markers",
			input:    "ALTER TABLE users ADD COLUMN foo TEXT;",
			expected: "ALTER TABLE users ADD COLUMN foo TEXT;",
		},
		{
			name:     "BEGIN/COMMIT wrapped",
			input:    "BEGIN;\nALTER TABLE users ADD COLUMN foo TEXT;\nCOMMIT;",
			expected: "ALTER TABLE users ADD COLUMN foo TEXT;",
		},
		{
			name:     "only BEGIN;",
			input:    "BEGIN;\nALTER TABLE users ADD COLUMN foo TEXT;",
			expected: "ALTER TABLE users ADD COLUMN foo TEXT;",
		},
		{
			name:     "only COMMIT;",
			input:    "ALTER TABLE users ADD COLUMN foo TEXT;\nCOMMIT;",
			expected: "ALTER TABLE users ADD COLUMN foo TEXT;",
		},
		{
			name:     "extra whitespace around markers",
			input:    "\n\nBEGIN;\n\nALTER TABLE users ADD COLUMN foo TEXT;\n\nCOMMIT;\n\n",
			expected: "ALTER TABLE users ADD COLUMN foo TEXT;",
		},
		{
			name:     "multiline SQL in transaction",
			input:    "BEGIN;\nCREATE TABLE test (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);\nINSERT INTO test (name) VALUES ('hello');\nCOMMIT;",
			expected: "CREATE TABLE test (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);\nINSERT INTO test (name) VALUES ('hello');",
		},
		{
			name:     "SQL with COMMIT as data (edge case — not a real concern, but validates no false-positive stripping)",
			input:    "INSERT INTO audit (action) VALUES ('COMMIT');",
			expected: "INSERT INTO audit (action) VALUES ('COMMIT');",
		},
		{
			name:     "trailing spaces after COMMIT",
			input:    "BEGIN;\nSELECT 1;\nCOMMIT;  ",
			expected: "SELECT 1;",
		},
		{
			name:     "leading spaces before BEGIN",
			input:    "  BEGIN;\nSELECT 1;\nCOMMIT;",
			expected: "SELECT 1;",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripTransactionWrappers(tt.input)
			if got != tt.expected {
				t.Errorf("stripTransactionWrappers(%q)\n  got:  %q\n  want: %q", tt.input, got, tt.expected)
			}
		})
	}
}

// =============================================================================
// Integration: RunMigrations (requires DATABASE_URL / Docker Postgres)
// =============================================================================

var testDB *sql.DB

func TestMain(m *testing.M) {
	dbURL := os.Getenv("DATABASE_URL_TEST")
	if dbURL == "" {
		dbURL = "postgres://gomo6:gomo6password@localhost:5432/gomo6?sslmode=disable"
	}

	var err error
	testDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		fmt.Printf("Skipping integration tests: %v\n", err)
		os.Exit(0)
	}
	if err := testDB.Ping(); err != nil {
		fmt.Printf("Skipping integration tests: %v\n", err)
		os.Exit(0)
	}

	code := m.Run()
	testDB.Close()
	os.Exit(code)
}

// writeMigrationFiles creates .sql files in dir with the given name→content mapping.
func writeMigrationFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write %s: %v", name, err)
		}
	}
}

// getAppliedVersions returns sorted list of applied migration versions.
func getAppliedVersions(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query("SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	defer rows.Close()

	var versions []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan version: %v", err)
		}
		versions = append(versions, v)
	}
	return versions
}

// cleanupMigrations drops test artifacts from the DB.
func cleanupMigrations(t *testing.T) {
	t.Helper()
	// Drop schema_migrations and any test tables created by migrations
	testDB.Exec("DROP TABLE IF EXISTS migration_test_001 CASCADE")
	testDB.Exec("DROP TABLE IF EXISTS migration_test_002 CASCADE")
	testDB.Exec("DROP TABLE IF EXISTS migration_test_003 CASCADE")
	testDB.Exec("DROP TABLE IF EXISTS schema_migrations CASCADE")
}

// =============================================================================
// Test: Empty migrations directory
// =============================================================================

func TestRunMigrations_EmptyDirectory(t *testing.T) {
	cleanupMigrations(t)

	dir := t.TempDir()

	// Run with empty directory
	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err != nil {
		t.Fatalf("RunMigrations with empty dir should not error: %v", err)
	}

	// schema_migrations table should still be created (tracking table)
	var exists bool
	if err := testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'schema_migrations')").Scan(&exists); err != nil {
		t.Fatalf("check schema_migrations table: %v", err)
	}
	if !exists {
		t.Error("schema_migrations table should exist even with empty migrations dir")
	}

	// No versions should be applied
	versions := getAppliedVersions(t, testDB)
	if len(versions) != 0 {
		t.Errorf("expected 0 applied versions in empty dir, got %d: %v", len(versions), versions)
	}
}

// =============================================================================
// Test: Normal migration flow (happy path)
// =============================================================================

func TestRunMigrations_NormalFlow(t *testing.T) {
	cleanupMigrations(t)

	dir := t.TempDir()
	writeMigrationFiles(t, dir, map[string]string{
		"001_create_users.sql": "CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL PRIMARY KEY, name TEXT);",
		"002_add_email.sql":    "ALTER TABLE migration_test_001 ADD COLUMN IF NOT EXISTS email TEXT;",
	})

	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	// Both should be applied
	versions := getAppliedVersions(t, testDB)
	sort.Strings(versions)

	if len(versions) != 2 {
		t.Fatalf("expected 2 applied versions, got %d: %v", len(versions), versions)
	}
	if versions[0] != "001_create_users.sql" || versions[1] != "002_add_email.sql" {
		t.Errorf("unexpected applied versions: %v", versions)
	}

	// Verify the tables were actually created
	var exists bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migration_test_001')").Scan(&exists)
	if !exists {
		t.Error("migration_test_001 should exist")
	}

	var hasEmail bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'migration_test_001' AND column_name = 'email')").Scan(&hasEmail)
	if !hasEmail {
		t.Error("email column should exist after 002 migration")
	}

	// Run again — should be idempotent (all skipped)
	err = RunMigrations(testDB)
	if err != nil {
		t.Fatalf("second RunMigrations should not error: %v", err)
	}
	versions = getAppliedVersions(t, testDB)
	if len(versions) != 2 {
		t.Errorf("second run should still have 2 applied versions, got %d", len(versions))
	}
}

// =============================================================================
// Test: Pre-existing database detection
// =============================================================================

func TestRunMigrations_PreExistingDB(t *testing.T) {
	cleanupMigrations(t)

	// Verify the users table exists (pre-existing DB). If not, skip — this test
	// needs a real database with the users table already present.
	var usersExists bool
	if err := testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')").Scan(&usersExists); err != nil || !usersExists {
		t.Skip("users table does not exist — skipping pre-existing DB test (requires real database)")
	}

	dir := t.TempDir()
	writeMigrationFiles(t, dir, map[string]string{
		// The filename 001_initial_schema.sql triggers pre-existing detection.
		// Its SQL won't be executed — just creates a test table to verify that.
		"001_initial_schema.sql": "CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL);",
		"002_add_feature.sql":    "CREATE TABLE IF NOT EXISTS migration_test_002 (id SERIAL);",
	})

	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err != nil {
		t.Fatalf("RunMigrations with pre-existing DB failed: %v", err)
	}

	versions := getAppliedVersions(t, testDB)
	sort.Strings(versions)

	if len(versions) != 2 {
		t.Fatalf("expected 2 applied versions, got %d: %v", len(versions), versions)
	}

	// 001 should be marked as applied (pre-existing detection), 002 should run normally
	if versions[0] != "001_initial_schema.sql" {
		t.Errorf("expected 001 to be applied (pre-existing), got: %v", versions)
	}
	if versions[1] != "002_add_feature.sql" {
		t.Errorf("expected 002 to be applied, got: %v", versions)
	}

	// migration_test_002 should exist (002 ran), migration_test_001 should NOT (001 was skipped)
	var t1exists bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migration_test_001')").Scan(&t1exists)
	if t1exists {
		t.Error("migration_test_001 should NOT exist (001 was skipped due to pre-existing DB)")
	}

	var t2exists bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migration_test_002')").Scan(&t2exists)
	if !t2exists {
		t.Error("migration_test_002 should exist (002 ran normally)")
	}
}

// =============================================================================
// Test: Partially applied migrations
// =============================================================================

func TestRunMigrations_PartiallyApplied(t *testing.T) {
	cleanupMigrations(t)

	dir := t.TempDir()
	writeMigrationFiles(t, dir, map[string]string{
		"001_first.sql":  "CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL);",
		"002_second.sql": "CREATE TABLE IF NOT EXISTS migration_test_002 (id SERIAL);",
		"003_third.sql":  "CREATE TABLE IF NOT EXISTS migration_test_003 (id SERIAL);",
	})

	// Simulate 001 already applied — create the tracking table first
	// (cleanupMigrations dropped it, and RunMigrations hasn't run yet).
	// Also create the table that 001 would have created, to simulate a
	// real partially-applied state.
	if _, err := testDB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)`); err != nil {
		t.Fatalf("create schema_migrations: %v", err)
	}
	if _, err := testDB.Exec("CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL)"); err != nil {
		t.Fatalf("create migration_test_001: %v", err)
	}
	if _, err := testDB.Exec("INSERT INTO schema_migrations (version) VALUES ('001_first.sql')"); err != nil {
		t.Fatalf("pre-seed schema_migrations: %v", err)
	}

	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err != nil {
		t.Fatalf("RunMigrations with partially applied failed: %v", err)
	}

	versions := getAppliedVersions(t, testDB)
	sort.Strings(versions)

	if len(versions) != 3 {
		t.Fatalf("expected 3 applied versions, got %d: %v", len(versions), versions)
	}

	// Verify each table
	for _, table := range []string{"migration_test_001", "migration_test_002", "migration_test_003"} {
		var exists bool
		testDB.QueryRow(fmt.Sprintf("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '%s')", table)).Scan(&exists)
		if !exists {
			t.Errorf("%s should exist", table)
		}
	}
}

// =============================================================================
// Test: SQL error causes rollback and does not record migration
// =============================================================================

func TestRunMigrations_SQLErrorRollback(t *testing.T) {
	cleanupMigrations(t)

	dir := t.TempDir()
	writeMigrationFiles(t, dir, map[string]string{
		"001_ok.sql":     "CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL);",
		"002_broken.sql": "THIS IS NOT VALID SQL AT ALL;",
		"003_after.sql":  "CREATE TABLE IF NOT EXISTS migration_test_003 (id SERIAL);",
	})

	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err == nil {
		t.Fatal("expected error from broken migration, got nil")
	}

	// The error message should mention the broken file
	if !strings.Contains(err.Error(), "002_broken.sql") {
		t.Errorf("error should mention 002_broken.sql, got: %v", err)
	}

	// 001 should be applied successfully (it ran before the broken one)
	versions := getAppliedVersions(t, testDB)
	if len(versions) != 1 {
		t.Fatalf("expected exactly 1 applied version (001), got %d: %v", len(versions), versions)
	}
	if versions[0] != "001_ok.sql" {
		t.Errorf("expected 001_ok.sql to be applied, got %s", versions[0])
	}

	// 001 table should exist
	var t1exists bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migration_test_001')").Scan(&t1exists)
	if !t1exists {
		t.Error("migration_test_001 should exist (001 ran before error)")
	}

	// 003 table should NOT exist (migration stopped at 002)
	var t3exists bool
	testDB.QueryRow("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'migration_test_003')").Scan(&t3exists)
	if t3exists {
		t.Error("migration_test_003 should NOT exist (runner stopped at broken 002)")
	}

	// 002 should NOT be recorded in schema_migrations
	for _, v := range versions {
		if v == "002_broken.sql" {
			t.Error("002_broken.sql should NOT be in schema_migrations after failed run")
		}
	}
}

// =============================================================================
// Test: All migrations already applied (idempotent)
// =============================================================================

func TestRunMigrations_AllAlreadyApplied(t *testing.T) {
	cleanupMigrations(t)

	dir := t.TempDir()
	writeMigrationFiles(t, dir, map[string]string{
		"001_first.sql":  "CREATE TABLE IF NOT EXISTS migration_test_001 (id SERIAL);",
		"002_second.sql": "CREATE TABLE IF NOT EXISTS migration_test_002 (id SERIAL);",
	})

	// Pre-seed both as applied — create the tracking table first
	// (cleanupMigrations dropped it, and RunMigrations hasn't run yet)
	testDB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	)`)
	testDB.Exec("INSERT INTO schema_migrations (version) VALUES ('001_first.sql'), ('002_second.sql')")

	oldDir := os.Getenv("MIGRATIONS_DIR")
	os.Setenv("MIGRATIONS_DIR", dir)
	defer os.Setenv("MIGRATIONS_DIR", oldDir)

	err := RunMigrations(testDB)
	if err != nil {
		t.Fatalf("RunMigrations when all already applied failed: %v", err)
	}

	// Run a second time — still should not error (double idempotent check)
	err = RunMigrations(testDB)
	if err != nil {
		t.Fatalf("third RunMigrations should also not error: %v", err)
	}

	versions := getAppliedVersions(t, testDB)
	if len(versions) != 2 {
		t.Errorf("expected 2 applied versions, got %d", len(versions))
	}
}
