package handlers

import (
	"testing"
)

func TestParseSingleOrderSegment(t *testing.T) {
	tests := []struct {
		name    string
		segment string
		col     string
		dir     string
		ok      bool
	}{
		{"asc", "created_at.asc", "created_at", "ASC", true},
		{"desc", "name.desc", "name", "DESC", true},
		{"case insensitive asc", "foo.ASC", "foo", "ASC", true},
		{"case insensitive desc", "Bar.Desc", "Bar", "DESC", true},
		{"no dot", "nodot", "", "", false},
		{"empty after dot", "col.", "", "", false},
		{"empty before dot", ".desc", "", "", false},
		{"invalid direction", "col.sideways", "", "", false},
		{"multiple dots last wins", "a.b.c", "a.b", "C", false},
		{"whitespace around", " col . asc ", "col", "ASC", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			col, dir, ok := parseSingleOrderSegment(tt.segment)
			if ok != tt.ok {
				t.Fatalf("ok: got %v, want %v", ok, tt.ok)
			}
			if ok {
				if col != tt.col {
					t.Errorf("col: got %q, want %q", col, tt.col)
				}
				if dir != tt.dir {
					t.Errorf("dir: got %q, want %q", dir, tt.dir)
				}
			}
		})
	}
}

func TestIsSafeSQLIdentifier(t *testing.T) {
	tests := []struct {
		name string
		s    string
		want bool
	}{
		{"simple", "hello", true},
		{"with underscore", "user_id", true},
		{"starts with number", "1col", false},
		{"starts with underscore", "_priv", true},
		{"empty", "", false},
		{"with dot", "table.col", false},
		{"with space", "col name", false},
		{"with dash", "col-name", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isSafeSQLIdentifier(tt.s)
			if got != tt.want {
				t.Errorf("isSafeSQLIdentifier(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}

	t.Run("63 chars ok", func(t *testing.T) {
		s := string(make([]byte, 63))
		for i := range s {
			s = s[:i] + "a" + s[i+1:]
		}
		// Simple approach: 63 a's
		s = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		if len(s) != 63 {
			t.Fatalf("test setup: len=%d, want 63", len(s))
		}
		if !isSafeSQLIdentifier(s) {
			t.Error("63 chars should be valid")
		}
	})
	t.Run("64 chars too long", func(t *testing.T) {
		s := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		if len(s) != 64 {
			t.Fatalf("test setup: len=%d, want 64", len(s))
		}
		if isSafeSQLIdentifier(s) {
			t.Error("64 chars should be invalid")
		}
	})
}

func TestQuoteSQLIdent(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"hello", `"hello"`},
		{"col with \"quotes\"", `"col with ""quotes"""`},
		{"simple", `"simple"`},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := quoteSQLIdent(tt.input)
			if got != tt.want {
				t.Errorf("quoteSQLIdent(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseOrderClause(t *testing.T) {
	tests := []struct {
		name       string
		expr       string
		tableAlias string
		wantSQL    string
		wantOK     bool
	}{
		{"empty", "", "", "", false},
		{"single asc", "created_at.asc", "", `"created_at" ASC`, true},
		{"single desc", "name.desc", "", `"name" DESC`, true},
		{"multi", "name.asc,created_at.desc", "", `"name" ASC, "created_at" DESC`, true},
		{"with alias", "name.asc", "t", `"t"."name" ASC`, true},
		{"with alias multi", "name.asc,id.desc", "t", `"t"."name" ASC, "t"."id" DESC`, true},
		{"invalid segment filtered out", "bad,name.desc", "", `"name" DESC`, true},
		{"all invalid", "bad,sideways", "", "", false},
		{"sql injection attempt", "1; DROP TABLE--.asc", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotSQL, gotOK := parseOrderClause(tt.expr, tt.tableAlias)
			if gotOK != tt.wantOK {
				t.Fatalf("ok: got %v, want %v", gotOK, tt.wantOK)
			}
			if gotSQL != tt.wantSQL {
				t.Errorf("sql: got %q, want %q", gotSQL, tt.wantSQL)
			}
		})
	}
}
