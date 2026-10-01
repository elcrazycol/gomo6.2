package search

import "testing"

func TestIndexableUser(t *testing.T) {
	cases := []struct {
		name           string
		isRemote       bool
		privateProfile bool
		want           bool
	}{
		{"local public", false, false, true},
		{"local private", false, true, false},
		{"remote public", true, false, false},
		{"remote private", true, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IndexableUser(tc.isRemote, tc.privateProfile); got != tc.want {
				t.Fatalf("IndexableUser(%v, %v) = %v, want %v", tc.isRemote, tc.privateProfile, got, tc.want)
			}
		})
	}
}

func TestIndexableBoard(t *testing.T) {
	cases := map[string]bool{
		"":        true, // legacy row defaults to public
		"public":  true,
		"private": false,
		"hidden":  false,
	}
	for visibility, want := range cases {
		if got := IndexableBoard(visibility); got != want {
			t.Errorf("IndexableBoard(%q) = %v, want %v", visibility, got, want)
		}
	}
}

func TestPublicContentClause(t *testing.T) {
	if got := PublicContentClause(); got != `board_visibility = "public"` {
		t.Fatalf("PublicContentClause() = %q", got)
	}
}

func TestAndFilter(t *testing.T) {
	cases := []struct {
		name  string
		parts []string
		want  string
	}{
		{"empty", nil, ""},
		{"blank parts dropped", []string{"", "  ", `a = 1`}, `a = 1`},
		{"joined with AND", []string{`board_visibility = "public"`, `author_id = "x"`}, `board_visibility = "public" AND author_id = "x"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AndFilter(tc.parts...); got != tc.want {
				t.Fatalf("AndFilter(%v) = %q, want %q", tc.parts, got, tc.want)
			}
		})
	}
}
