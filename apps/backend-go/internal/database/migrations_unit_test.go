package database

import (
	"strings"
	"testing"
)

// =============================================================================
// Unit: splitSQLStatements
// =============================================================================

func TestSplitSQLStatements(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "simple two statements",
			input: "CREATE TABLE a ();\nCREATE TABLE b ();",
			want:  []string{"CREATE TABLE a ()", "CREATE TABLE b ()"},
		},
		{
			name:  "semicolon inside a string literal does not split",
			input: "INSERT INTO t VALUES ('a;b');\nSELECT 1;",
			want:  []string{"INSERT INTO t VALUES ('a;b')", "SELECT 1"},
		},
		{
			name:  "doubled quote escape keeps the literal intact",
			input: "INSERT INTO t VALUES ('it''s;ok');",
			want:  []string{"INSERT INTO t VALUES ('it''s;ok')"},
		},
		{
			name:  "semicolon inside a line comment does not split",
			input: "-- a;b\nSELECT 1;",
			want:  []string{"-- a;b\nSELECT 1"},
		},
		{
			name:  "semicolon inside a block comment does not split",
			input: "/* x;y */ SELECT 1;",
			want:  []string{"/* x;y */ SELECT 1"},
		},
		{
			name:  "trailing statement without semicolon",
			input: "SELECT 1",
			want:  []string{"SELECT 1"},
		},
		{
			name:  "$1 parameter is not a dollar quote",
			input: "SELECT $1;",
			want:  []string{"SELECT $1"},
		},
		{
			name: "PL/pgSQL body with internal semicolons stays one statement",
			input: "CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\n" +
				"BEGIN\n  DELETE FROM t WHERE x = 1;\nEND;\n$$ LANGUAGE plpgsql;\nSELECT 1;",
			want: []string{
				"CREATE OR REPLACE FUNCTION f() RETURNS void AS $$\nBEGIN\n  DELETE FROM t WHERE x = 1;\nEND;\n$$ LANGUAGE plpgsql",
				"SELECT 1",
			},
		},
		{
			name:  "tagged dollar quote",
			input: "DO $body$ BEGIN PERFORM 1; END; $body$;\nSELECT 2;",
			want:  []string{"DO $body$ BEGIN PERFORM 1; END; $body$", "SELECT 2"},
		},
		{
			name:  "empty and whitespace-only statements are dropped",
			input: ";;\n  ;\nSELECT 1;;",
			want:  []string{"SELECT 1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitSQLStatements(tt.input)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d statements %q, want %d %q", len(got), got, len(tt.want), tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("statement %d:\n  got:  %q\n  want: %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

// =============================================================================
// Unit: isDuplicateObjectError
// =============================================================================

func TestIsDuplicateObjectError(t *testing.T) {
	duplicates := []string{
		`pq: relation "users" already exists (SQLSTATE 42P07)`,
		`pq: column "email" of relation "users" already exists`,
		"ERROR: duplicate_object (SQLSTATE 42710)",
		"ERROR: duplicate_column (SQLSTATE 42701)",
		"ERROR: duplicate_function (SQLSTATE 42723)",
	}
	for _, msg := range duplicates {
		if !isDuplicateObjectError(msg) {
			t.Errorf("expected duplicate-object: %q", msg)
		}
	}

	// A unique_violation is a DATA conflict, not an existing object: treating it
	// as "already applied" would skip the rest of a seed migration.
	notDuplicates := []string{
		`pq: duplicate key value violates unique constraint "users_username_key" (SQLSTATE 23505)`,
		"ERROR: 23505",
		`pq: syntax error at or near "THIS"`,
		`pq: column "nope" does not exist`,
		"",
	}
	for _, msg := range notDuplicates {
		if isDuplicateObjectError(msg) {
			t.Errorf("did NOT expect duplicate-object: %q", msg)
		}
	}
}

// =============================================================================
// Unit: verifyAppliedChecksums
// =============================================================================

func TestVerifyAppliedChecksums(t *testing.T) {
	available := map[string]string{"001_a.sql": "hash-a", "002_b.sql": "hash-b"}

	t.Run("matching checksums pass", func(t *testing.T) {
		applied := map[string]string{"001_a.sql": "hash-a", "002_b.sql": "hash-b"}
		if err := verifyAppliedChecksums(applied, available); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("legacy rows without checksum are ignored", func(t *testing.T) {
		applied := map[string]string{"001_a.sql": ""}
		if err := verifyAppliedChecksums(applied, available); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("modified migration warns but does not fail by default", func(t *testing.T) {
		applied := map[string]string{"001_a.sql": "stale"}
		if err := verifyAppliedChecksums(applied, available); err != nil {
			t.Fatalf("expected nil without MIGRATIONS_STRICT, got %v", err)
		}
	})

	t.Run("modified migration fails in strict mode", func(t *testing.T) {
		t.Setenv("MIGRATIONS_STRICT", "1")
		applied := map[string]string{"001_a.sql": "stale"}
		err := verifyAppliedChecksums(applied, available)
		if err == nil {
			t.Fatal("expected a strict-mode error")
		}
		if !strings.Contains(err.Error(), "001_a.sql") {
			t.Fatalf("error should name the file, got: %v", err)
		}
	})

	t.Run("applied-but-missing file fails in strict mode", func(t *testing.T) {
		t.Setenv("MIGRATIONS_STRICT", "true")
		applied := map[string]string{"099_gone.sql": "hash-z"}
		if err := verifyAppliedChecksums(applied, available); err == nil {
			t.Fatal("expected a strict-mode error for a missing file")
		}
	})
}

func TestSha256Hex_Stable(t *testing.T) {
	a := sha256Hex([]byte("SELECT 1;"))
	b := sha256Hex([]byte("SELECT 1;"))
	if a != b {
		t.Fatalf("checksum not deterministic: %s vs %s", a, b)
	}
	if a == sha256Hex([]byte("SELECT 2;")) {
		t.Fatal("different content must produce different checksums")
	}
}
